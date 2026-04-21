import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  buildIdeHost,
  buildLocalHost,
  createUniqueSlug,
  deriveDefaultNameFromPath,
  sanitizeSessionName,
} from "./nameResolver.js";
import { createPartitionForWorkspace } from "../isolation/partitionFactory.js";
import { createSessionToken, createWorkspaceId } from "../utils/id.js";
import { allocateAvailablePort, allocatePort, probeOpenPort, releasePort, reservePort } from "../utils/ports.js";
import { logger } from "../diagnostics/Logger.js";
import type { BrowserTabState, WorkspaceCreateInput, WorkspaceInfo } from "../types.js";
import type { PersistedBrowserTab, PersistedTerminalSession, PersistedWorkspace } from "../state/SessionStore.js";

const require = createRequire(import.meta.url);
const DEFAULT_BROWSER_TAB: BrowserTabState = {
  id: "preview",
  label: "Preview",
  closable: false,
};

interface WorkspaceRuntime {
  process: ChildProcessWithoutNullStreams | null;
  logs: string[];
  killTimer: NodeJS.Timeout | null;
}

interface WorkspaceManagerOptions {
  onProcessOutput?: (workspaceId: string, stream: "stdout" | "stderr", chunk: string) => void;
  onTerminalOutput?: (workspaceId: string, terminalId: string, data: string) => void;
}

export interface TerminalSessionInfo {
  id: string;
  name: string;
  createdAt: number;
}

interface TerminalRuntime {
  pty: import("node-pty").IPty | null;
  info: TerminalSessionInfo;
  pendingBuffer: string;
  flushTimer: NodeJS.Timeout | null;
}

interface WorkspaceTerminalState {
  activeTerminalId: string | undefined;
  terminals: Map<string, TerminalRuntime>;
  order: string[];
  counter: number;
}

export class WorkspaceManager {
  private readonly workspaces = new Map<string, WorkspaceInfo>();
  private readonly runtimes = new Map<string, WorkspaceRuntime>();
  private readonly terminals = new Map<string, WorkspaceTerminalState>();
  private codeServerUserDataRoot = path.join(process.cwd(), ".omni", "code-server-user-data");
  private preferredIdeTheme = "Default Dark Modern";

  public constructor(private readonly options: WorkspaceManagerOptions = {}) {}

  public setCodeServerUserDataRoot(rootPath: string): void {
    const normalized = rootPath.trim();
    if (!normalized) {
      return;
    }
    this.codeServerUserDataRoot = normalized;
  }

  public setIdeTheme(themeName: string): void {
    const normalized = themeName.trim();
    if (!normalized) {
      return;
    }
    this.preferredIdeTheme = normalized;
    for (const workspace of this.workspaces.values()) {
      this.writeWorkspaceThemeSettings(workspace.id);
    }
  }

