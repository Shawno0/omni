import path from "node:path";
import { app, BrowserWindow, WebContentsView } from "electron";
import type { WorkspaceInfo } from "../types.js";

interface WorkspaceViews {
  window: BrowserWindow;
  ideView: WebContentsView;
  appView: WebContentsView;
}

export class ViewCoordinator {
  private readonly viewsByWorkspace = new Map<string, WorkspaceViews>();
  private readonly fallbackFile = path.join(app.getAppPath(), "src", "renderer", "fallback.html");

  public attachWorkspaceViews(workspace: WorkspaceInfo): void {
    if (this.viewsByWorkspace.has(workspace.id)) {
      this.focusWorkspace(workspace.id);
      return;
    }

    const window = new BrowserWindow({
      width: 1700,
      height: 1020,
      title: `OmniContext • ${workspace.name}`,
      backgroundColor: "#0f1115",
    });

    const ideView = new WebContentsView({
      webPreferences: {
        partition: workspace.partition,
      },
    });

    const appView = new WebContentsView({
      webPreferences: {
        partition: workspace.partition,
      },
    });

    window.contentView.addChildView(ideView);
    window.contentView.addChildView(appView);

    const applyBounds = (): void => {
      const size = window.getContentSize();
      const width = size[0] ?? 1280;
      const height = size[1] ?? 800;
      const half = Math.floor(width * 0.56);
      ideView.setBounds({ x: 0, y: 0, width: half, height });
      appView.setBounds({ x: half, y: 0, width: width - half, height });
    };

    window.on("resize", applyBounds);
    window.on("closed", () => {
      this.viewsByWorkspace.delete(workspace.id);
    });

    applyBounds();

    const ideUrl = `http://${workspace.ideHost}`;
    ideView.webContents.loadURL(`${ideUrl}/?folder=${encodeURIComponent(workspace.projectPath)}`).catch(() => {
      void ideView.webContents.loadFile(this.fallbackFile);
    });

    if (workspace.appPort) {
      appView.webContents.loadURL(`http://${workspace.appHost}`).catch(() => {
        void appView.webContents.loadFile(this.fallbackFile);
      });
    } else {
      void appView.webContents.loadFile(this.fallbackFile);
    }

    this.viewsByWorkspace.set(workspace.id, {
      window,
      ideView,
      appView,
    });
  }

  public refreshAppView(workspace: WorkspaceInfo): void {
    const entry = this.viewsByWorkspace.get(workspace.id);
    if (!entry || !workspace.appPort) {
      return;
    }

    void entry.appView.webContents.loadURL(`http://${workspace.appHost}`);
  }

  public focusWorkspace(workspaceId: string): void {
    const entry = this.viewsByWorkspace.get(workspaceId);
    entry?.window.focus();
  }

  public closeWorkspace(workspaceId: string): void {
    const entry = this.viewsByWorkspace.get(workspaceId);
    if (!entry) {
      return;
    }

    entry.window.close();
    this.viewsByWorkspace.delete(workspaceId);
  }
}
