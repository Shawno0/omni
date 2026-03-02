/**
 * IMPORTANT:
 * This CommonJS preload bridge is the runtime-loaded entrypoint.
 * `apps/desktop/src/preload/preload.ts` is the typed source reference.
 * Any API added/changed/removed in either file MUST be mirrored in the other.
 */
const { contextBridge, ipcRenderer } = require("electron");

const omniAPI = {
  browseFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  listWorkspaces: () => ipcRenderer.invoke("workspace:list"),
  listWorkspaceLogs: (workspaceId, limit) => ipcRenderer.invoke("workspace:logs:list", workspaceId, limit),
  createWorkspace: (input) => ipcRenderer.invoke("workspace:create", input),
  startWorkspace: (workspaceId) => ipcRenderer.invoke("workspace:start", workspaceId),
  restartWorkspace: (workspaceId) => ipcRenderer.invoke("workspace:restart", workspaceId),
  openWorkspace: (workspaceId) => ipcRenderer.invoke("workspace:open", workspaceId),
  focusWorkspace: (workspaceId) => ipcRenderer.invoke("workspace:focus", workspaceId),
  stopWorkspace: (workspaceId) => ipcRenderer.invoke("workspace:stop", workspaceId),
  disposeWorkspace: (workspaceId) => ipcRenderer.invoke("workspace:dispose", workspaceId),
  setAppPort: (workspaceId, appPort) => ipcRenderer.invoke("workspace:setAppPort", workspaceId, appPort),
  setIdeTheme: (themeName) => ipcRenderer.invoke("workspace:ideTheme:set", themeName),
  setBrowserState: (workspaceId, browserTabs, activeBrowserTab) =>
    ipcRenderer.invoke("workspace:browserState:set", workspaceId, browserTabs, activeBrowserTab),
  setAgentLock: (workspaceId, locked) => ipcRenderer.invoke("workspace:setAgentLock", workspaceId, locked),
  setTerminalActivity: (workspaceId, active) => ipcRenderer.invoke("workspace:setTerminalActivity", workspaceId, active),
  reportPtyOutput: (workspaceId) => ipcRenderer.invoke("workspace:ptyOutput", workspaceId),
  startTerminal: (workspaceId, terminalId) => ipcRenderer.invoke("workspace:terminal:start", workspaceId, terminalId),
  listTerminals: (workspaceId) => ipcRenderer.invoke("workspace:terminal:list", workspaceId),
  createTerminal: (workspaceId, name) => ipcRenderer.invoke("workspace:terminal:create", workspaceId, name),
  renameTerminal: (workspaceId, terminalId, name) =>
    ipcRenderer.invoke("workspace:terminal:rename", workspaceId, terminalId, name),
  setActiveTerminal: (workspaceId, terminalId) =>
    ipcRenderer.invoke("workspace:terminal:setActive", workspaceId, terminalId),
  closeTerminal: (workspaceId, terminalId) =>
    ipcRenderer.invoke("workspace:terminal:close", workspaceId, terminalId),
  sendTerminalInput: (workspaceId, terminalId, data) =>
    ipcRenderer.invoke("workspace:terminal:input", workspaceId, terminalId, data),
  resizeTerminal: (workspaceId, terminalId, cols, rows) =>
    ipcRenderer.invoke("workspace:terminal:resize", workspaceId, terminalId, cols, rows),
  listKeys: () => ipcRenderer.invoke("keys:list"),
  listProtocolDiagnostics: (limit) => ipcRenderer.invoke("diagnostics:protocol:list", limit),
  listRestoreDiagnostics: (limit) => ipcRenderer.invoke("diagnostics:restore:list", limit),
  listActivityDiagnostics: (workspaceId, limit) => ipcRenderer.invoke("diagnostics:activity:list", workspaceId, limit),
  setKey: (provider, value) => ipcRenderer.invoke("keys:set", provider, value),
  deleteKey: (provider) => ipcRenderer.invoke("keys:delete", provider),
  toggleDevTools: () => ipcRenderer.invoke("devtools:toggle"),
  onWorkspacesUpdated: (listener) => {
    const eventName = "workspaces:updated";
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
  onWorkspaceLog: (listener) => {
    const eventName = "workspace:log";
    const wrapped = (_event, workspaceId, stream, chunk) => listener(workspaceId, stream, chunk);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
  onTerminalData: (listener) => {
    const eventName = "workspace:terminal:data";
    const wrapped = (_event, workspaceId, terminalId, data) => listener(workspaceId, terminalId, data);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
  onProtocolDiagnosticsUpdated: (listener) => {
    const eventName = "diagnostics:protocol:updated";
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
  onActivityDiagnosticsUpdated: (listener) => {
    const eventName = "diagnostics:activity:updated";
    const wrapped = (_event, workspaceId, payload) => listener(workspaceId, payload);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
  onRestoreDiagnosticsUpdated: (listener) => {
    const eventName = "diagnostics:restore:updated";
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
};

contextBridge.exposeInMainWorld("omniAPI", omniAPI);
