import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { IpcChannels, AI_PROVIDERS, AI_PROVIDER_META, type AiProvider, type OmniErrorRecord, type RestoreDiagnosticEvent } from "@omni/shared";
import { WorkspaceManager } from "./workspaces/WorkspaceManager.js";
import { ProtocolInterceptor } from "./network/ProtocolInterceptor.js";
import { ActivityMonitor } from "./monitoring/ActivityMonitor.js";
import { PTYActivityBridge } from "./monitoring/PTYActivityBridge.js";
import { PTYHeartbeatServer } from "./monitoring/PTYHeartbeatServer.js";
import { KeyVault } from "./security/KeyVault.js";
import { SessionStore } from "./state/SessionStore.js";
import { VibeOverlayManager } from "./vibe/VibeOverlayManager.js";
import { logger } from "./diagnostics/Logger.js";
import type { WorkspaceCreateInput, WorkspaceInfo } from "./types.js";
import type { TerminalSessionInfo } from "./workspaces/WorkspaceManager.js";


const ptyActivityBridge = new PTYActivityBridge({
  onTerminalActivity: (workspaceId, active) => {
    try {
      workspaceManager.setTerminalActivity(workspaceId, active);
      broadcastWorkspacePatch(workspaceId);
    } catch {
      // Workspace may have been disposed before bridge update.
    }
  },
  onTerminalProgress: (workspaceId, progress) => {
    try {
      workspaceManager.setTerminalProgress(workspaceId, progress);
      broadcastWorkspacePatch(workspaceId);
    } catch {
      // Workspace may have been disposed before bridge update.
    }
  },
});

/** Safely send IPC to the shell window — no-op if window is destroyed or gone. */
function safeSend(channel: string, ...args: unknown[]): void {
  if (shellWindow && !shellWindow.isDestroyed()) {
    shellWindow.webContents.send(channel, ...args);
  }
}

function getTerminalSnapshot(workspaceId: string): {
  terminals: TerminalSessionInfo[];
  activeTerminalId: string | undefined;
} {
  return {
    terminals: workspaceManager.listTerminals(workspaceId),
    activeTerminalId: workspaceManager.getActiveTerminal(workspaceId)?.id,
  };
}

const workspaceManager = new WorkspaceManager({
  onProcessOutput: (workspaceId, stream, chunk) => {
    safeSend(IpcChannels.EventWorkspaceLog, workspaceId, stream, chunk);
  },
  onTerminalOutput: (workspaceId, terminalId, data) => {
    ptyActivityBridge.recordOutput(workspaceId);
    safeSend(IpcChannels.EventTerminalData, workspaceId, terminalId, data);
  },
});
const ptyHeartbeatServer = new PTYHeartbeatServer({
  onHeartbeat: (workspaceId) => {
    ptyActivityBridge.recordOutput(workspaceId);
  },
  validateToken: (workspaceId, token) => {
    const workspace = workspaceManager.get(workspaceId);
    if (!workspace) {
      return false;
    }
    return workspace.token === token;
  },
});
const protocolInterceptor = new ProtocolInterceptor();
let keyVault: KeyVault;
let sessionStore: SessionStore;
let shellWindow: BrowserWindow | undefined;
let vibeOverlay: VibeOverlayManager | undefined;
let focusedWorkspaceId: string | undefined;
let ptyHeartbeatEndpoint: string | undefined;
/** Partitions that have already had the protocol handler installed. */
const registeredPartitions = new Set<string>();
const restoreDiagnostics: RestoreDiagnosticEvent[] = [];
const activityTimelineByWorkspace = new Map<string, Array<{
  sampledAt: number;
  cpuPercent: number;
  tier: "focused" | "background-active" | "idle";
  terminalActive: boolean;
  terminalProgress: "idle" | "working" | "completed";
  agentLock: boolean;
}>>();

