/**
 * Global type augmentation for window.omniAPI exposed by apps/desktop/preload.cjs.
 *
 * The runtime bridge is defined in preload.cjs; this file exists only for
 * TypeScript consumers (main process doesn't use it, but renderer-side TS
 * and any future strongly-typed vibe/agent bundles do).
 */
import type {
  WorkspaceDescriptor,
  WorkspaceCreateInput,
  BrowserTabState,
  KeyRecord,
  AiProvider,
  OmniErrorRecord,
  RestoreDiagnosticEvent,
  ActivitySnapshot,
} from "@omni/shared";

export interface OmniAPI {
  browseFolder: () => Promise<string | null>;
  listWorkspaces: () => Promise<WorkspaceDescriptor[]>;
  listWorkspaceLogs: (workspaceId: string, limit?: number) => Promise<string[]>;
  createWorkspace: (input: WorkspaceCreateInput) => Promise<WorkspaceDescriptor>;
  startWorkspace: (workspaceId: string) => Promise<WorkspaceDescriptor>;
  restartWorkspace: (workspaceId: string) => Promise<WorkspaceDescriptor>;
  openWorkspace: (workspaceId: string) => Promise<WorkspaceDescriptor>;
  focusWorkspace: (workspaceId: string) => Promise<WorkspaceDescriptor | undefined>;
  stopWorkspace: (workspaceId: string) => Promise<WorkspaceDescriptor>;
  disposeWorkspace: (workspaceId: string) => Promise<void>;
  setAppPort: (workspaceId: string, appPort: number) => Promise<WorkspaceDescriptor>;
  setIdeTheme: (themeName: string) => Promise<boolean>;
  setBrowserState: (
    workspaceId: string,
    browserTabs: BrowserTabState[],
    activeBrowserTab: string,
  ) => Promise<WorkspaceDescriptor>;
  setAgentLock: (workspaceId: string, locked: boolean) => Promise<WorkspaceDescriptor>;
  setTerminalActivity: (workspaceId: string, active: boolean) => Promise<WorkspaceDescriptor>;
  reportPtyOutput: (workspaceId: string) => Promise<void>;
  startTerminal: (workspaceId: string, terminalId?: string) => Promise<unknown>;
  listTerminals: (workspaceId: string) => Promise<unknown>;
  createTerminal: (workspaceId: string, name?: string) => Promise<unknown>;
  renameTerminal: (workspaceId: string, terminalId: string, name: string) => Promise<unknown>;
  setActiveTerminal: (workspaceId: string, terminalId: string) => Promise<unknown>;
  closeTerminal: (workspaceId: string, terminalId: string) => Promise<unknown>;
  sendTerminalInput: (workspaceId: string, terminalId: string, data: string) => Promise<void>;
  resizeTerminal: (workspaceId: string, terminalId: string, cols: number, rows: number) => Promise<void>;
  listKeys: () => Promise<KeyRecord[]>;
  listProtocolDiagnostics: (limit?: number) => Promise<unknown[]>;
  listRestoreDiagnostics: (limit?: number) => Promise<RestoreDiagnosticEvent[]>;
  listActivityDiagnostics: (workspaceId?: string, limit?: number) => Promise<ActivitySnapshot[]>;
  listErrors: (limit?: number) => Promise<OmniErrorRecord[]>;
  setKey: (provider: AiProvider, value: string) => Promise<KeyRecord[]>;
  deleteKey: (provider: AiProvider) => Promise<KeyRecord[]>;
  toggleDevTools: () => Promise<void>;
  showVibe: () => Promise<boolean>;

  onWorkspacesUpdated: (listener: (workspaces: WorkspaceDescriptor[]) => void) => () => void;
  onWorkspacePatch: (listener: (patch: Partial<WorkspaceDescriptor> & { id: string }) => void) => () => void;
  onWorkspaceLog: (listener: (workspaceId: string, stream: "stdout" | "stderr", chunk: string) => void) => () => void;
  onTerminalData: (listener: (workspaceId: string, terminalId: string, data: string) => void) => () => void;
  onProtocolDiagnosticsUpdated: (listener: (events: unknown[]) => void) => () => void;
  onActivityDiagnosticsUpdated: (listener: (workspaceId: string, events: ActivitySnapshot[]) => void) => () => void;
  onRestoreDiagnosticsUpdated: (listener: (events: RestoreDiagnosticEvent[]) => void) => () => void;
  onErrorsUpdated: (listener: (events: OmniErrorRecord[]) => void) => () => void;
}

declare global {
  interface Window {
    omniAPI: OmniAPI;
  }
}

export {};
