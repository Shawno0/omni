import path from "node:path";
import { app, BrowserWindow, WebContentsView } from "electron";
import type { WorkspaceInfo } from "../types.js";
import { logger } from "../diagnostics/Logger.js";

interface WorkspaceViews {
  window: BrowserWindow;
  ideView: WebContentsView;
  appView: WebContentsView;
}

interface CachedEntry {
  views: WorkspaceViews;
  cachedAt: number;
}

interface ViewCoordinatorOptions {
  /** Max number of workspaces whose WebContentsViews we keep warm after close. */
  cacheSize?: number;
  /** Entries older than this are evicted even if the cache isn't full. */
  cacheTtlMs?: number;
}

/**
 * Manages long-lived IDE + app preview `WebContentsView`s per workspace.
 *
 * Opening a workspace is expensive: code-server has to be probed, the IDE
 * frame has to load extensions, and the preview pane needs to set up its
 * partition session. When a user repeatedly toggles workspaces (or a
 * workspace is briefly closed while refocusing), we don't want to rebuild
 * everything from scratch. `ViewCoordinator` therefore keeps an LRU cache
 * of closed workspaces' views and revives them on reopen.
 *
 * The cache is conservative: entries expire after `cacheTtlMs` so memory
 * isn't leaked, and `dispose()` eagerly tears everything down on quit.
 */
export class ViewCoordinator {
  private readonly viewsByWorkspace = new Map<string, WorkspaceViews>();
  private readonly cache = new Map<string, CachedEntry>();
  private readonly fallbackFile = path.join(app.getAppPath(), "src", "renderer", "fallback.html");
  private readonly cacheSize: number;
  private readonly cacheTtlMs: number;

  public constructor(options: ViewCoordinatorOptions = {}) {
    this.cacheSize = Math.max(0, options.cacheSize ?? 4);
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? 2 * 60 * 1000);
  }

  public attachWorkspaceViews(workspace: WorkspaceInfo): void {
    if (this.viewsByWorkspace.has(workspace.id)) {
      this.focusWorkspace(workspace.id);
      return;
    }

    // Fast path: if the same workspace was recently closed, revive its
    // WebContentsViews instead of reloading the IDE and preview. Preserves
    // scroll state, PTY reconnect timers, and the code-server session.
    const cached = this.popCached(workspace.id);
    if (cached) {
      this.viewsByWorkspace.set(workspace.id, cached);
      cached.window.show();
      cached.window.focus();
      // If the app port changed while cached, reload the preview pane.
      this.refreshAppView(workspace);
      return;
    }

    const window = new BrowserWindow({
      width: 1700,
      height: 1020,
      title: `Omni • ${workspace.name}`,
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
      // Destroying the BrowserWindow also invalidates its WebContents; a
      // reused entry reopens via show/focus rather than close/rebuild.
      this.viewsByWorkspace.delete(workspace.id);
      this.cache.delete(workspace.id);
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
    const entry = this.viewsByWorkspace.get(workspace.id) ?? this.cache.get(workspace.id)?.views;
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

    this.viewsByWorkspace.delete(workspaceId);

    // Park the views in the warm cache rather than destroying. The window
    // is hidden so it no longer occupies screen space, and pending IDE
    // WebSocket connections stay alive until the TTL expires or the cache
    // gets bumped by another workspace.
    if (this.cacheSize > 0) {
      this.evictExpired();
      if (this.cache.size >= this.cacheSize) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) {
          this.destroyCached(oldestKey);
        }
      }
      try {
        entry.window.hide();
      } catch {
        /* window may already be gone */
      }
      this.cache.set(workspaceId, { views: entry, cachedAt: Date.now() });
      return;
    }

    entry.window.close();
  }

  /** Tear down every live or cached view. Call on app quit. */
  public dispose(): void {
    for (const id of [...this.cache.keys()]) {
      this.destroyCached(id);
    }
    for (const [, entry] of this.viewsByWorkspace) {
      try {
        entry.window.close();
      } catch (err) {
        logger.warn("ViewCoordinator", "Failed to close window on dispose", err);
      }
    }
    this.viewsByWorkspace.clear();
  }

  private popCached(workspaceId: string): WorkspaceViews | undefined {
    this.evictExpired();
    const entry = this.cache.get(workspaceId);
    if (!entry) return undefined;
    this.cache.delete(workspaceId);
    return entry.views;
  }

  private destroyCached(workspaceId: string): void {
    const entry = this.cache.get(workspaceId);
    if (!entry) return;
    this.cache.delete(workspaceId);
    try {
      entry.views.window.close();
    } catch (err) {
      logger.warn("ViewCoordinator", "Failed to close cached window", err);
    }
  }

  private evictExpired(): void {
    if (this.cacheTtlMs <= 0 || this.cache.size === 0) return;
    const cutoff = Date.now() - this.cacheTtlMs;
    for (const [id, entry] of this.cache) {
      if (entry.cachedAt < cutoff) {
        this.destroyCached(id);
      }
    }
  }
}
