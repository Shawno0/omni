import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { WorkspaceInfo } from "../types.js";
import { logger } from "../diagnostics/Logger.js";

export interface ActivityMonitorOptions {
  getWorkspaces: () => WorkspaceInfo[];
  getFocusedWorkspaceId: () => string | undefined;
  onTierChange: (workspaceId: string, tier: WorkspaceInfo["resourceTier"], cpuPercent: number) => void;
  onSample: (sample: {
    workspaceId: string;
    cpuPercent: number;
    tier: WorkspaceInfo["resourceTier"];
    terminalActive: boolean;
    terminalProgress: WorkspaceInfo["terminalProgress"];
    agentLock: boolean;
    sampledAt: number;
  }) => void;
}

interface PendingSample {
  resolve: (value: Record<number, number>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * ActivityMonitor is now worker-backed:
 *   - pidtree + pidusage run on a dedicated worker thread so they do not
 *     stall the Electron main event loop when many workspaces are active.
 *   - The main thread keeps all workspace-aware logic (tier decisions,
 *     event fanout) and adds hysteresis so we do not flap between
 *     `background-active` and `idle` at the 1% CPU boundary.
 *   - If the worker exits unexpectedly we log it and fall back to a
 *     no-op sampler until a new worker is spawned on the next tick.
 */
export class ActivityMonitor {
  private timer: NodeJS.Timeout | null = null;
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingSample>();
  /** Last emitted tier per workspace for hysteresis. */
  private readonly lastTier = new Map<string, WorkspaceInfo["resourceTier"]>();
  /** Moving average CPU per workspace, used as the hysteresis input. */
  private readonly smoothedCpu = new Map<string, number>();

  public constructor(private readonly options: ActivityMonitorOptions) {}

  public start(): void {
    this.stop();
    this.ensureWorker();
    this.timer = setInterval(() => {
      void this.sample();
    }, 2000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("ActivityMonitor stopped"));
    }
    this.pending.clear();
    if (this.worker) {
      void this.worker.terminate();
      this.worker = null;
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const here = path.dirname(fileURLToPath(import.meta.url));
    // After tsc emit, this file lives at dist/main/monitoring/ActivityMonitor.js
    // and the worker lives next to it as ActivityWorker.js.
    const workerPath = path.join(here, "ActivityWorker.js");
    const worker = new Worker(workerPath);
    worker.on("message", (msg: { id: number; cpuByPid: Record<number, number> }) => {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      pending.resolve(msg.cpuByPid);
    });
    worker.on("error", (err) => {
      logger.warn("ActivityMonitor", "Worker errored", err);
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        logger.warn("ActivityMonitor", `Worker exited with code ${code}, will respawn on next sample`);
      }
      if (this.worker === worker) {
        this.worker = null;
      }
    });
    this.worker = worker;
    return worker;
  }

  private async requestCpu(pids: number[]): Promise<Record<number, number>> {
    if (pids.length === 0) return {};
    const worker = this.ensureWorker();
    const id = this.nextRequestId++;
    return new Promise<Record<number, number>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CPU sample request timed out"));
      }, 5_000);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, pids });
    });
  }

  private async sample(): Promise<void> {
    const focusedWorkspaceId = this.options.getFocusedWorkspaceId();
    const workspaces = this.options.getWorkspaces();

    const rootPids = workspaces
      .map((w) => w.pid)
      .filter((pid): pid is number => typeof pid === "number" && pid > 0);

    let cpuByPid: Record<number, number> = {};
    try {
      cpuByPid = await this.requestCpu(rootPids);
    } catch (err) {
      // Timeouts / worker crash — skip this tick rather than blocking the loop.
      logger.warn("ActivityMonitor", "CPU sample failed", err);
      return;
    }

    const now = Date.now();
    for (const workspace of workspaces) {
      const rawCpu = workspace.pid ? cpuByPid[workspace.pid] ?? 0 : 0;
      // Exponentially smoothed CPU for hysteresis: alpha=0.4 gives enough
      // memory to ignore one-tick spikes without feeling laggy.
      const prev = this.smoothedCpu.get(workspace.id) ?? rawCpu;
      const smoothed = prev * 0.6 + rawCpu * 0.4;
      this.smoothedCpu.set(workspace.id, smoothed);

      const tier = this.computeTier(workspace, smoothed, focusedWorkspaceId);
      const last = this.lastTier.get(workspace.id);
      if (tier !== last) {
        this.lastTier.set(workspace.id, tier);
        this.options.onTierChange(workspace.id, tier, smoothed);
      }
      this.options.onSample({
        workspaceId: workspace.id,
        cpuPercent: smoothed,
        tier,
        terminalActive: workspace.terminalActive,
        terminalProgress: workspace.terminalProgress,
        agentLock: workspace.agentLock,
        sampledAt: now,
      });
    }
  }

  /**
   * Tier decision with hysteresis. `background-active` promotes at 1% CPU
   * but does not demote back to `idle` until CPU drops below 0.3% — prevents
   * rapid flapping when a lightly-active workspace oscillates around 1%.
   */
  private computeTier(
    workspace: WorkspaceInfo,
    cpuPercent: number,
    focusedWorkspaceId: string | undefined,
  ): WorkspaceInfo["resourceTier"] {
    if (focusedWorkspaceId === workspace.id) {
      return "focused";
    }

    const isExplicitlyActive =
      workspace.terminalActive ||
      workspace.terminalProgress === "working" ||
      workspace.terminalProgress === "completed" ||
      workspace.agentLock;

    if (isExplicitlyActive) return "background-active";

    const previous = this.lastTier.get(workspace.id);
    const activeThreshold = previous === "background-active" ? 0.3 : 1.0;
    return cpuPercent > activeThreshold ? "background-active" : "idle";
  }
}
