import path from "node:path";
import fs from "node:fs";
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
import { allocatePort } from "../utils/ports.js";
import type { WorkspaceCreateInput, WorkspaceInfo } from "../types.js";
import type { PersistedWorkspace } from "../state/SessionStore.js";

const require = createRequire(import.meta.url);

interface WorkspaceRuntime {
  process: ChildProcessWithoutNullStreams | null;
  logs: string[];
}

interface WorkspaceManagerOptions {
  onProcessOutput?: (workspaceId: string, stream: "stdout" | "stderr", chunk: string) => void;
  onTerminalOutput?: (workspaceId: string, stream: "stdout" | "stderr", chunk: string) => void;
}

interface TerminalRuntime {
  process: ChildProcessWithoutNullStreams | null;
}

export class WorkspaceManager {
  private readonly workspaces = new Map<string, WorkspaceInfo>();
  private readonly runtimes = new Map<string, WorkspaceRuntime>();
  private readonly terminals = new Map<string, TerminalRuntime>();

  public constructor(private readonly options: WorkspaceManagerOptions = {}) {}

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
      agentLock: false,
      resourceTier: "idle",
    };

    this.workspaces.set(id, workspace);
    this.runtimes.set(id, { logs: [], process: null });
    this.terminals.set(id, { process: null });

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
      agentLock: false,
      resourceTier: "idle",
    };

    this.workspaces.set(workspace.id, workspace);
    this.runtimes.set(workspace.id, { logs: [], process: null });
    this.terminals.set(workspace.id, { process: null });
    return workspace;
  }

  public toPersistedState(): PersistedWorkspace[] {
    return this.list().map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      projectPath: workspace.projectPath,
      idePort: workspace.idePort,
      appPort: workspace.appPort,
      token: workspace.token,
      createdAt: workspace.startedAt ?? Date.now(),
    }));
  }

  public async start(workspaceId: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<WorkspaceInfo> {
    const workspace = this.mustGet(workspaceId);
    if (workspace.status === "running" || workspace.status === "starting") {
      return workspace;
    }

    const launch = this.resolveCodeServerLaunch();
    const args = [
      ...launch.prefixArgs,
      "--bind-addr",
      `127.0.0.1:${workspace.idePort}`,
      "--auth",
      "none",
      workspace.projectPath,
    ];

    workspace.status = "starting";
    workspace.lastError = undefined;

    const runtime = this.runtimes.get(workspace.id) ?? { logs: [], process: null };
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
    const terminal = this.terminals.get(workspaceId);

    runtime?.process?.kill();
    terminal?.process?.kill();
    if (runtime) {
      runtime.process = null;
    }
    if (terminal) {
      terminal.process = null;
    }

    workspace.status = "stopped";
    workspace.pid = undefined;
    workspace.terminalActive = false;

    return workspace;
  }

  public dispose(workspaceId: string): void {
    const runtime = this.runtimes.get(workspaceId);
    const terminal = this.terminals.get(workspaceId);
    runtime?.process?.kill();
    terminal?.process?.kill();

    this.workspaces.delete(workspaceId);
    this.runtimes.delete(workspaceId);
    this.terminals.delete(workspaceId);
  }

  public startTerminal(workspaceId: string): void {
    const workspace = this.mustGet(workspaceId);
    const terminal = this.terminals.get(workspaceId) ?? { process: null };

    if (terminal.process && !terminal.process.killed) {
      return;
    }

    const shell = this.resolveTerminalShell();
    const child = spawn(shell.command, shell.args, {
      cwd: workspace.projectPath,
      windowsHide: true,
      env: {
        ...process.env,
        OMNI_WORKSPACE_ID: workspace.id,
        OMNI_WORKSPACE_SLUG: workspace.slug,
      },
      stdio: "pipe",
    });

    child.stdout.on("data", (chunk: Buffer) => {
      this.options.onTerminalOutput?.(workspace.id, "stdout", chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      this.options.onTerminalOutput?.(workspace.id, "stderr", chunk.toString("utf8"));
    });

    child.on("exit", () => {
      const runtime = this.terminals.get(workspace.id);
      if (runtime) {
        runtime.process = null;
      }
    });

    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : "Unknown terminal error";
      this.options.onTerminalOutput?.(workspace.id, "stderr", `Terminal failed to start: ${message}\n`);
    });

    terminal.process = child;
    this.terminals.set(workspace.id, terminal);
  }

  public sendTerminalInput(workspaceId: string, data: string): void {
    const terminal = this.terminals.get(workspaceId);
    if (!terminal?.process || terminal.process.killed) {
      this.startTerminal(workspaceId);
    }

    const runtime = this.terminals.get(workspaceId);
    if (!runtime?.process || runtime.process.killed) {
      throw new Error("Terminal is not available for this workspace");
    }

    runtime.process.stdin.write(data);
  }

  public setAppPort(workspaceId: string, appPort: number): WorkspaceInfo {
    const workspace = this.mustGet(workspaceId);
    workspace.appPort = appPort;
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
      const command = process.env.COMSPEC || "cmd.exe";
      return { command, args: [] };
    }

    const command = process.env.SHELL || "bash";
    return { command, args: [] };
  }
}
