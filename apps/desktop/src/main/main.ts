import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { WorkspaceManager } from "./workspaces/WorkspaceManager.js";
import { ProtocolInterceptor } from "./network/ProtocolInterceptor.js";
import { ActivityMonitor } from "./monitoring/ActivityMonitor.js";
import { PTYActivityBridge } from "./monitoring/PTYActivityBridge.js";
import { PTYHeartbeatServer } from "./monitoring/PTYHeartbeatServer.js";
import { KeyVault } from "./security/KeyVault.js";
import { SessionStore } from "./state/SessionStore.js";
import type { WorkspaceCreateInput } from "./types.js";


const ptyActivityBridge = new PTYActivityBridge({
  onTerminalActivity: (workspaceId, active) => {
    try {
      workspaceManager.setTerminalActivity(workspaceId, active);
      broadcastWorkspaceUpdate();
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

const workspaceManager = new WorkspaceManager({
  onProcessOutput: (workspaceId, stream, chunk) => {
    ptyActivityBridge.recordOutput(workspaceId);
    safeSend("workspace:log", workspaceId, stream, chunk);
  },
  onTerminalOutput: (workspaceId, data) => {
    ptyActivityBridge.recordOutput(workspaceId);
    safeSend("workspace:terminal:data", workspaceId, data);
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
let focusedWorkspaceId: string | undefined;
let ptyHeartbeatEndpoint: string | undefined;
const restoreDiagnostics: Array<{
  at: number;
  workspaceId: string;
  workspaceName: string;
  status: "restored" | "failed";
  message: string;
}> = [];
const activityTimelineByWorkspace = new Map<string, Array<{
  sampledAt: number;
  cpuPercent: number;
  tier: "focused" | "background-active" | "idle";
  terminalActive: boolean;
  agentLock: boolean;
}>>();

const activityMonitor = new ActivityMonitor({
  getWorkspaces: () => workspaceManager.list(),
  getFocusedWorkspaceId: () => focusedWorkspaceId,
  onTierChange: (workspaceId, tier) => {
    workspaceManager.setResourceTier(workspaceId, tier);
    broadcastWorkspaceUpdate();
  },
  onSample: (sample) => {
    const bucket = activityTimelineByWorkspace.get(sample.workspaceId) ?? [];
    bucket.push(sample);
    if (bucket.length > 120) {
      bucket.shift();
    }
    activityTimelineByWorkspace.set(sample.workspaceId, bucket);
    safeSend("diagnostics:activity:updated", sample.workspaceId, bucket.slice(-40).reverse());
  },
});

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
    version: 1,
    focusedWorkspaceId,
    workspaces,
  });
}

function getActivityTimeline(workspaceId?: string, limit = 40): Array<{
  sampledAt: number;
  cpuPercent: number;
  tier: "focused" | "background-active" | "idle";
  terminalActive: boolean;
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
  const preloadCandidates = [
    path.join(appRoot, "preload.cjs"),
    path.join(appRoot, "dist", "preload", "preload.js"),
    path.join(moduleDir, "..", "..", "preload.cjs"),
    path.join(moduleDir, "..", "preload", "preload.js"),
    path.join(process.cwd(), "apps", "desktop", "preload.cjs"),
    path.join(process.cwd(), "apps", "desktop", "dist", "preload", "preload.js"),
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

  const preloadPath = preloadCandidates.find((candidate) => fs.existsSync(candidate));
  const rendererPath = rendererCandidates.find((candidate) => fs.existsSync(candidate));
  const rendererScriptPath = rendererScriptCandidates.find((candidate) => fs.existsSync(candidate));

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
    backgroundColor: "#0f1115",
    title: "OmniContext",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  void window.loadFile(rendererPath);

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
  safeSend("workspaces:updated", workspaceManager.list());
}

function registerIpc(): void {
  ipcMain.handle("workspace:list", () => workspaceManager.list());
  ipcMain.handle("workspace:logs:list", (_event, workspaceId: string, limit?: number) =>
    workspaceManager.listLogs(workspaceId, limit),
  );
  ipcMain.handle("diagnostics:protocol:list", (_event, limit?: number) => protocolInterceptor.getDiagnostics(limit));
  ipcMain.handle("diagnostics:restore:list", (_event, limit?: number) =>
    restoreDiagnostics.slice(-Math.max(1, limit ?? 60)).reverse(),
  );
  ipcMain.handle("diagnostics:activity:list", (_event, workspaceId?: string, limit?: number) =>
    getActivityTimeline(workspaceId, limit),
  );

  ipcMain.handle("workspace:create", async (_event, input: WorkspaceCreateInput) => {
    const workspace = workspaceManager.create(input);

    const partitionSession = session.fromPartition(workspace.partition);
    stripEmbeddingHeaders(partitionSession);

    const started = await startWorkspaceWithProviderEnv(workspace.id);

    broadcastWorkspaceUpdate();
    await persistWorkspaceState();
    return started;
  });

  ipcMain.handle("workspace:start", async (_event, workspaceId: string) => {
    const workspace = workspaceManager.get(workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const partitionSession = session.fromPartition(workspace.partition);
    stripEmbeddingHeaders(partitionSession);

    const started = await startWorkspaceWithProviderEnv(workspace.id);
    broadcastWorkspaceUpdate();
    await persistWorkspaceState();
    return started;
  });

  ipcMain.handle("workspace:restart", async (_event, workspaceId: string) => {
    workspaceManager.stop(workspaceId);
    const workspace = workspaceManager.get(workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const partitionSession = session.fromPartition(workspace.partition);
    stripEmbeddingHeaders(partitionSession);

    const restarted = await startWorkspaceWithProviderEnv(workspace.id);
    broadcastWorkspaceUpdate();
    await persistWorkspaceState();
    return restarted;
  });

  ipcMain.handle("workspace:focus", async (_event, workspaceId: string) => {
    focusedWorkspaceId = workspaceId;
    broadcastWorkspaceUpdate();
    await persistWorkspaceState();
    return workspaceManager.get(workspaceId);
  });

  ipcMain.handle("workspace:open", (_event, workspaceId: string) => {
    const workspace = workspaceManager.get(workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    focusedWorkspaceId = workspace.id;
    broadcastWorkspaceUpdate();
    safeSend("diagnostics:protocol:updated", protocolInterceptor.getDiagnostics());
    void persistWorkspaceState();
    return workspace;
  });

  ipcMain.handle("workspace:stop", async (_event, workspaceId: string) => {
    ptyActivityBridge.clear(workspaceId);
    const workspace = workspaceManager.stop(workspaceId);
    broadcastWorkspaceUpdate();
    await persistWorkspaceState();
    return workspace;
  });

  ipcMain.handle("workspace:dispose", async (_event, workspaceId: string) => {
    ptyActivityBridge.clear(workspaceId);
    workspaceManager.dispose(workspaceId);
    activityTimelineByWorkspace.delete(workspaceId);
    if (focusedWorkspaceId === workspaceId) {
      focusedWorkspaceId = undefined;
    }
    broadcastWorkspaceUpdate();
    await persistWorkspaceState();
  });

  ipcMain.handle("workspace:setAppPort", async (_event, workspaceId: string, appPort: number) => {
    const workspace = workspaceManager.setAppPort(workspaceId, appPort);
    broadcastWorkspaceUpdate();
    safeSend("diagnostics:protocol:updated", protocolInterceptor.getDiagnostics());
    await persistWorkspaceState();
    return workspace;
  });

  ipcMain.handle("workspace:setAgentLock", async (_event, workspaceId: string, locked: boolean) => {
    const workspace = workspaceManager.setAgentLock(workspaceId, locked);
    broadcastWorkspaceUpdate();
    await persistWorkspaceState();
    return workspace;
  });

  ipcMain.handle("workspace:setTerminalActivity", async (_event, workspaceId: string, active: boolean) => {
    const workspace = workspaceManager.setTerminalActivity(workspaceId, active);
    broadcastWorkspaceUpdate();
    await persistWorkspaceState();
    return workspace;
  });

  ipcMain.handle("workspace:ptyOutput", (_event, workspaceId: string) => {
    ptyActivityBridge.recordOutput(workspaceId);
  });

  ipcMain.handle("workspace:terminal:start", (_event, workspaceId: string) => {
    workspaceManager.startTerminal(workspaceId);
  });

  ipcMain.handle("devtools:toggle", () => {
    if (shellWindow && !shellWindow.isDestroyed()) {
      if (shellWindow.webContents.isDevToolsOpened()) {
        shellWindow.webContents.closeDevTools();
      } else {
        shellWindow.webContents.openDevTools();
      }
    }
  });

  ipcMain.handle("workspace:terminal:input", (_event, workspaceId: string, data: string) => {
    workspaceManager.sendTerminalInput(workspaceId, data);
  });

  ipcMain.handle("workspace:terminal:resize", (_event, workspaceId: string, cols: number, rows: number) => {
    workspaceManager.resizeTerminal(workspaceId, cols, rows);
  });

  ipcMain.handle("keys:list", async () => keyVault.list());
  ipcMain.handle("keys:set", async (_event, provider: "anthropic" | "openai", value: string) => {
    await keyVault.set(provider, value);
    return keyVault.list();
  });

  ipcMain.handle("keys:delete", async (_event, provider: "anthropic" | "openai") => {
    await keyVault.delete(provider);
    return keyVault.list();
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

  if (ptyHeartbeatEndpoint) {
    env.OMNI_PTY_HEARTBEAT_URL = ptyHeartbeatEndpoint;
    env.OMNI_PTY_HEARTBEAT_TOKEN = workspace.token;
  }

  return workspaceManager.start(workspace.id, env);
}

async function restorePersistedSessions(): Promise<void> {
  const payload = await sessionStore.load();
  focusedWorkspaceId = payload.focusedWorkspaceId;

  for (const persisted of payload.workspaces) {
    const workspace = workspaceManager.restore(persisted);
    const partitionSession = session.fromPartition(workspace.partition);
    stripEmbeddingHeaders(partitionSession);
    try {
      await startWorkspaceWithProviderEnv(workspace.id);
      restoreDiagnostics.push({
        at: Date.now(),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        status: "restored",
        message: "Workspace restored and started",
      });
    } catch {
      restoreDiagnostics.push({
        at: Date.now(),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        status: "failed",
        message: workspace.lastError ?? "Workspace restore failed",
      });
    }
  }
}

async function bootstrap(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (!shellWindow) {
      return;
    }

    if (shellWindow.isMinimized()) {
      shellWindow.restore();
    }

    shellWindow.focus();
  });

  await app.whenReady();
  keyVault = new KeyVault();
  sessionStore = new SessionStore();
  ptyHeartbeatEndpoint = await ptyHeartbeatServer.start();
  await restorePersistedSessions();
  registerIpc();

  // Strip embedding-blocking headers on the default session.
  // Partition sessions are handled when workspaces are created/restored.
  stripEmbeddingHeaders(session.defaultSession);

  shellWindow = createShellWindow();
  broadcastWorkspaceUpdate();
  shellWindow.webContents.once("did-finish-load", () => {
    safeSend("diagnostics:restore:updated", restoreDiagnostics.slice(-60).reverse());
  });
  activityMonitor.start();
  ptyActivityBridge.start();

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

  app.on("before-quit", () => {
    activityMonitor.stop();
    ptyActivityBridge.stop();
    ptyHeartbeatServer.stop();
    void persistWorkspaceState();
    for (const workspace of workspaceManager.list()) {
      workspaceManager.stop(workspace.id);
    }
  });
}

void bootstrap().catch((err) => {
  console.error("[BOOTSTRAP] Fatal error:", err);
  app.quit();
});
