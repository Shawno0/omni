/**
 * Canonical IPC channel names shared between main + preload + renderer.
 * Any new channel MUST be declared here and consumed by all three layers
 * via these constants — do not hard-code raw strings elsewhere.
 */
export const IpcChannels = {
  // Dialogs
  DialogOpenFolder: "dialog:openFolder",

  // Workspace CRUD
  WorkspaceList: "workspace:list",
  WorkspaceLogsList: "workspace:logs:list",
  WorkspaceCreate: "workspace:create",
  WorkspaceStart: "workspace:start",
  WorkspaceRestart: "workspace:restart",
  WorkspaceOpen: "workspace:open",
  WorkspaceFocus: "workspace:focus",
  WorkspaceStop: "workspace:stop",
  WorkspaceDispose: "workspace:dispose",
  WorkspaceSetAppPort: "workspace:setAppPort",
  WorkspaceSetIdeTheme: "workspace:ideTheme:set",
  WorkspaceSetBrowserState: "workspace:browserState:set",
  WorkspaceSetAgentLock: "workspace:setAgentLock",
  WorkspaceSetTerminalActivity: "workspace:setTerminalActivity",
  WorkspacePtyOutput: "workspace:ptyOutput",

  // Terminal
  TerminalStart: "workspace:terminal:start",
  TerminalList: "workspace:terminal:list",
  TerminalCreate: "workspace:terminal:create",
  TerminalRename: "workspace:terminal:rename",
  TerminalSetActive: "workspace:terminal:setActive",
  TerminalClose: "workspace:terminal:close",
  TerminalInput: "workspace:terminal:input",
  TerminalResize: "workspace:terminal:resize",

  // Keys
  KeysList: "keys:list",
  KeysSet: "keys:set",
  KeysDelete: "keys:delete",

  // Diagnostics
  DiagnosticsProtocolList: "diagnostics:protocol:list",
  DiagnosticsRestoreList: "diagnostics:restore:list",
  DiagnosticsActivityList: "diagnostics:activity:list",
  DiagnosticsErrorsList: "diagnostics:errors:list",

  // Dev
  DevtoolsToggle: "devtools:toggle",

  // Vibe overlay (renderer-triggered)
  VibeShow: "vibe:show",

  // Events (main → renderer)
  EventWorkspacesUpdated: "workspaces:updated",
  EventWorkspacePatch: "workspace:patch",
  EventWorkspaceLog: "workspace:log",
  EventTerminalData: "workspace:terminal:data",
  EventProtocolDiagnosticsUpdated: "diagnostics:protocol:updated",
  EventActivityDiagnosticsUpdated: "diagnostics:activity:updated",
  EventRestoreDiagnosticsUpdated: "diagnostics:restore:updated",
  EventErrorsUpdated: "diagnostics:errors:updated",
  EventDeepLink: "app:deepLink",
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

export interface OmniErrorRecord {
  id: string;
  at: number;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  detail?: string;
}

export interface RestoreDiagnosticEvent {
  at: number;
  workspaceId: string;
  workspaceName: string;
  status: "restored" | "failed" | "timeout";
  message: string;
}
