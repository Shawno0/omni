/**
 * Preload bridge (CommonJS, runtime-loaded).
 *
 * Channel names are the canonical source of truth in @omni/shared's
 * IpcChannels enum; we resolve them lazily here via the built package so
 * this file stays pure CJS while the rest of the app is ESM.
 *
 * Any new channel MUST be declared in packages/shared/src/ipc.ts and used
 * via IpcChannels on both sides. Do NOT hard-code channel string literals
 * anywhere outside of `packages/shared`.
 */
const { contextBridge, ipcRenderer } = require("electron");

let CHANNELS;
try {
  ({ IpcChannels: CHANNELS } = require("@omni/shared"));
} catch (err) {
  // The desktop app always depends on @omni/shared via workspaces; if this
  // fails something is badly misconfigured. Surface early with a clear error
  // instead of silently rendering a broken bridge.
  console.error("[omni/preload] Failed to load @omni/shared:", err);
  throw err;
}

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const subscribe = (channel, handler) => {
  const wrapped = (_event, ...args) => handler(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

const omniAPI = {
  browseFolder: () => invoke(CHANNELS.DialogOpenFolder),
  listWorkspaces: () => invoke(CHANNELS.WorkspaceList),
  listWorkspaceLogs: (workspaceId, limit) => invoke(CHANNELS.WorkspaceLogsList, workspaceId, limit),
  createWorkspace: (input) => invoke(CHANNELS.WorkspaceCreate, input),
  startWorkspace: (workspaceId) => invoke(CHANNELS.WorkspaceStart, workspaceId),
  restartWorkspace: (workspaceId) => invoke(CHANNELS.WorkspaceRestart, workspaceId),
  openWorkspace: (workspaceId) => invoke(CHANNELS.WorkspaceOpen, workspaceId),
  focusWorkspace: (workspaceId) => invoke(CHANNELS.WorkspaceFocus, workspaceId),
  stopWorkspace: (workspaceId) => invoke(CHANNELS.WorkspaceStop, workspaceId),
  disposeWorkspace: (workspaceId) => invoke(CHANNELS.WorkspaceDispose, workspaceId),
  setAppPort: (workspaceId, appPort) => invoke(CHANNELS.WorkspaceSetAppPort, workspaceId, appPort),
  setIdeTheme: (themeName) => invoke(CHANNELS.WorkspaceSetIdeTheme, themeName),
  setBrowserState: (workspaceId, browserTabs, activeBrowserTab) =>
    invoke(CHANNELS.WorkspaceSetBrowserState, workspaceId, browserTabs, activeBrowserTab),
  setAgentLock: (workspaceId, locked) => invoke(CHANNELS.WorkspaceSetAgentLock, workspaceId, locked),
  setTerminalActivity: (workspaceId, active) => invoke(CHANNELS.WorkspaceSetTerminalActivity, workspaceId, active),
  reportPtyOutput: (workspaceId) => invoke(CHANNELS.WorkspacePtyOutput, workspaceId),
  startTerminal: (workspaceId, terminalId) => invoke(CHANNELS.TerminalStart, workspaceId, terminalId),
  listTerminals: (workspaceId) => invoke(CHANNELS.TerminalList, workspaceId),
  createTerminal: (workspaceId, name) => invoke(CHANNELS.TerminalCreate, workspaceId, name),
  renameTerminal: (workspaceId, terminalId, name) =>
    invoke(CHANNELS.TerminalRename, workspaceId, terminalId, name),
  setActiveTerminal: (workspaceId, terminalId) => invoke(CHANNELS.TerminalSetActive, workspaceId, terminalId),
  closeTerminal: (workspaceId, terminalId) => invoke(CHANNELS.TerminalClose, workspaceId, terminalId),
  sendTerminalInput: (workspaceId, terminalId, data) =>
    invoke(CHANNELS.TerminalInput, workspaceId, terminalId, data),
  resizeTerminal: (workspaceId, terminalId, cols, rows) =>
    invoke(CHANNELS.TerminalResize, workspaceId, terminalId, cols, rows),
  listKeys: () => invoke(CHANNELS.KeysList),
  listProtocolDiagnostics: (limit) => invoke(CHANNELS.DiagnosticsProtocolList, limit),
  listRestoreDiagnostics: (limit) => invoke(CHANNELS.DiagnosticsRestoreList, limit),
  listActivityDiagnostics: (workspaceId, limit) => invoke(CHANNELS.DiagnosticsActivityList, workspaceId, limit),
  listErrors: (limit) => invoke(CHANNELS.DiagnosticsErrorsList, limit),
  setKey: (provider, value) => invoke(CHANNELS.KeysSet, provider, value),
  deleteKey: (provider) => invoke(CHANNELS.KeysDelete, provider),
  toggleDevTools: () => invoke(CHANNELS.DevtoolsToggle),
  showVibe: () => invoke(CHANNELS.VibeShow),

  onWorkspacesUpdated: (listener) => subscribe(CHANNELS.EventWorkspacesUpdated, (payload) => listener(payload)),
  onWorkspacePatch: (listener) => subscribe(CHANNELS.EventWorkspacePatch, (payload) => listener(payload)),
  onWorkspaceLog: (listener) =>
    subscribe(CHANNELS.EventWorkspaceLog, (workspaceId, stream, chunk) => listener(workspaceId, stream, chunk)),
  onTerminalData: (listener) =>
    subscribe(CHANNELS.EventTerminalData, (workspaceId, terminalId, data) => listener(workspaceId, terminalId, data)),
  onProtocolDiagnosticsUpdated: (listener) =>
    subscribe(CHANNELS.EventProtocolDiagnosticsUpdated, (payload) => listener(payload)),
  onActivityDiagnosticsUpdated: (listener) =>
    subscribe(CHANNELS.EventActivityDiagnosticsUpdated, (workspaceId, payload) => listener(workspaceId, payload)),
  onRestoreDiagnosticsUpdated: (listener) =>
    subscribe(CHANNELS.EventRestoreDiagnosticsUpdated, (payload) => listener(payload)),
  onErrorsUpdated: (listener) => subscribe(CHANNELS.EventErrorsUpdated, (payload) => listener(payload)),
};

contextBridge.exposeInMainWorld("omniAPI", omniAPI);
