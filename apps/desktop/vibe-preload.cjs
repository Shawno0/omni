/**
 * Preload bridge for the Vibe overlay window. Exposes a minimal IPC surface
 * — submit, createWorkspace, hide — that mirrors the handlers registered
 * in VibeOverlayManager. Kept in CJS because Electron preload sandboxes
 * still do not support ESM.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("omniVibe", {
  submit: (prompt) => ipcRenderer.invoke("vibe:submit", String(prompt ?? "")),
  createWorkspace: (projectPath) => ipcRenderer.invoke("vibe:createWorkspace", String(projectPath ?? "")),
  hide: () => ipcRenderer.invoke("vibe:hide"),
});
