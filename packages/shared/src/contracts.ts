export type ResourceTier = "focused" | "background-active" | "idle";

export interface WorkspaceDescriptor {
  id: string;
  name: string;
  slug: string;
  projectPath: string;
  ideHost: string;
  appHost: string;
  partition: string;
  status: "starting" | "running" | "stopped" | "error";
  idePort: number;
  appPort?: number;
  pid?: number;
  startedAt?: number;
  lastError?: string;
  resourceTier: ResourceTier;
  agentLock: boolean;
  terminalActive: boolean;
}

export interface ActivitySnapshot {
  workspaceId: string;
  cpuPercent: number;
  terminalActive: boolean;
  agentLock: boolean;
  tier: ResourceTier;
  sampledAt: number;
}

export interface KeyRecord {
  provider: "anthropic" | "openai";
  maskedValue: string;
  updatedAt: number;
}

export interface WorkspaceCreateInput {
  projectPath: string;
  name?: string;
}

export interface WorkspaceAppPortInput {
  workspaceId: string;
  appPort: number;
}

export interface WorkspaceAgentLockInput {
  workspaceId: string;
  locked: boolean;
}

export interface WorkspaceTerminalActivityInput {
  workspaceId: string;
  active: boolean;
}