const activityMonitor = new ActivityMonitor({
  getWorkspaces: () => workspaceManager.list(),
  getFocusedWorkspaceId: () => focusedWorkspaceId,
  onTierChange: (workspaceId, tier) => {
    workspaceManager.setResourceTier(workspaceId, tier);
    broadcastWorkspacePatch(workspaceId);
  },
  onSample: (sample) => {
    const bucket = activityTimelineByWorkspace.get(sample.workspaceId) ?? [];
    bucket.push(sample);
    if (bucket.length > 120) {
      bucket.shift();
    }
    activityTimelineByWorkspace.set(sample.workspaceId, bucket);
    safeSend(IpcChannels.EventActivityDiagnosticsUpdated, sample.workspaceId, bucket.slice(-40).reverse());
  },
});

/**
 * Install the Omni HTTP protocol handler on a workspace's partition session
 * and strip embedding-blocking headers. Previously only the header stripper
 * was wired in main.ts, so the `.ide` / `.local` virtual hosts were never
 * routed — webviews would fail to resolve their URLs. `ensureRegistered()`
 * is idempotent, so calling it on every start/restore/create is safe.
 */
function ensureWorkspaceNetwork(workspace: WorkspaceInfo): void {
  const partitionSession = session.fromPartition(workspace.partition);
  stripEmbeddingHeaders(partitionSession);
  if (!registeredPartitions.has(workspace.partition)) {
    protocolInterceptor.ensureRegistered(partitionSession, workspace.partition, () => workspaceManager.list());
    registeredPartitions.add(workspace.partition);
  }
}

async function persistWorkspaceState(): Promise<void> {
  const workspaces = workspaceManager.toPersistedState();
  // Never overwrite persisted sessions with an empty list unless the
  // store was already empty — this prevents accidental data loss when
  // the app exits before restore completes.
  if (workspaces.length === 0) {
    try {
      const existing = await sessionStore.load();
      if (existing.workspaces.length > 0) {
        return;
      }
    } catch {
      // If we can't read existing state, skip the save to be safe.
      return;
    }
  }
  await sessionStore.save({
    version: 2,
    focusedWorkspaceId,
    workspaces,
  });
}

function getActivityTimeline(workspaceId?: string, limit = 40): Array<{
  sampledAt: number;
  cpuPercent: number;
  tier: "focused" | "background-active" | "idle";
  terminalActive: boolean;
  terminalProgress: "idle" | "working" | "completed";
  agentLock: boolean;
}> {
  if (!workspaceId) {
    return [];
  }
  return (activityTimelineByWorkspace.get(workspaceId) ?? []).slice(-Math.max(1, limit)).reverse();
}

/**
 * Strip headers (X-Frame-Options, CSP) that prevent content from loading
 * inside webview / iframe elements. Called once per Electron Session.
 */
const strippedSessions = new WeakSet<Electron.Session>();
function stripEmbeddingHeaders(sess: Electron.Session): void {
  if (strippedSessions.has(sess)) return;
  strippedSessions.add(sess);
  sess.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (
        lower === "x-frame-options" ||
        lower === "content-security-policy" ||
        lower === "content-security-policy-report-only"
      ) {
        delete headers[key];
      }
    }
    callback({ cancel: false, responseHeaders: headers });
  });
}

