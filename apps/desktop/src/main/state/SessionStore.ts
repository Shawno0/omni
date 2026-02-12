import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

export interface PersistedWorkspace {
  id: string;
  name: string;
  slug: string;
  projectPath: string;
  idePort: number;
  appPort: number | undefined;
  token: string;
  createdAt: number;
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
      const parsed = JSON.parse(raw) as PersistedSessionPayload;
      return {
        version: Number(parsed.version) || 1,
        focusedWorkspaceId: parsed.focusedWorkspaceId ?? undefined,
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
      };
    } catch {
      return {
        version: 1,
        focusedWorkspaceId: undefined,
        workspaces: [],
      };
    }
  }

  public async save(payload: PersistedSessionPayload): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }
}
