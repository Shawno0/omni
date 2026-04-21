export type ResourceTier = "focused" | "background-active" | "idle";
export type TerminalProgress = "idle" | "working" | "completed";

export interface BrowserTabState {
  id: string;
  label: string;
  url?: string;
  closable: boolean;
}

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
  terminalProgress: TerminalProgress;
  browserTabs: BrowserTabState[];
  activeBrowserTab: string;
}

export interface ActivitySnapshot {
  workspaceId: string;
  cpuPercent: number;
  terminalActive: boolean;
  agentLock: boolean;
  tier: ResourceTier;
  sampledAt: number;
}

/**
 * API-key providers Omni knows how to surface env vars for. The list is
 * intentionally broad so any AI CLI wrapper launched inside a workspace
 * (Claude Code, Codex, Aider, Cursor-CLI, Gemini-CLI, etc.) can pick up
 * its expected env var without Omni needing per-tool glue.
 */
export const AI_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "mistral",
  "groq",
  "deepseek",
  "openrouter",
  "xai",
] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Metadata used by the settings UI to label + describe each provider. */
export interface AiProviderMeta {
  id: AiProvider;
  label: string;
  /** Env var name injected into workspace processes when the key is set. */
  envVar: string;
  /** Short hint about what CLIs / SDKs pick this key up. */
  hint: string;
}

export const AI_PROVIDER_META: Record<AiProvider, AiProviderMeta> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    hint: "Claude Code, Anthropic SDK",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    hint: "OpenAI Codex, Aider, OpenAI SDK",
  },
  google: {
    id: "google",
    label: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    hint: "Gemini CLI, Google AI SDK",
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    envVar: "MISTRAL_API_KEY",
    hint: "Mistral CLI, le-chat-cli",
  },
  groq: {
    id: "groq",
    label: "Groq",
    envVar: "GROQ_API_KEY",
    hint: "Groq SDK, fast inference",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    envVar: "DEEPSEEK_API_KEY",
    hint: "DeepSeek CLI / SDK",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    hint: "Aggregator — routes to many models",
  },
  xai: {
    id: "xai",
    label: "xAI (Grok)",
    envVar: "XAI_API_KEY",
    hint: "xAI SDK, Grok API",
  },
};

export interface KeyRecord {
  provider: AiProvider;
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