function createShellWindow(): BrowserWindow {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = app.getAppPath();
  // Preload MUST be CommonJS (.cjs) because Electron's preload sandbox
  // does not support ESM, and this project uses "type": "module".
  // The canonical source is preload.cjs at the project root.
  const preloadCandidates = [
    path.join(appRoot, "preload.cjs"),
    path.join(moduleDir, "..", "..", "preload.cjs"),
    path.join(process.cwd(), "apps", "desktop", "preload.cjs"),
  ];
  const rendererCandidates = [
    path.join(appRoot, "src", "renderer", "index.html"),
    path.join(moduleDir, "..", "..", "src", "renderer", "index.html"),
    path.join(process.cwd(), "apps", "desktop", "src", "renderer", "index.html"),
  ];
  const rendererScriptCandidates = [
    path.join(appRoot, "src", "renderer", "renderer.js"),
    path.join(moduleDir, "..", "..", "src", "renderer", "renderer.js"),
    path.join(process.cwd(), "apps", "desktop", "src", "renderer", "renderer.js"),
  ];
  const iconCandidates = [
    path.join(appRoot, "logo.ico"),
    path.join(moduleDir, "..", "..", "..", "logo.ico"),
    path.join(process.cwd(), "logo.ico"),
    path.join(appRoot, "src", "renderer", "logo.svg"),
    path.join(moduleDir, "..", "..", "src", "renderer", "logo.svg"),
    path.join(process.cwd(), "apps", "desktop", "src", "renderer", "logo.svg"),
  ];

  const preloadPath = preloadCandidates.find((candidate) => fs.existsSync(candidate));
  const rendererPath = rendererCandidates.find((candidate) => fs.existsSync(candidate));
  const rendererScriptPath = rendererScriptCandidates.find((candidate) => fs.existsSync(candidate));
  const iconPath = iconCandidates.find((candidate) => fs.existsSync(candidate));

  if (!preloadPath) {
    throw new Error("Unable to locate preload script for shell window");
  }

  if (!rendererPath) {
    throw new Error("Unable to locate renderer index.html for shell window");
  }

  if (!rendererScriptPath) {
    throw new Error("Unable to locate renderer.js for shell window");
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: "#1f1f1f",
    title: "Omni",
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // Disable the preload sandbox so `require("@omni/shared")` and other
      // workspace-hoisted modules resolve through Node's normal walk-up
      // algorithm. Electron's sandboxed preload uses a restricted resolver
      // that only sees a small allowlist + relative paths, which breaks our
      // pnpm/npm workspace symlinks. Renderer isolation is still enforced by
      // contextIsolation + nodeIntegration:false; the preload simply runs in
      // a full Node context (same trust boundary as main).
      sandbox: false,
      webviewTag: true,
    },
  });

  void window.loadFile(rendererPath);

  // Auto-open DevTools in development (unpackaged) builds so renderer
  // errors are immediately visible during spot-checks.
  if (!app.isPackaged) {
    window.webContents.once("did-finish-load", () => {
      try {
        window.webContents.openDevTools({ mode: "right" });
      } catch {
        /* noop */
      }
    });
    window.webContents.on("console-message", (_event, level, message, line, source) => {
      // level: 0=verbose 1=info 2=warning 3=error
      if (level >= 2) {
        // eslint-disable-next-line no-console
        console.log(`[renderer ${level === 3 ? "error" : "warn"}] ${message} (${source}:${line})`);
      }
    });
  }

  // Handle popups from webview and shell window content.
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      // Popups from webviews (OAuth flows) must open as real Electron windows
      // that share the webview's partition session so cookies are preserved.
      if (contents.getType() === "webview") {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 600,
            height: 750,
            autoHideMenuBar: true,
          },
        };
      }
      // For the shell window itself, open in the system browser.
      if (url.startsWith("http://") || url.startsWith("https://")) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });
  });

  window.webContents.on("did-finish-load", () => {
    void (async () => {
      try {
        // Check if renderer.js has already been loaded (either fully initialized
        // or at least started loading via the <script defer> tag).
        const alreadyLoaded = await window.webContents.executeJavaScript(
          "window.__omniRendererLoaded === true || window.__omniRendererInitialized === true",
          true,
        );

        if (alreadyLoaded === true) {
          return;
        }

        const rendererSource = fs.readFileSync(rendererScriptPath, "utf8");
        await window.webContents.executeJavaScript(rendererSource, true);
      } catch {
        // best-effort bootstrap self-heal
      }
    })();
  });
  return window;
}

function broadcastWorkspaceUpdate(): void {
  safeSend(IpcChannels.EventWorkspacesUpdated, workspaceManager.list());
}