  public list(): WorkspaceInfo[] {
    return Array.from(this.workspaces.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  public get(workspaceId: string): WorkspaceInfo | undefined {
    return this.workspaces.get(workspaceId);
  }

  public create(input: WorkspaceCreateInput): WorkspaceInfo {
    const rawName = input.name?.trim() || deriveDefaultNameFromPath(input.projectPath);
    const existing = new Set(this.list().map((workspace) => workspace.slug));
    const slug = createUniqueSlug(sanitizeSessionName(rawName), existing);
    const id = createWorkspaceId();
    const idePort = allocatePort();
    reservePort(idePort);

    const workspace: WorkspaceInfo = {
      id,
      name: rawName,
      slug,
      projectPath: input.projectPath,
      ideHost: buildIdeHost(slug),
      appHost: buildLocalHost(slug),
      partition: createPartitionForWorkspace(id),
      status: "stopped",
      idePort,
      appPort: undefined,
      token: createSessionToken(),
      pid: undefined,
      startedAt: undefined,
      lastError: undefined,
      terminalActive: false,
      terminalProgress: "idle",
      agentLock: false,
      resourceTier: "idle",
      browserTabs: [
        {
          ...DEFAULT_BROWSER_TAB,
        },
      ],
      activeBrowserTab: "preview",
    };

    this.workspaces.set(id, workspace);
    this.runtimes.set(id, { logs: [], process: null, killTimer: null });
    this.terminals.set(id, this.createTerminalState());

    return workspace;
  }

  public restore(persisted: PersistedWorkspace): WorkspaceInfo {
    if (this.workspaces.has(persisted.id)) {
      return this.mustGet(persisted.id);
    }

    const workspace: WorkspaceInfo = {
      id: persisted.id,
      name: persisted.name,
      slug: persisted.slug,
      projectPath: persisted.projectPath,
      ideHost: buildIdeHost(persisted.slug),
      appHost: buildLocalHost(persisted.slug),
      partition: createPartitionForWorkspace(persisted.id),
      status: "stopped",
      idePort: persisted.idePort,
      appPort: persisted.appPort,
      token: persisted.token || createSessionToken(),
      pid: undefined,
      startedAt: undefined,
      lastError: undefined,
      terminalActive: false,
      terminalProgress: "idle",
      agentLock: false,
      resourceTier: "idle",
      browserTabs: this.normalizeBrowserTabs(persisted.browserTabs),
      activeBrowserTab: this.resolveActiveBrowserTab(persisted.activeBrowserTab, persisted.browserTabs),
    };

    reservePort(persisted.idePort);
    if (typeof persisted.appPort === "number") {
      reservePort(persisted.appPort);
    }

    this.workspaces.set(workspace.id, workspace);
    this.runtimes.set(workspace.id, { logs: [], process: null, killTimer: null });
    this.terminals.set(workspace.id, this.createTerminalState(persisted));
    return workspace;
  }

  public toPersistedState(): PersistedWorkspace[] {
    return this.list().map((workspace) => {
      const terminalState = this.getTerminalState(workspace.id);
      const activeTerminalId = this.getActiveTerminal(workspace.id)?.id;
      return {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        projectPath: workspace.projectPath,
        idePort: workspace.idePort,
        appPort: workspace.appPort,
        token: workspace.token,
        createdAt: workspace.startedAt ?? Date.now(),
        terminalSessions: this.listTerminals(workspace.id).map((session) => ({
          id: session.id,
          name: session.name,
          createdAt: session.createdAt,
        })),
        terminalCounter: terminalState.counter,
        browserTabs: workspace.browserTabs.map((tab) => ({
          id: tab.id,
          label: tab.label,
          closable: tab.closable,
          ...(tab.url ? { url: tab.url } : {}),
        })),
        activeBrowserTab: workspace.activeBrowserTab,
        ...(activeTerminalId ? { activeTerminalId } : {}),
      };
    });
  }

  public async start(workspaceId: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<WorkspaceInfo> {
    const workspace = this.mustGet(workspaceId);
    if (workspace.status === "running" || workspace.status === "starting") {
      return workspace;
    }

    // If the port we previously allocated is no longer bindable (another
    // process grabbed it, or the OS hasn't released it yet), re-allocate
    // one that probes cleanly. This prevents "stuck starting" on restart.
    const portAvailable = await probeOpenPort(workspace.idePort);
    if (!portAvailable) {
      logger.warn(
        "WorkspaceManager",
        `Port ${workspace.idePort} is busy for workspace ${workspace.slug}, reallocating`,
      );
      releasePort(workspace.idePort);
      try {
        workspace.idePort = await allocateAvailablePort();
      } catch (err) {
        logger.error("WorkspaceManager", "Failed to allocate a fresh IDE port", err);
        throw err;
      }
    }

    const launch = this.resolveCodeServerLaunch();
    this.writeWorkspaceThemeSettings(workspace.id);
    const args = [
      ...launch.prefixArgs,
      "--bind-addr",
      `127.0.0.1:${workspace.idePort}`,
      "--auth",
      "none",
      "--user-data-dir",
      this.getCodeServerUserDataDir(workspace.id),
      workspace.projectPath,
    ];

    workspace.status = "starting";
    workspace.lastError = undefined;

    const runtime = this.runtimes.get(workspace.id) ?? { logs: [], process: null, killTimer: null };
    const child = spawn(launch.command, args, {
      cwd: path.dirname(workspace.projectPath),
      windowsHide: true,
      env: {
        ...process.env,
        ...extraEnv,
        PASSWORD: "",
        OMNI_WORKSPACE_ID: workspace.id,
        OMNI_WORKSPACE_SLUG: workspace.slug,
      },
      stdio: "pipe",
    });

    runtime.process = child;
    this.runtimes.set(workspace.id, runtime);
    let startupAbortReason: string | undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      runtime.logs.push(text);
      this.options.onProcessOutput?.(workspace.id, "stdout", text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      runtime.logs.push(text);
      this.options.onProcessOutput?.(workspace.id, "stderr", text);
    });

    child.on("error", (error) => {
      const reason = this.formatSpawnError(launch.command, error);
      startupAbortReason = reason;
      runtime.logs.push(`${reason}\n`);
      runtime.process = null;
      workspace.status = "error";
      workspace.pid = undefined;
      workspace.lastError = reason;
    });

    child.on("exit", (code) => {
      workspace.status = "stopped";
      workspace.pid = undefined;
      runtime.process = null;
      if (code !== 0) {
        workspace.lastError = `code-server exited with code ${code ?? "unknown"}`;
        workspace.status = "error";
      }
    });

    workspace.pid = child.pid;

    try {
      await this.waitForReadiness(workspace.idePort, () => startupAbortReason);
      workspace.status = "running";
      workspace.startedAt = Date.now();
    } catch (error) {
      workspace.status = "error";
      workspace.lastError = error instanceof Error ? error.message : "Workspace failed to start";
      if (!child.killed) {
        child.kill();
      }
      throw error;
    }

    return workspace;
  }

  public stop(workspaceId: string): WorkspaceInfo {
    const workspace = this.mustGet(workspaceId);
    const runtime = this.runtimes.get(workspaceId);
    const terminalState = this.terminals.get(workspaceId);

    if (runtime?.process) {
      this.gracefullyKill(runtime);
    }
    for (const terminal of terminalState?.terminals.values() ?? []) {
      this.disposeTerminalRuntime(terminal);
    }

    workspace.status = "stopped";
    workspace.pid = undefined;
    workspace.terminalActive = false;

    return workspace;
  }

  /**
   * Send SIGTERM, then SIGKILL after a 3s grace window. code-server can hang
   * on SIGTERM-only during extension shutdowns — without the ladder we leak
   * processes and the next start() will fail to bind the port.
   */
  private gracefullyKill(runtime: WorkspaceRuntime): void {
    const child = runtime.process;
    if (!child) return;
    if (runtime.killTimer) {
      clearTimeout(runtime.killTimer);
      runtime.killTimer = null;
    }
    try {
      child.kill("SIGTERM");
    } catch (err) {
      logger.warn("WorkspaceManager", "SIGTERM failed, attempting SIGKILL", err);
      try {
        child.kill("SIGKILL");
      } catch {
        /* process may already be gone */
      }
      runtime.process = null;
      return;
    }
    runtime.killTimer = setTimeout(() => {
      try {
        if (!child.killed) child.kill("SIGKILL");
      } catch {
        /* noop */
      }
      runtime.killTimer = null;
    }, 3_000);
    runtime.killTimer.unref?.();
    runtime.process = null;
  }

  public dispose(workspaceId: string): void {
    const runtime = this.runtimes.get(workspaceId);
    const terminalState = this.terminals.get(workspaceId);
    const workspace = this.workspaces.get(workspaceId);

    if (runtime) {
      this.gracefullyKill(runtime);
    }
    for (const terminal of terminalState?.terminals.values() ?? []) {
      this.disposeTerminalRuntime(terminal);
    }

    if (workspace) {
      releasePort(workspace.idePort);
      if (typeof workspace.appPort === "number") releasePort(workspace.appPort);
    }

    this.workspaces.delete(workspaceId);
    this.runtimes.delete(workspaceId);
    this.terminals.delete(workspaceId);
  }

  private disposeTerminalRuntime(terminal: TerminalRuntime): void {
    if (terminal.flushTimer) {
      clearTimeout(terminal.flushTimer);
      terminal.flushTimer = null;
    }
    terminal.pendingBuffer = "";
    try {
      terminal.pty?.kill();
    } catch {
      /* already gone */
    }
    terminal.pty = null;
  }

  public listTerminals(workspaceId: string): TerminalSessionInfo[] {
    const state = this.getTerminalState(workspaceId);
    return state.order
      .map((terminalId) => state.terminals.get(terminalId)?.info)
      .filter((info): info is TerminalSessionInfo => Boolean(info));
  }

  public getActiveTerminal(workspaceId: string): TerminalSessionInfo | undefined {
    const state = this.getTerminalState(workspaceId);
    if (!state.activeTerminalId) {
      return undefined;
    }
    return state.terminals.get(state.activeTerminalId)?.info;
  }

  public createTerminal(workspaceId: string, name?: string): TerminalSessionInfo {
    this.mustGet(workspaceId);
    const state = this.getTerminalState(workspaceId);
    const runtime = this.createTerminalRuntime(state, name);
    state.terminals.set(runtime.info.id, runtime);
    state.order.push(runtime.info.id);
    state.activeTerminalId = runtime.info.id;
    return runtime.info;
  }

  public renameTerminal(workspaceId: string, terminalId: string, name: string): TerminalSessionInfo {
    this.mustGet(workspaceId);
    const state = this.getTerminalState(workspaceId);
    const runtime = this.getTerminalRuntime(state, terminalId);
    const normalized = name.trim();
    runtime.info.name = normalized.length > 0 ? normalized : runtime.info.name;
    return runtime.info;
  }

  public setActiveTerminal(workspaceId: string, terminalId: string): TerminalSessionInfo {
    this.mustGet(workspaceId);
    const state = this.getTerminalState(workspaceId);
    const runtime = this.getTerminalRuntime(state, terminalId);
    state.activeTerminalId = runtime.info.id;
    return runtime.info;
  }

  public closeTerminal(workspaceId: string, terminalId: string): TerminalSessionInfo[] {
    this.mustGet(workspaceId);
    const state = this.getTerminalState(workspaceId);
    const runtime = this.getTerminalRuntime(state, terminalId);

    this.disposeTerminalRuntime(runtime);
    state.terminals.delete(terminalId);
    state.order = state.order.filter((id) => id !== terminalId);

    if (state.activeTerminalId === terminalId) {
      state.activeTerminalId = state.order[state.order.length - 1];
    }

    if (state.order.length === 0) {
      const replacement = this.createTerminalRuntime(state);
      state.terminals.set(replacement.info.id, replacement);
      state.order.push(replacement.info.id);
      state.activeTerminalId = replacement.info.id;
    }

    return this.listTerminals(workspaceId);
  }

  public startTerminal(workspaceId: string, terminalId?: string): TerminalSessionInfo {
    const workspace = this.mustGet(workspaceId);
    const state = this.getTerminalState(workspaceId);
    if (!terminalId) {
      terminalId = state.activeTerminalId;
    }
    if (!terminalId) {
      const created = this.createTerminal(workspaceId);
      terminalId = created.id;
    }

    const terminal = this.getTerminalRuntime(state, terminalId);
    state.activeTerminalId = terminalId;

    if (terminal.pty) {
      return terminal.info;
    }

    const emit = (msg: string) => this.options.onTerminalOutput?.(workspace.id, terminal.info.id, msg);
    // Batched emitter: PTYs frequently produce output char-by-char during
    // interactive sessions, and per-char IPC hops are the dominant cost during
    // log storms (e.g. `npm install`). Coalesce bytes on a ~16ms window.
    const emitBatched = (chunk: string) => {
      terminal.pendingBuffer += chunk;
      if (terminal.pendingBuffer.length > 64 * 1024) {
        const buffered = terminal.pendingBuffer;
        terminal.pendingBuffer = "";
        if (terminal.flushTimer) {
          clearTimeout(terminal.flushTimer);
          terminal.flushTimer = null;
        }
        emit(buffered);
        return;
      }
      if (terminal.flushTimer) return;
      terminal.flushTimer = setTimeout(() => {
        terminal.flushTimer = null;
        const buffered = terminal.pendingBuffer;
        terminal.pendingBuffer = "";
        if (buffered.length > 0) emit(buffered);
      }, 16);
      terminal.flushTimer.unref?.();
    };

    try {
      emit("\x1b[90m[omni] Loading node-pty...\x1b[0m\r\n");
      const nodePty = require("node-pty") as typeof import("node-pty");

      const shell = this.resolveTerminalShell();
      const cwd = workspace.projectPath || process.cwd();
      emit(`\x1b[90m[omni] Spawning ${shell.command} in ${cwd}\x1b[0m\r\n`);

      const ptyProcess = nodePty.spawn(shell.command, shell.args, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd,
        env: {
          ...process.env,
          OMNI_WORKSPACE_ID: workspace.id,
          OMNI_WORKSPACE_SLUG: workspace.slug,
        } as Record<string, string>,
      });

      emit(`\x1b[90m[omni] PTY spawned (PID ${ptyProcess.pid})\x1b[0m\r\n`);

      ptyProcess.onData((data: string) => {
        emitBatched(data);
      });

      ptyProcess.onExit(() => {
        const terminalState = this.terminals.get(workspace.id);
        const runtime = terminalState?.terminals.get(terminal.info.id);
        if (runtime) {
          runtime.pty = null;
        }
      });

      terminal.pty = ptyProcess;
      state.terminals.set(terminal.info.id, terminal);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : "Unknown error starting terminal";
      emit(`\x1b[31m[omni] Failed to start terminal:\r\n${message}\x1b[0m\r\n`);
    }

    return terminal.info;
  }

  public sendTerminalInput(workspaceId: string, terminalId: string, data: string): void {
    const state = this.getTerminalState(workspaceId);
    const terminal = state.terminals.get(terminalId);
    if (!terminal?.pty) {
      this.startTerminal(workspaceId, terminalId);
    }

    const runtime = state.terminals.get(terminalId);
    if (!runtime?.pty) {
      throw new Error("Terminal is not available for this workspace");
    }

    runtime.pty.write(data);
  }

  public resizeTerminal(workspaceId: string, terminalId: string, cols: number, rows: number): void {
    const state = this.getTerminalState(workspaceId);
    const terminal = state.terminals.get(terminalId);
    if (terminal?.pty) {
      terminal.pty.resize(cols, rows);
    }
  }

  public setAppPort(workspaceId: string, appPort: number): WorkspaceInfo {
    const workspace = this.mustGet(workspaceId);
    if (typeof workspace.appPort === "number" && workspace.appPort !== appPort) {
      releasePort(workspace.appPort);
    }
    workspace.appPort = appPort;
    reservePort(appPort);
    return workspace;
  }

  public setAgentLock(workspaceId: string, locked: boolean): WorkspaceInfo {
    const workspace = this.mustGet(workspaceId);
    workspace.agentLock = locked;
    return workspace;
  }

  public setTerminalActivity(workspaceId: string, active: boolean): WorkspaceInfo {
    const workspace = this.mustGet(workspaceId);
    workspace.terminalActive = active;
    return workspace;
  }

  public setTerminalProgress(workspaceId: string, progress: WorkspaceInfo["terminalProgress"]): WorkspaceInfo {
    const workspace = this.mustGet(workspaceId);
    workspace.terminalProgress = progress;
    return workspace;
  }

  public acknowledgeTerminalProgress(workspaceId: string): WorkspaceInfo {
    const workspace = this.mustGet(workspaceId);
    if (workspace.terminalProgress === "completed") {
      workspace.terminalProgress = "idle";
    }
    return workspace;
  }

  public setBrowserState(workspaceId: string, browserTabs: BrowserTabState[], activeBrowserTab: string): WorkspaceInfo {
    const workspace = this.mustGet(workspaceId);
    const normalizedTabs = this.normalizeBrowserTabs(browserTabs);
    workspace.browserTabs = normalizedTabs;
    workspace.activeBrowserTab = this.resolveActiveBrowserTab(activeBrowserTab, normalizedTabs);
    return workspace;
  }

  public setResourceTier(workspaceId: string, resourceTier: WorkspaceInfo["resourceTier"]): WorkspaceInfo {
    const workspace = this.mustGet(workspaceId);
    workspace.resourceTier = resourceTier;
    return workspace;
  }

  public listLogs(workspaceId: string, limit = 200): string[] {
    const runtime = this.runtimes.get(workspaceId);
    if (!runtime) {
      return [];
    }

    const max = Math.max(1, limit);
    return runtime.logs.slice(-max);
  }

  private mustGet(workspaceId: string): WorkspaceInfo {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    return workspace;
  }

  private async waitForReadiness(port: number, getAbortReason?: () => string | undefined): Promise<void> {
    const startedAt = Date.now();
    const timeoutMs = 25_000;

    while (Date.now() - startedAt < timeoutMs) {
      const abortReason = getAbortReason?.();
      if (abortReason) {
        throw new Error(abortReason);
      }

      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`);
        if (response.ok || response.status === 404 || response.status === 401) {
          return;
        }
      } catch {
        // Continue polling until timeout.
      }

      await delay(500);
    }

    throw new Error("Timed out waiting for code-server readiness");
  }

  private formatSpawnError(command: string, error: unknown): string {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return `code-server command not found: ${command}. Bundled code-server was not resolved. Reinstall dependencies or set OMNI_CODE_SERVER_BIN to an executable path.`;
    }

    if (err?.message) {
      return `Failed to start code-server: ${err.message}`;
    }

    return "Failed to start code-server";
  }

  private resolveCodeServerLaunch(): { command: string; prefixArgs: string[] } {
    const explicitBin = process.env.OMNI_CODE_SERVER_BIN?.trim();
    if (explicitBin) {
      return this.commandOrNodeScript(explicitBin);
    }

    const bundled = this.resolveBundledCodeServerBin();
    if (bundled) {
      return this.commandOrNodeScript(bundled);
    }

    return {
      command: "code-server",
      prefixArgs: [],
    };
  }

  private commandOrNodeScript(binPath: string): { command: string; prefixArgs: string[] } {
    const ext = path.extname(binPath).toLowerCase();
    if (ext === ".js" || ext === ".cjs" || ext === ".mjs") {
      return {
        command: process.execPath,
        prefixArgs: [binPath],
      };
    }

    return {
      command: binPath,
      prefixArgs: [],
    };
  }

  private resolveBundledCodeServerBin(): string | undefined {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const candidateBins = [
      path.join(process.cwd(), "apps", "desktop", "vendor", "code-server", "out", "node", "entry.js"),
      path.join(process.cwd(), "apps", "desktop", "vendor", "code-server", "bin", "code-server.cmd"),
      path.join(process.cwd(), "apps", "desktop", "vendor", "code-server", "bin", "code-server"),
      path.join(process.resourcesPath, "app.asar.unpacked", "vendor", "code-server", "out", "node", "entry.js"),
      path.join(process.resourcesPath, "app.asar.unpacked", "vendor", "code-server", "bin", "code-server.cmd"),
      path.join(process.resourcesPath, "app.asar.unpacked", "vendor", "code-server", "bin", "code-server"),
      path.join(moduleDir, "..", "..", "..", "vendor", "code-server", "out", "node", "entry.js"),
      path.join(moduleDir, "..", "..", "..", "vendor", "code-server", "bin", "code-server.cmd"),
      path.join(moduleDir, "..", "..", "..", "vendor", "code-server", "bin", "code-server"),
    ];

    for (const candidate of candidateBins) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    try {
      const packageJsonPath = require.resolve("code-server/package.json");
      const packageDir = path.dirname(packageJsonPath);
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
        bin?: string | Record<string, string>;
      };

      let relativeBin: string | undefined;
      if (typeof packageJson.bin === "string") {
        relativeBin = packageJson.bin;
      } else if (packageJson.bin && typeof packageJson.bin === "object") {
        relativeBin = packageJson.bin["code-server"];
      }

      if (!relativeBin) {
        return undefined;
      }

      const absoluteBin = path.resolve(packageDir, relativeBin);
      if (!fs.existsSync(absoluteBin)) {
        return undefined;
      }

      return absoluteBin;
    } catch {
      return undefined;
    }
  }

  private resolveTerminalShell(): { command: string; args: string[] } {
    if (process.platform === "win32") {
      // Prefer PowerShell for better PTY support on Windows
      const pwsh = process.env.ProgramFiles ? `${process.env.ProgramFiles}\\PowerShell\\7\\pwsh.exe` : "";
      if (pwsh && fs.existsSync(pwsh)) {
        return { command: pwsh, args: ["-NoLogo"] };
      }
      // Fall back to Windows PowerShell, then cmd.exe
      const winPowershell = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
      if (fs.existsSync(winPowershell)) {
        return { command: winPowershell, args: ["-NoLogo"] };
      }
      return { command: process.env.COMSPEC || "cmd.exe", args: [] };
    }

    const command = process.env.SHELL || "bash";
    return { command, args: [] };
  }

  private getCodeServerUserDataDir(workspaceId: string): string {
    return path.join(this.codeServerUserDataRoot, workspaceId);
  }

  private writeWorkspaceThemeSettings(workspaceId: string): void {
    try {
      const userDataDir = this.getCodeServerUserDataDir(workspaceId);
      const userSettingsDir = path.join(userDataDir, "User");
      const settingsPath = path.join(userSettingsDir, "settings.json");
      fs.mkdirSync(userSettingsDir, { recursive: true });

      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          const content = fs.readFileSync(settingsPath, "utf8");
          const parsed = JSON.parse(content) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            settings = parsed as Record<string, unknown>;
          }
        } catch {
          settings = {};
        }
      }

      settings["workbench.colorTheme"] = this.preferredIdeTheme;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    } catch {
      // Best-effort settings sync only.
    }
  }

  private getTerminalState(workspaceId: string): WorkspaceTerminalState {
    const state = this.terminals.get(workspaceId);
    if (!state) {
      throw new Error(`Terminal state not found for workspace ${workspaceId}`);
    }

    return state;
  }

  private getTerminalRuntime(state: WorkspaceTerminalState, terminalId: string): TerminalRuntime {
    const runtime = state.terminals.get(terminalId);
    if (!runtime) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }

    return runtime;
  }

  private createTerminalRuntime(state: WorkspaceTerminalState, name?: string): TerminalRuntime {
    state.counter += 1;
    const resolvedName = name?.trim() || `Terminal ${state.counter}`;
    return {
      pty: null,
      pendingBuffer: "",
      flushTimer: null,
      info: {
        id: crypto.randomUUID(),
        name: resolvedName,
        createdAt: Date.now(),
      },
    };
  }

  private createTerminalState(persisted?: PersistedWorkspace): WorkspaceTerminalState {
    const state: WorkspaceTerminalState = {
      activeTerminalId: undefined,
      terminals: new Map(),
      order: [],
      counter: 0,
    };

    const persistedCounter = persisted?.terminalCounter;
    if (typeof persistedCounter === "number" && Number.isFinite(persistedCounter) && persistedCounter > 0) {
      state.counter = Math.floor(persistedCounter);
    }

    const sessions = persisted?.terminalSessions ?? [];
    for (const session of sessions) {
      if (!this.isValidPersistedTerminal(session)) {
        continue;
      }

      const runtime: TerminalRuntime = {
        pty: null,
        pendingBuffer: "",
        flushTimer: null,
        info: {
          id: session.id,
          name: session.name,
          createdAt: session.createdAt,
        },
      };

      if (state.terminals.has(runtime.info.id)) {
        continue;
      }

      state.terminals.set(runtime.info.id, runtime);
      state.order.push(runtime.info.id);
    }

    if (persisted?.activeTerminalId && state.terminals.has(persisted.activeTerminalId)) {
      state.activeTerminalId = persisted.activeTerminalId;
    } else if (state.order.length > 0) {
      state.activeTerminalId = state.order[state.order.length - 1];
    }

    return state;
  }

  private isValidPersistedTerminal(session: PersistedTerminalSession): boolean {
    return (
      typeof session.id === "string" &&
      session.id.length > 0 &&
      typeof session.name === "string" &&
      session.name.trim().length > 0 &&
      typeof session.createdAt === "number"
    );
  }

  private normalizeBrowserTabs(tabs: PersistedBrowserTab[] | BrowserTabState[] | undefined): BrowserTabState[] {
    const normalized: BrowserTabState[] = [];

    for (const tab of tabs ?? []) {
      if (!tab || typeof tab.id !== "string" || typeof tab.label !== "string" || typeof tab.closable !== "boolean") {
        continue;
      }
      const cleanId = tab.id.trim();
      const cleanLabel = tab.label.trim();
      if (!cleanId || !cleanLabel) {
        continue;
      }

      if (normalized.some((existing) => existing.id === cleanId)) {
        continue;
      }

      normalized.push({
        id: cleanId,
        label: cleanLabel,
        closable: cleanId === "preview" ? false : tab.closable,
        ...(typeof tab.url === "string" && tab.url.trim().length > 0 ? { url: tab.url } : {}),
      });
    }

    if (!normalized.some((tab) => tab.id === "preview")) {
      normalized.unshift({
        ...DEFAULT_BROWSER_TAB,
      });
    }

    return normalized;
  }

  private resolveActiveBrowserTab(activeBrowserTab: string | undefined, tabs: PersistedBrowserTab[] | BrowserTabState[] | undefined): string {
    const normalized = this.normalizeBrowserTabs(tabs);
    if (activeBrowserTab && normalized.some((tab) => tab.id === activeBrowserTab)) {
      return activeBrowserTab;
    }

    return "preview";
  }
}
