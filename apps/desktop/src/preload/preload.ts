/**
 * IMPORTANT:
 * This TypeScript preload bridge is not loaded directly at runtime.
 * Electron currently loads `apps/desktop/preload.cjs`.
 * Any API added/changed/removed here MUST be mirrored in `preload.cjs`.
 */
import { contextBridge, ipcRenderer } from "electron";

const omniAPI = {
  browseFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  listWorkspaces: () => ipcRenderer.invoke("workspace:list"),
  listWorkspaceLogs: (workspaceId: string, limit?: number) => ipcRenderer.invoke("workspace:logs:list", workspaceId, limit),
  createWorkspace: (input: { projectPath: string; name?: string }) => ipcRenderer.invoke("workspace:create", input),
  startWorkspace: (workspaceId: string) => ipcRenderer.invoke("workspace:start", workspaceId),
  restartWorkspace: (workspaceId: string) => ipcRenderer.invoke("workspace:restart", workspaceId),
  openWorkspace: (workspaceId: string) => ipcRenderer.invoke("workspace:open", workspaceId),
  focusWorkspace: (workspaceId: string) => ipcRenderer.invoke("workspace:focus", workspaceId),
  stopWorkspace: (workspaceId: string) => ipcRenderer.invoke("workspace:stop", workspaceId),
  disposeWorkspace: (workspaceId: string) => ipcRenderer.invoke("workspace:dispose", workspaceId),
  setAppPort: (workspaceId: string, appPort: number) => ipcRenderer.invoke("workspace:setAppPort", workspaceId, appPort),
  setIdeTheme: (themeName: string) => ipcRenderer.invoke("workspace:ideTheme:set", themeName),
  setBrowserState: (
    workspaceId: string,
    browserTabs: Array<{ id: string; label: string; url?: string; closable: boolean }>,
    activeBrowserTab: string,
  ) => ipcRenderer.invoke("workspace:browserState:set", workspaceId, browserTabs, activeBrowserTab),
  setAgentLock: (workspaceId: string, locked: boolean) => ipcRenderer.invoke("workspace:setAgentLock", workspaceId, locked),
  setTerminalActivity: (workspaceId: string, active: boolean) => ipcRenderer.invoke("workspace:setTerminalActivity", workspaceId, active),
  reportPtyOutput: (workspaceId: string) => ipcRenderer.invoke("workspace:ptyOutput", workspaceId),
  startTerminal: (workspaceId: string, terminalId?: string) => ipcRenderer.invoke("workspace:terminal:start", workspaceId, terminalId),
  listTerminals: (workspaceId: string) => ipcRenderer.invoke("workspace:terminal:list", workspaceId),
  createTerminal: (workspaceId: string, name?: string) => ipcRenderer.invoke("workspace:terminal:create", workspaceId, name),
  renameTerminal: (workspaceId: string, terminalId: string, name: string) =>
    ipcRenderer.invoke("workspace:terminal:rename", workspaceId, terminalId, name),
  setActiveTerminal: (workspaceId: string, terminalId: string) =>
    ipcRenderer.invoke("workspace:terminal:setActive", workspaceId, terminalId),
  closeTerminal: (workspaceId: string, terminalId: string) =>
    ipcRenderer.invoke("workspace:terminal:close", workspaceId, terminalId),
  sendTerminalInput: (workspaceId: string, terminalId: string, data: string) =>
    ipcRenderer.invoke("workspace:terminal:input", workspaceId, terminalId, data),
  resizeTerminal: (workspaceId: string, terminalId: string, cols: number, rows: number) =>
    ipcRenderer.invoke("workspace:terminal:resize", workspaceId, terminalId, cols, rows),
  listKeys: () => ipcRenderer.invoke("keys:list"),
  listProtocolDiagnostics: (limit?: number) => ipcRenderer.invoke("diagnostics:protocol:list", limit),
  listRestoreDiagnostics: (limit?: number) => ipcRenderer.invoke("diagnostics:restore:list", limit),
  listActivityDiagnostics: (workspaceId?: string, limit?: number) =>
    ipcRenderer.invoke("diagnostics:activity:list", workspaceId, limit),
  setKey: (provider: "anthropic" | "openai", value: string) => ipcRenderer.invoke("keys:set", provider, value),
  deleteKey: (provider: "anthropic" | "openai") => ipcRenderer.invoke("keys:delete", provider),
  toggleDevTools: () => ipcRenderer.invoke("devtools:toggle"),
  onWorkspacesUpdated: (listener: (workspaces: unknown[]) => void) => {
    const eventName = "workspaces:updated";
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown[]) => listener(payload);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
  onWorkspaceLog: (listener: (workspaceId: string, stream: "stdout" | "stderr", chunk: string) => void) => {
    const eventName = "workspace:log";
    const wrapped = (_event: Electron.IpcRendererEvent, workspaceId: string, stream: "stdout" | "stderr", chunk: string) =>
      listener(workspaceId, stream, chunk);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
  onTerminalData: (listener: (workspaceId: string, terminalId: string, data: string) => void) => {
    const eventName = "workspace:terminal:data";
    const wrapped = (_event: Electron.IpcRendererEvent, workspaceId: string, terminalId: string, data: string) =>
      listener(workspaceId, terminalId, data);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
  onProtocolDiagnosticsUpdated: (listener: (events: unknown[]) => void) => {
    const eventName = "diagnostics:protocol:updated";
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown[]) => listener(payload);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
  onActivityDiagnosticsUpdated: (listener: (workspaceId: string, events: unknown[]) => void) => {
    const eventName = "diagnostics:activity:updated";
    const wrapped = (_event: Electron.IpcRendererEvent, workspaceId: string, payload: unknown[]) =>
      listener(workspaceId, payload);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
  onRestoreDiagnosticsUpdated: (listener: (events: unknown[]) => void) => {
    const eventName = "diagnostics:restore:updated";
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown[]) => listener(payload);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
};

contextBridge.exposeInMainWorld("omniAPI", omniAPI);

declare global {
  interface Window {
    omniAPI: typeof omniAPI;
  }
}