/**
 * Emit a per-workspace patch for hot paths that touch a single workspace
 * (tier change, terminal activity, agent lock, app port, browser state).
 * Renderer merges the patch into its local list rather than replacing,
 * which avoids O(n) IPC serialization on every sample tick.
 * Structural changes (create/dispose/restore) MUST still call
 * `broadcastWorkspaceUpdate()` so the renderer stays authoritative.
 */
function broadcastWorkspacePatch(workspaceId: string): void {
  const workspace = workspaceManager.get(workspaceId);
  if (!workspace) return;
  safeSend(IpcChannels.EventWorkspacePatch, workspace);
}

function broadcastErrors(events: OmniErrorRecord[]): void {
  safeSend(IpcChannels.EventErrorsUpdated, events);
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.DialogOpenFolder, async () => {
    if (!shellWindow || shellWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(shellWindow, {
      properties: ["openDirectory"],
      title: "Select Project Directory",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IpcChannels.WorkspaceList, () => workspaceManager.list());
  ipcMain.handle(IpcChannels.WorkspaceLogsList, (_event, workspaceId: string, limit?: number) =>
    workspaceManager.listLogs(workspaceId, limit),
  );
  ipcMain.handle(IpcChannels.DiagnosticsProtocolList, (_event, limit?: number) => protocolInterceptor.getDiagnostics(limit));
  ipcMain.handle(IpcChannels.DiagnosticsRestoreList, (_event, limit?: number) =>
    restoreDiagnostics.slice(-Math.max(1, limit ?? 60)).reverse(),
  );
  ipcMain.handle(IpcChannels.DiagnosticsActivityList, (_event, workspaceId?: string, limit?: number) =>
    getActivityTimeline(workspaceId, limit),
  );
  ipcMain.handle(IpcChannels.DiagnosticsErrorsList, (_event, limit?: number) => logger.list(limit ?? 60));

  ipcMain.handle(IpcChannels.WorkspaceCreate, async (_event, input: WorkspaceCreateInput) => {
    try {
      const workspace = workspaceManager.create(input);
      ensureWorkspaceNetwork(workspace);

      const started = await startWorkspaceWithProviderEnv(workspace.id);

      broadcastWorkspaceUpdate();
      await persistWorkspaceState();
      return started;
    } catch (err) {
      logger.error("workspace:create", "Failed to create workspace", err);
      throw err;
    }
  });

  ipcMain.handle(IpcChannels.WorkspaceStart, async (_event, workspaceId: string) => {
    const workspace = workspaceManager.get(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    try {
      ensureWorkspaceNetwork(workspace);
      const started = await startWorkspaceWithProviderEnv(workspace.id);
      broadcastWorkspaceUpdate();
      await persistWorkspaceState();
      return started;
    } catch (err) {
      logger.error("workspace:start", `Failed to start ${workspace.slug}`, err);
      throw err;
    }
  });

  ipcMain.handle(IpcChannels.WorkspaceRestart, async (_event, workspaceId: string) => {
    workspaceManager.stop(workspaceId);
    const workspace = workspaceManager.get(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    try {
      ensureWorkspaceNetwork(workspace);
      const restarted = await startWorkspaceWithProviderEnv(workspace.id);
      broadcastWorkspaceUpdate();
      await persistWorkspaceState();
      return restarted;
    } catch (err) {
      logger.error("workspace:restart", `Failed to restart ${workspace.slug}`, err);
      throw err;
    }
  });

  ipcMain.handle(IpcChannels.WorkspaceFocus, async (_event, workspaceId: string) => {
    // Immediately demote previously focused workspace so tiers are consistent
    if (focusedWorkspaceId && focusedWorkspaceId !== workspaceId) {
      try {
        const prev = workspaceManager.get(focusedWorkspaceId);
        if (prev) {
          const tier =
            prev.terminalActive || prev.agentLock || (prev.pid && prev.status === "running")
              ? "background-active"
              : "idle";
          workspaceManager.setResourceTier(focusedWorkspaceId, tier as WorkspaceInfo["resourceTier"]);
        }
      } catch {
        // Workspace may have been disposed.
      }
    }
    focusedWorkspaceId = workspaceId;
    workspaceManager.acknowledgeTerminalProgress(workspaceId);
    // Immediately promote the newly focused workspace
    try {
      workspaceManager.setResourceTier(workspaceId, "focused");
    } catch {
      // Workspace may not exist.
    }
    broadcastWorkspaceUpdate();
    await persistWorkspaceState();
    return workspaceManager.get(workspaceId);
  });

  ipcMain.handle(IpcChannels.WorkspaceOpen, (_event, workspaceId: string) => {
    const workspace = workspaceManager.get(workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    // Immediately demote previously focused workspace
    if (focusedWorkspaceId && focusedWorkspaceId !== workspaceId) {
      try {
        const prev = workspaceManager.get(focusedWorkspaceId);
        if (prev) {
          const tier =
            prev.terminalActive || prev.agentLock || (prev.pid && prev.status === "running")
              ? "background-active"
              : "idle";
          workspaceManager.setResourceTier(focusedWorkspaceId, tier as WorkspaceInfo["resourceTier"]);
        }
      } catch {
        // Workspace may have been disposed.
      }
    }
    focusedWorkspaceId = workspace.id;
    workspaceManager.acknowledgeTerminalProgress(workspace.id);
    workspaceManager.setResourceTier(workspaceId, "focused");
    broadcastWorkspaceUpdate();
    safeSend(IpcChannels.EventProtocolDiagnosticsUpdated, protocolInterceptor.getDiagnostics());
    void persistWorkspaceState();
    return workspace;
  });

  ipcMain.handle(IpcChannels.WorkspaceStop, async (_event, workspaceId: string) => {
    ptyActivityBridge.clear(workspaceId);
    const workspace = workspaceManager.stop(workspaceId);
    broadcastWorkspaceUpdate();
    await persistWorkspaceState();
    return workspace;
  });

  ipcMain.handle(IpcChannels.WorkspaceDispose, async (_event, workspaceId: string) => {
    ptyActivityBridge.clear(workspaceId);
    workspaceManager.dispose(workspaceId);
    activityTimelineByWorkspace.delete(workspaceId);
    if (focusedWorkspaceId === workspaceId) {
      focusedWorkspaceId = undefined;
    }
    broadcastWorkspaceUpdate();
    await persistWorkspaceState();
  });

  ipcMain.handle(IpcChannels.WorkspaceSetAppPort, async (_event, workspaceId: string, appPort: number) => {
    const workspace = workspaceManager.setAppPort(workspaceId, appPort);
    broadcastWorkspacePatch(workspaceId);
    safeSend(IpcChannels.EventProtocolDiagnosticsUpdated, protocolInterceptor.getDiagnostics());
    await persistWorkspaceState();
    return workspace;
  });

  ipcMain.handle(IpcChannels.WorkspaceSetIdeTheme, async (_event, themeName: string) => {
    workspaceManager.setIdeTheme(themeName);
    await persistWorkspaceState();
    return true;
  });

  ipcMain.handle(
    IpcChannels.WorkspaceSetBrowserState,
    async (_event, workspaceId: string, browserTabs: Array<{ id: string; label: string; url?: string; closable: boolean }>, activeBrowserTab: string) => {
      const workspace = workspaceManager.setBrowserState(workspaceId, browserTabs, activeBrowserTab);
      broadcastWorkspacePatch(workspaceId);
      await persistWorkspaceState();
      return workspace;
    },
  );

  ipcMain.handle(IpcChannels.WorkspaceSetAgentLock, async (_event, workspaceId: string, locked: boolean) => {
    const workspace = workspaceManager.setAgentLock(workspaceId, locked);
    broadcastWorkspacePatch(workspaceId);
    await persistWorkspaceState();
    return workspace;
  });

  ipcMain.handle(IpcChannels.WorkspaceSetTerminalActivity, async (_event, workspaceId: string, active: boolean) => {
    const workspace = workspaceManager.setTerminalActivity(workspaceId, active);
    broadcastWorkspacePatch(workspaceId);
    await persistWorkspaceState();
    return workspace;
  });

  ipcMain.handle(IpcChannels.WorkspacePtyOutput, (_event, workspaceId: string) => {
    ptyActivityBridge.recordOutput(workspaceId);
  });

  ipcMain.handle(IpcChannels.TerminalStart, (_event, workspaceId: string, terminalId?: string) => {
    const terminal = workspaceManager.startTerminal(workspaceId, terminalId);
    return {
      terminal,
      ...getTerminalSnapshot(workspaceId),
    };
  });

  ipcMain.handle(IpcChannels.TerminalList, (_event, workspaceId: string) => {
    return getTerminalSnapshot(workspaceId);
  });

  ipcMain.handle(IpcChannels.TerminalCreate, (_event, workspaceId: string, name?: string) => {
    const terminal = workspaceManager.createTerminal(workspaceId, name);
    workspaceManager.startTerminal(workspaceId, terminal.id);
    return {
      terminal,
      ...getTerminalSnapshot(workspaceId),
    };
  });

  ipcMain.handle(IpcChannels.TerminalRename, (_event, workspaceId: string, terminalId: string, name: string) => {
    const terminal = workspaceManager.renameTerminal(workspaceId, terminalId, name);
    return {
      terminal,
      ...getTerminalSnapshot(workspaceId),
    };
  });

  ipcMain.handle(IpcChannels.TerminalSetActive, (_event, workspaceId: string, terminalId: string) => {
    const terminal = workspaceManager.setActiveTerminal(workspaceId, terminalId);
    workspaceManager.startTerminal(workspaceId, terminal.id);
    return {
      terminal,
      ...getTerminalSnapshot(workspaceId),
    };
  });

  ipcMain.handle(IpcChannels.TerminalClose, (_event, workspaceId: string, terminalId: string) => {
    const terminals = workspaceManager.closeTerminal(workspaceId, terminalId);
    return {
      terminals,
      activeTerminalId: workspaceManager.getActiveTerminal(workspaceId)?.id,
    };
  });

  ipcMain.handle(IpcChannels.DevtoolsToggle, () => {
    if (shellWindow && !shellWindow.isDestroyed()) {
      if (shellWindow.webContents.isDevToolsOpened()) {
        shellWindow.webContents.closeDevTools();
      } else {
        shellWindow.webContents.openDevTools();
      }
    }
  });

  ipcMain.handle(IpcChannels.TerminalInput, (_event, workspaceId: string, terminalId: string, data: string) => {
    workspaceManager.sendTerminalInput(workspaceId, terminalId, data);
  });

  ipcMain.handle(IpcChannels.TerminalResize, (_event, workspaceId: string, terminalId: string, cols: number, rows: number) => {
    workspaceManager.resizeTerminal(workspaceId, terminalId, cols, rows);
  });

  ipcMain.handle(IpcChannels.KeysList, async () => keyVault.list());
  ipcMain.handle(IpcChannels.KeysSet, async (_event, provider: AiProvider, value: string) => {
    if (!AI_PROVIDERS.includes(provider)) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    await keyVault.set(provider, value);
    return keyVault.list();
  });

  ipcMain.handle(IpcChannels.KeysDelete, async (_event, provider: AiProvider) => {
    if (!AI_PROVIDERS.includes(provider)) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    await keyVault.delete(provider);
    return keyVault.list();
  });

  ipcMain.handle(IpcChannels.VibeShow, () => {
    vibeOverlay?.show();
    return true;
  });
}

async function startWorkspaceWithProviderEnv(workspaceId: string) {
  const workspace = workspaceManager.get(workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found");
  }

  const openAiKey = await keyVault.getDecrypted("openai");
  const anthropicKey = await keyVault.getDecrypted("anthropic");

  const env: NodeJS.ProcessEnv = {
    OPENAI_API_KEY: openAiKey,
    ANTHROPIC_API_KEY: anthropicKey,
  };

  // Inject env vars for every other known provider the user has a key for,
  // so AI CLIs launched inside the workspace (Gemini, Aider with OpenRouter,
  // Grok, etc.) pick them up without manual shell config.
  for (const provider of AI_PROVIDERS) {
    if (provider === "openai" || provider === "anthropic") continue;
    const value = await keyVault.getDecrypted(provider);
    if (value) {
      env[AI_PROVIDER_META[provider].envVar] = value;
    }
  }

  if (ptyHeartbeatEndpoint) {
    env.OMNI_PTY_HEARTBEAT_URL = ptyHeartbeatEndpoint;
    env.OMNI_PTY_HEARTBEAT_TOKEN = workspace.token;
  }

  return workspaceManager.start(workspace.id, env);
}

const RESTORE_CONCURRENCY = 3;
const RESTORE_TIMEOUT_MS = 20_000;

/**
 * Restore previously persisted workspaces with bounded concurrency + a
 * per-workspace timeout. The old implementation awaited starts sequentially,
 * so a single stuck workspace would wall off the rest of the user's
 * environment. We now:
 *   - Run up to `RESTORE_CONCURRENCY` workspace starts in parallel.
 *   - Race each start against a timeout and surface timeouts as diagnostic
 *     events so the renderer can show a non-blocking toast.
 *   - Call `ensureWorkspaceNetwork()` up front so the protocol handler is
 *     attached even if the code-server start fails.
 */
async function restorePersistedSessions(): Promise<void> {
  const payload = await sessionStore.load();
  focusedWorkspaceId = payload.focusedWorkspaceId;

  // Restore all workspace records up front so the renderer sees them immediately.
  const restoredWorkspaces: WorkspaceInfo[] = [];
  for (const persisted of payload.workspaces) {
    try {
      const workspace = workspaceManager.restore(persisted);
      ensureWorkspaceNetwork(workspace);
      restoredWorkspaces.push(workspace);
    } catch (err) {
      logger.error("restore", `Failed to restore persisted workspace ${persisted.slug}`, err);
      restoreDiagnostics.push({
        at: Date.now(),
        workspaceId: persisted.id,
        workspaceName: persisted.name,
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Start in parallel with bounded concurrency + timeouts.
  const queue = [...restoredWorkspaces];
  const startOne = async (workspace: WorkspaceInfo) => {
    try {
      await Promise.race([
        startWorkspaceWithProviderEnv(workspace.id),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Start timed out after ${RESTORE_TIMEOUT_MS}ms`)), RESTORE_TIMEOUT_MS),
        ),
      ]);
      restoreDiagnostics.push({
        at: Date.now(),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        status: "restored",
        message: "Workspace restored and started",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes("timed out");
      logger.warn("restore", `Workspace ${workspace.slug} restore ${isTimeout ? "timed out" : "failed"}`, err);
      restoreDiagnostics.push({
        at: Date.now(),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        status: isTimeout ? "timeout" : "failed",
        message: workspace.lastError ?? message,
      });
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < RESTORE_CONCURRENCY; i += 1) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const workspace = queue.shift();
          if (!workspace) return;
          await startOne(workspace);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

async function bootstrap(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  // Register as the default handler for the `omni://` scheme so deep links
  // from docs / onboarding flows open the app. Packaged builds get this for
  // free via electron-builder's `protocols` + Info.plist; registering at
  // runtime covers `npm run dev` on all platforms.
  if (!app.isDefaultProtocolClient("omni")) {
    try {
      app.setAsDefaultProtocolClient("omni");
    } catch (err) {
      logger.warn("bootstrap", "Failed to set as default omni:// protocol client", err);
    }
  }

  const focusShell = (): void => {
    if (!shellWindow || shellWindow.isDestroyed()) return;
    if (shellWindow.isMinimized()) shellWindow.restore();
    shellWindow.focus();
  };

  const handleDeepLink = (url: string | undefined): void => {
    if (!url || !url.startsWith("omni://")) return;
    logger.info("deep-link", `Received ${url}`);
    focusShell();
    // Forward to the renderer so future command-palette deep-link handlers
    // can route to workspaces / vibe without round-tripping through main.
    safeSend(IpcChannels.EventDeepLink, url);
  };

  app.on("second-instance", (_event, argv) => {
    focusShell();
    // On Windows/Linux the deep-link URL arrives as an argv entry in the
    // second instance — pick it up from there.
    const deepLink = argv.find((arg) => typeof arg === "string" && arg.startsWith("omni://"));
    if (deepLink) handleDeepLink(deepLink);
  });

  // macOS delivers deep links via open-url instead of argv.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // Handle a cold-start deep link on Win/Linux (mac uses open-url even at cold-start).
  const initialDeepLink = process.argv.find((arg) => typeof arg === "string" && arg.startsWith("omni://"));

  await app.whenReady();
  workspaceManager.setCodeServerUserDataRoot(path.join(app.getPath("userData"), "code-server-user-data"));
  keyVault = new KeyVault();
  sessionStore = new SessionStore();

  // Route logger snapshots to the renderer so the diagnostics toast rail stays live.
  logger.subscribe((events) => broadcastErrors(events));

  ptyHeartbeatEndpoint = await ptyHeartbeatServer.start();

  // Strip embedding-blocking headers on the default session.
  // Partition sessions are attached when workspaces are created/restored.
  stripEmbeddingHeaders(session.defaultSession);

  await restorePersistedSessions();
  registerIpc();

  shellWindow = createShellWindow();
  broadcastWorkspaceUpdate();
  shellWindow.webContents.once("did-finish-load", () => {
    safeSend(IpcChannels.EventRestoreDiagnosticsUpdated, restoreDiagnostics.slice(-60).reverse());
    broadcastErrors(logger.list(60));
    if (initialDeepLink) handleDeepLink(initialDeepLink);
  });
  activityMonitor.start();
  ptyActivityBridge.start();

  // Register the Phase 6 Vibe overlay. Prompt submission is currently a
  // stub that echoes the input back; a follow-up session will connect it
  // to the omni-bridge streaming path.
  vibeOverlay = new VibeOverlayManager({
    onCreateWorkspaceFromPath: async (projectPath) => {
      const trimmed = projectPath.trim();
      if (!trimmed) throw new Error("Folder path is empty");
      const workspace = workspaceManager.create({ projectPath: trimmed });
      ensureWorkspaceNetwork(workspace);
      try {
        await startWorkspaceWithProviderEnv(workspace.id);
      } catch (err) {
        logger.warn("VibeOverlay", `Workspace started with errors: ${err instanceof Error ? err.message : "unknown"}`);
      }
      broadcastWorkspaceUpdate();
      await persistWorkspaceState();
    },
    onPromptSubmitted: (prompt) => `echo: ${prompt}`,
  });
  vibeOverlay.registerShortcut();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      shellWindow = createShellWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    event.preventDefault();
    activityMonitor.stop();
    ptyActivityBridge.stop();
    try {
      vibeOverlay?.dispose();
    } catch {
      /* best effort */
    }
    void (async () => {
      try {
        await persistWorkspaceState();
      } catch (err) {
        logger.warn("shutdown", "Failed to persist state on quit", err);
      }
      for (const workspace of workspaceManager.list()) {
        try {
          workspaceManager.stop(workspace.id);
        } catch {
          /* best effort */
        }
      }
      try {
        await ptyHeartbeatServer.stop();
      } catch {
        /* best effort */
      }
      app.exit(0);
    })();
  });
}

void bootstrap().catch((err) => {
  console.error("[BOOTSTRAP] Fatal error:", err);
  app.quit();
});
