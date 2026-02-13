const { contextBridge, ipcRenderer } = require("electron");

const omniAPI = {
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
  setAgentLock: (workspaceId, locked) => ipcRenderer.invoke("workspace:setAgentLock", workspaceId, locked),
  setTerminalActivity: (workspaceId, active) => ipcRenderer.invoke("workspace:setTerminalActivity", workspaceId, active),
  reportPtyOutput: (workspaceId) => ipcRenderer.invoke("workspace:ptyOutput", workspaceId),
  startTerminal: (workspaceId) => ipcRenderer.invoke("workspace:terminal:start", workspaceId),
  sendTerminalInput: (workspaceId, data) => ipcRenderer.invoke("workspace:terminal:input", workspaceId, data),
  resizeTerminal: (workspaceId, cols, rows) => ipcRenderer.invoke("workspace:terminal:resize", workspaceId, cols, rows),
  listKeys: () => ipcRenderer.invoke("keys:list"),
  listProtocolDiagnostics: (limit) => ipcRenderer.invoke("diagnostics:protocol:list", limit),
  listRestoreDiagnostics: (limit) => ipcRenderer.invoke("diagnostics:restore:list", limit),
  listActivityDiagnostics: (workspaceId, limit) => ipcRenderer.invoke("diagnostics:activity:list", workspaceId, limit),
  setKey: (provider, value) => ipcRenderer.invoke("keys:set", provider, value),
  deleteKey: (provider) => ipcRenderer.invoke("keys:delete", provider),
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
    const wrapped = (_event, workspaceId, data) => listener(workspaceId, data);
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
