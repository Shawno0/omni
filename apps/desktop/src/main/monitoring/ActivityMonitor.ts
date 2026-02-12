import pidusage from "pidusage";
import pidtree from "pidtree";
import type { WorkspaceInfo } from "../types.js";

export interface ActivityMonitorOptions {
  getWorkspaces: () => WorkspaceInfo[];
  getFocusedWorkspaceId: () => string | undefined;
  onTierChange: (workspaceId: string, tier: WorkspaceInfo["resourceTier"], cpuPercent: number) => void;
  onSample: (sample: {
    workspaceId: string;
    cpuPercent: number;
    tier: WorkspaceInfo["resourceTier"];
    terminalActive: boolean;
    agentLock: boolean;
    sampledAt: number;
  }) => void;
}

export class ActivityMonitor {
  private timer: NodeJS.Timeout | null = null;

  public constructor(private readonly options: ActivityMonitorOptions) {}

  public start(): void {
    this.stop();
    this.timer = setInterval(() => {
      void this.sample();
    }, 2000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sample(): Promise<void> {
    const focusedWorkspaceId = this.options.getFocusedWorkspaceId();
    const workspaces = this.options.getWorkspaces();

    for (const workspace of workspaces) {
      const cpuPercent = workspace.pid
        ? await this.measureProcessTreeCpu(workspace.pid)
        : 0;

      const tier = this.computeTier(workspace, cpuPercent, focusedWorkspaceId);
      this.options.onTierChange(workspace.id, tier, cpuPercent);
      this.options.onSample({
        workspaceId: workspace.id,
        cpuPercent,
        tier,
        terminalActive: workspace.terminalActive,
        agentLock: workspace.agentLock,
        sampledAt: Date.now(),
      });
    }
  }

  private async measureProcessTreeCpu(rootPid: number): Promise<number> {
    try {
      const pids = await pidtree(rootPid, { root: true });
      if (!Array.isArray(pids) || pids.length === 0) {
        return 0;
      }

      const stats = await pidusage(pids);
      if (typeof stats === "object" && stats !== null) {
        return Object.values(stats as Record<string, { cpu?: number }>)
          .map((entry) => Number(entry.cpu) || 0)
          .reduce((total, value) => total + value, 0);
      }

      return 0;
    } catch {
      return 0;
    }
  }

  private computeTier(
    workspace: WorkspaceInfo,
    cpuPercent: number,
    focusedWorkspaceId: string | undefined,
  ): WorkspaceInfo["resourceTier"] {
    if (focusedWorkspaceId === workspace.id) {
      return "focused";
    }

    const active = cpuPercent > 1 || workspace.terminalActive || workspace.agentLock;
    if (active) {
      return "background-active";
    }

    return "idle";
  }
}
