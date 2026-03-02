export type WorkspaceStatus = "starting" | "running" | "stopped" | "error";
export type ResourceTier = "focused" | "background-active" | "idle";
export type TerminalProgress = "idle" | "working" | "completed";

export interface BrowserTabState {
  id: string;
  label: string;
  url?: string;
  closable: boolean;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  projectPath: string;
  ideHost: string;
  appHost: string;
  partition: string;
  status: WorkspaceStatus;
  idePort: number;
  appPort: number | undefined;
  token: string;
  pid: number | undefined;
  startedAt: number | undefined;
  lastError: string | undefined;
  terminalActive: boolean;
  terminalProgress: TerminalProgress;
  agentLock: boolean;
  resourceTier: ResourceTier;
  browserTabs: BrowserTabState[];
  activeBrowserTab: string;
}

export interface WorkspaceCreateInput {
  projectPath: string;
  name?: string;
}
