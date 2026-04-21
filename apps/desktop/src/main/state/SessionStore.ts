import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { logger } from "../diagnostics/Logger.js";

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

const CURRENT_VERSION = 2;

/**
 * SessionStore persists workspace snapshots to the user's app-data dir.
 *
 * Guarantees:
 *   - Atomic writes (tmp file + rename) so a crash mid-save cannot corrupt
 *     the persisted payload.
 *   - Serialized saves — a save in flight causes subsequent save() calls to
 *     await it and then re-run with the latest payload (last-write-wins).
 *   - Versioned payloads with a simple migrate() hook. If a future version
 *     needs to change shape, extend migrate() rather than failing on load.
 */
export class SessionStore {
  private readonly filePath = path.join(app.getPath("userData"), "omni-sessions.json");
  private saveInFlight: Promise<void> | null = null;
  private queuedPayload: PersistedSessionPayload | null = null;

  public async load(): Promise<PersistedSessionPayload> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedSessionPayload>;
      const migrated = this.migrate(parsed);
      return migrated;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code && code !== "ENOENT") {
        logger.warn("SessionStore", "Failed to load persisted sessions, starting fresh", err);
      }
      return { version: CURRENT_VERSION, focusedWorkspaceId: undefined, workspaces: [] };
    }
  }

  public async save(payload: PersistedSessionPayload): Promise<void> {
    this.queuedPayload = payload;
    if (this.saveInFlight) {
      return this.saveInFlight;
    }
    this.saveInFlight = this.drainQueue();
    try {
      await this.saveInFlight;
    } finally {
      this.saveInFlight = null;
    }
  }

  private async drainQueue(): Promise<void> {
    // Drain the queue until no newer payload is waiting — ensures last-write-wins
    // even if many save() calls arrive while one is in flight.
    while (this.queuedPayload) {
      const payload = this.queuedPayload;
      this.queuedPayload = null;
      await this.writeAtomic(payload);
    }
  }

  private async writeAtomic(payload: PersistedSessionPayload): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
      await fs.rename(tmp, this.filePath);
    } catch (err) {
      logger.error("SessionStore", "Failed to write session state", err);
      try {
        await fs.rm(tmp, { force: true });
      } catch {
        // best effort
      }
      throw err;
    }
  }

  private migrate(input: Partial<PersistedSessionPayload>): PersistedSessionPayload {
    const version = Number(input.version) || 1;
    // Future migrations: switch on version and step up incrementally.
    // For now, v1 and v2 share the same shape; normalize to v2.
    const workspacesRaw = Array.isArray(input.workspaces) ? input.workspaces : [];
    const workspaces = workspacesRaw
      .map((w) => this.normalizeWorkspace(w))
      .filter((w): w is PersistedWorkspace => Boolean(w));
    if (version !== CURRENT_VERSION) {
      logger.info("SessionStore", `Migrated session payload v${version} -> v${CURRENT_VERSION}`);
    }
    return {
      version: CURRENT_VERSION,
      focusedWorkspaceId: input.focusedWorkspaceId ?? undefined,
      workspaces,
    };
  }

  private normalizeWorkspace(input: unknown): PersistedWorkspace | null {
    if (!input || typeof input !== "object") return null;
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
      .map((session) => ({ id: session.id, name: session.name, createdAt: session.createdAt }));

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
