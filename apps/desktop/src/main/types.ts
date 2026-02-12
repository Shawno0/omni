export type WorkspaceStatus = "starting" | "running" | "stopped" | "error";
export type ResourceTier = "focused" | "background-active" | "idle";

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
  agentLock: boolean;
  resourceTier: ResourceTier;
}

export interface WorkspaceCreateInput {
  projectPath: string;
  name?: string;
}
