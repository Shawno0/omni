import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import { logger } from "../diagnostics/Logger.js";

export interface VibeOverlayManagerOptions {
  /** Called when the overlay requests creation of a workspace from a path/URL. */
  onCreateWorkspaceFromPath?: (projectPath: string) => Promise<void> | void;
  /** Called when the overlay submits a freeform prompt. Return value is surfaced back to the overlay. */
  onPromptSubmitted?: (prompt: string) => Promise<string> | string;
}

/**
 * Phase 6 scaffold: a lightweight always-on-top palette window that lets the
 * user trigger Omni actions without switching focus to the main shell. Kept
 * deliberately minimal in this iteration — it registers a global hotkey,
 * opens a frameless BrowserWindow with the overlay renderer, and bridges
 * two IPC channels (`vibe:submit`, `vibe:createWorkspace`) back to main.
 *
 * Future work: provider streaming, transcript panel, slash-commands,
 * multi-shell wiring into ViewCoordinator.
 */
export class VibeOverlayManager {
  private window: BrowserWindow | undefined;
  private readonly accelerator = process.platform === "darwin" ? "Cmd+Shift+Space" : "Ctrl+Shift+Space";
  private ipcBound = false;

  public constructor(private readonly options: VibeOverlayManagerOptions = {}) {}

  public registerShortcut(): void {
    try {
      const registered = globalShortcut.register(this.accelerator, () => this.toggle());
      if (!registered) {
        logger.warn("VibeOverlay", `Failed to register global shortcut ${this.accelerator}`);
      }
    } catch (err) {
      logger.warn("VibeOverlay", "Shortcut registration threw", err);
    }
    this.bindIpc();
  }

  public dispose(): void {
    try {
      globalShortcut.unregister(this.accelerator);
    } catch {
      // best-effort cleanup on quit
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = undefined;
  }

  public toggle(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.hide();
      return;
    }
    this.show();
  }

  public show(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.window = this.createWindow();
    }
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  public hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  private bindIpc(): void {
    if (this.ipcBound) return;
    this.ipcBound = true;

    ipcMain.handle("vibe:submit", async (_event, prompt: string) => {
      if (!this.options.onPromptSubmitted) return "Overlay prompt handler not wired.";
      try {
        return await this.options.onPromptSubmitted(prompt);
      } catch (err) {
        return err instanceof Error ? `Error: ${err.message}` : "Overlay prompt failed.";
      }
    });

    ipcMain.handle("vibe:createWorkspace", async (_event, projectPath: string) => {
      if (!this.options.onCreateWorkspaceFromPath) return { ok: false, reason: "not-wired" };
      try {
        await this.options.onCreateWorkspaceFromPath(projectPath);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : "unknown",
        };
      }
    });

    ipcMain.handle("vibe:hide", () => {
      this.hide();
      return true;
    });
  }

  private createWindow(): BrowserWindow {
    const { workAreaSize } = screen.getPrimaryDisplay();
    const width = 520;
    const height = 420;
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));

    const overlayHtmlCandidates = [
      path.join(moduleDir, "..", "..", "..", "src", "renderer", "vibe", "overlay.html"),
      path.join(process.cwd(), "apps", "desktop", "src", "renderer", "vibe", "overlay.html"),
    ];
    const preloadCandidates = [
      path.join(moduleDir, "..", "..", "..", "vibe-preload.cjs"),
      path.join(process.cwd(), "apps", "desktop", "vibe-preload.cjs"),
    ];

    const overlayHtml = overlayHtmlCandidates.find((candidate) => fs.existsSync(candidate));
    const preloadPath = preloadCandidates.find((candidate) => fs.existsSync(candidate));

    if (!overlayHtml) {
      throw new Error("Unable to locate Vibe overlay HTML");
    }

    const win = new BrowserWindow({
      width,
      height,
      x: Math.max(0, Math.floor((workAreaSize.width - width) / 2)),
      y: Math.max(24, Math.floor(workAreaSize.height * 0.18)),
      frame: false,
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: "#00000000",
      transparent: true,
      hasShadow: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        ...(preloadPath ? { preload: preloadPath } : {}),
      },
    });

    win.setMenuBarVisibility(false);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    void win.loadFile(overlayHtml);

    win.on("blur", () => {
      // Auto-dismiss when user clicks away — palette-style UX.
      if (!win.isDestroyed()) win.hide();
    });

    win.on("closed", () => {
      this.window = undefined;
    });

    return win;
  }
}
