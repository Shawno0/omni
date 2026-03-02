import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

export interface PersistedTerminalSession {
  id: string;
  name: string;
  createdAt: number;
}

export interface PersistedBrowserTab {
  id: string;
  label: string;
  url?: string;
  closable: boolean;
}

export interface PersistedWorkspace {
  id: string;
  name: string;
  slug: string;
  projectPath: string;
  idePort: number;
  appPort: number | undefined;
  token: string;
  createdAt: number;
  terminalSessions?: PersistedTerminalSession[];
  activeTerminalId?: string;
  terminalCounter?: number;
  browserTabs?: PersistedBrowserTab[];
  activeBrowserTab?: string;
}

export interface PersistedSessionPayload {
  version: number;
  focusedWorkspaceId: string | undefined;
  workspaces: PersistedWorkspace[];
}

export class SessionStore {
  private readonly filePath = path.join(app.getPath("userData"), "omni-sessions.json");

  public async load(): Promise<PersistedSessionPayload> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedSessionPayload>;
      const workspacesRaw = Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
      return {
        version: Number(parsed.version) || 2,
        focusedWorkspaceId: parsed.focusedWorkspaceId ?? undefined,
        workspaces: workspacesRaw
          .map((workspace) => this.normalizeWorkspace(workspace))
          .filter((workspace): workspace is PersistedWorkspace => Boolean(workspace)),
      };
    } catch {
      return {
        version: 2,
        focusedWorkspaceId: undefined,
        workspaces: [],
      };
    }
  }

  public async save(payload: PersistedSessionPayload): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  private normalizeWorkspace(input: unknown): PersistedWorkspace | null {
    if (!input || typeof input !== "object") {
      return null;
    }

    const workspace = input as Partial<PersistedWorkspace>;
    if (
      typeof workspace.id !== "string" ||
      typeof workspace.name !== "string" ||
      typeof workspace.slug !== "string" ||
      typeof workspace.projectPath !== "string" ||
      typeof workspace.idePort !== "number" ||
      typeof workspace.token !== "string"
    ) {
      return null;
    }

    const sessionsRaw = Array.isArray(workspace.terminalSessions) ? workspace.terminalSessions : [];
    const terminalSessions = sessionsRaw
      .filter((session): session is PersistedTerminalSession =>
        Boolean(
          session &&
            typeof session.id === "string" &&
            typeof session.name === "string" &&
            typeof session.createdAt === "number",
        ),
      )
      .map((session) => ({
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
      }));

    const activeTerminalId = typeof workspace.activeTerminalId === "string" ? workspace.activeTerminalId : null;
    const terminalCounter = typeof workspace.terminalCounter === "number" ? workspace.terminalCounter : null;
    const browserTabsRaw = Array.isArray(workspace.browserTabs) ? workspace.browserTabs : [];
    const browserTabs = browserTabsRaw
      .filter((tab): tab is PersistedBrowserTab =>
        Boolean(tab && typeof tab.id === "string" && typeof tab.label === "string" && typeof tab.closable === "boolean"),
      )
      .map((tab) => ({
        id: tab.id,
        label: tab.label,
        closable: tab.closable,
        ...(typeof tab.url === "string" && tab.url.trim().length > 0 ? { url: tab.url } : {}),
      }));
    const activeBrowserTab = typeof workspace.activeBrowserTab === "string" ? workspace.activeBrowserTab : null;

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      projectPath: workspace.projectPath,
      idePort: workspace.idePort,
      appPort: typeof workspace.appPort === "number" ? workspace.appPort : undefined,
      token: workspace.token,
      createdAt: typeof workspace.createdAt === "number" ? workspace.createdAt : Date.now(),
      terminalSessions,
      ...(activeTerminalId ? { activeTerminalId } : {}),
      ...(terminalCounter !== null ? { terminalCounter } : {}),
      ...(browserTabs.length > 0 ? { browserTabs } : {}),
      ...(activeBrowserTab ? { activeBrowserTab } : {}),
    };
  }
}
