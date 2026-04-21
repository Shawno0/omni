// Guard against double-execution (script tag + executeJavaScript fallback race)
if (window.__omniRendererLoaded) {
  // Already loaded via <script> tag — skip re-injection
} else {
window.__omniRendererLoaded = true;
window.__omniRendererInitialized = false;

(() => {
  const el = (id) => document.getElementById(id);
  const api = window.omniAPI;
  const modules = window.OmniRendererModules || {};

  /* ─── Element References ──────────────────────────────────────────── */
  const elements = {
    appShell: el("app"),
    workspaceSidebarToggle: el("workspace-sidebar-toggle"),
    workspaceStatus: el("workspace-status"),
    workspaceGrid: el("workspace-grid"),
    workspaceEmpty: el("workspace-empty"),
    workspaceTitle: el("workspace-title"),
    surfaceSplitter: el("surface-splitter"),
    ideFrameContent: el("ide-frame-content"),
    diagnostics: el("diagnostics"),
    workspaceList: el("workspace-list"),
    workspaceAdd: el("workspace-add"),
    workspaceModalOverlay: el("workspace-modal-overlay"),
    workspaceModalClose: el("workspace-modal-close"),
    workspaceModalCancel: el("workspace-modal-cancel"),
    workspaceModalCreate: el("workspace-modal-create"),
    modalProjectPath: el("modal-project-path"),
    modalWorkspaceName: el("modal-workspace-name"),
    modalBrowsePath: el("modal-browse-path"),
    modalDropzone: el("workspace-modal-dropzone"),
    modalRecent: el("workspace-modal-recent"),
    modalRecentList: el("workspace-modal-recent-list"),
    sessionTabs: el("session-tabs"),
    themeToggle: el("theme-toggle"),
    themeToggleIcon: el("theme-toggle-icon"),
    protocolDiagnostics: el("protocol-diagnostics"),
    protocolWorkspaceFilter: el("protocol-workspace-filter"),
    protocolSeverityFilter: el("protocol-severity-filter"),
    activityDiagnostics: el("activity-diagnostics"),
    restoreDiagnostics: el("restore-diagnostics"),
    workspaceSearch: el("workspace-search"),
    workspaceSort: el("workspace-sort"),
    quickActionsButton: el("quick-actions-button"),
    quickActionsOverlay: el("quick-actions-overlay"),
    quickActionsSearch: el("quick-actions-search"),
    quickActionsList: el("quick-actions-list"),
    saveSettings: el("save-settings"),
    resetSettings: el("reset-settings"),
    settingsStatus: el("settings-status"),
    paletteKey: el("setting-palette-key"),
    restartKey: el("setting-restart-key"),
    settingsOpen: el("settings-open"),
    settingsModal: el("settings-modal-overlay"),
    settingsModalClose: el("settings-modal-close"),
    settingsProviderList: el("settings-provider-list"),
    vibeOpen: el("vibe-open"),
    layoutOverview: el("layout-overview"),
    layoutFocused: el("layout-focused"),
    focusedSurfaceTabs: el("focused-surface-tabs"),
    focusedTerminal: el("focused-terminal"),
    terminalContainer: el("terminal-container"),
    focusedTerminalContainer: el("focused-terminal-container"),
    terminalTabs: el("terminal-tabs"),
    terminalTabNew: el("terminal-tab-new"),
    terminalTabRename: el("terminal-tab-rename"),
    previewRefresh: el("preview-refresh"),
    browserTabs: el("browser-tabs"),
    browserTabNew: el("browser-tab-new"),
    browserTabContent: el("browser-tab-content"),
    browserAddressBar: el("browser-address-bar"),
    browserAddressInput: el("browser-address-input"),
    browserAddressGo: el("browser-address-go"),
    browserDevtools: el("browser-devtools"),
  };

  /* ─── Terminal Views ──────────────────────────────────────────────── */
  let terminalViewController = null;

  const fitAllTerminals = () => {
    terminalViewController?.fitAllTerminals();
  };

  const getBottomTerm = () => terminalViewController?.getBottomTerm?.() || null;
  const getFocusedTerm = () => terminalViewController?.getFocusedTerm?.() || null;

  /* ─── State ───────────────────────────────────────────────────────── */
  let selectedWorkspaceId;
  let workspaces = [];
  let protocolEvents = [];
  let activityEvents = [];
  let restoreEvents = [];
  let sidebarCollapsed = localStorage.getItem("omni-sidebar-collapsed") === "true";
  let terminalWorkspaceId;
  let pendingWorkspacesPayload = null;
  let workspacesUpdateTimer;
  let applyingWorkspaceUpdate = false;
  let activeTerminalId;
  let terminalTabs = [];
  const terminalTabsByWorkspace = new Map();
  const terminalBufferByKey = new Map();
  let ideRatio = Number(localStorage.getItem("omni-ide-ratio") || "50");
  let browserTabCounter = 0;
  let activeBrowserTab = "preview";
  let browserTabs = [{ id: "preview", label: "Preview", closable: false }];
  const wsFrames = new Map(); // workspaceId → per-workspace frame state
  let layoutMode = localStorage.getItem("omni-layout") || "overview"; // "overview" | "focused"
  let focusedSurface = localStorage.getItem("omni-focused-surface") || "ide"; // "ide" | "preview" | "terminal"
  let paletteShortcut = localStorage.getItem("omni-palette-key") || "k";
  let restartShortcut = localStorage.getItem("omni-restart-key") || "r";

  const terminalBufferKey = (workspaceId, terminalId) => `${workspaceId}:${terminalId}`;

  /* ─── Helpers ─────────────────────────────────────────────────────── */
  const getSelectedWorkspace = () => workspaces.find((w) => w.id === selectedWorkspaceId);

  const buildSessionIdentityKey = (items) => items.map((w) => `${w.id}:${w.name}`).join("|");
  const buildSessionSnapshotKey = (items) =>
    items.map((w) => `${w.id}:${w.name}:${w.status}:${w.resourceTier}:${w.terminalProgress || "idle"}:${w.appPort || 0}`).join("|");

  const setStatus = (text, isError = false) => {
    if (!elements.workspaceStatus) return;
    elements.workspaceStatus.textContent = text;
    elements.workspaceStatus.classList.toggle("error", isError);
  };

  let themeController = null;

  let workspaceModalController = null;
  const openWorkspaceModal = () => workspaceModalController?.open();

  const getCurrentTheme = () =>
    themeController?.getCurrentTheme?.() || localStorage.getItem("omni-theme") || "system";

  const getResolvedTheme = () => {
    if (themeController?.getResolvedTheme) {
      return themeController.getResolvedTheme();
    }
    const currentTheme = getCurrentTheme();
    if (currentTheme === "light" || currentTheme === "dark") return currentTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  const getIdeThemeName = () =>
    themeController?.getIdeThemeName?.() ||
    (getResolvedTheme() === "dark" ? "Default Dark Modern" : "Default Light Modern");

  const persistIdeThemePreference = () => {
    if (!api?.setIdeTheme) {
      return;
    }
    const themeName = getIdeThemeName();
    void api.setIdeTheme(themeName).catch(() => {});
  };

  const buildIdeSrc = (workspace, cacheBust = "") => {
    if (!workspace?.projectPath || !workspace?.idePort) return "";
    let folderPath = workspace.projectPath.replace(/\\/g, "/");
    if (/^[A-Za-z]:/.test(folderPath)) folderPath = "/" + folderPath;
    const ideTheme = getIdeThemeName();
    const cacheParam = cacheBust ? `&omni-theme-sync=${encodeURIComponent(cacheBust)}` : "";
    return (
      `http://localhost:${workspace.idePort}/?folder=${encodeURIComponent(folderPath)}` +
      `&vscode-theme=${encodeURIComponent(ideTheme)}` +
      `&theme=${encodeURIComponent(ideTheme)}` +
      cacheParam
    );
  };

  const buildIdeThemeSyncScript = (isDark, themeName) => {
    const rootClass = isDark ? "vs-dark" : "vs";
    const vscodeClass = isDark ? "vscode-dark" : "vscode-light";
    return `(() => {
      try {
        const removeClasses = ["vs", "vs-dark", "hc-black", "hc-light", "vscode-light", "vscode-dark", "vscode-high-contrast", "vscode-high-contrast-light"];
        const targets = [document.documentElement, document.body, document.querySelector('.monaco-workbench')].filter(Boolean);
        for (const target of targets) {
          target.classList.remove(...removeClasses);
          target.classList.add(${JSON.stringify(rootClass)}, ${JSON.stringify(vscodeClass)});
        }
        const styleId = "omni-theme-sync";
        let style = document.getElementById(styleId);
        if (!style) {
          style = document.createElement("style");
          style.id = styleId;
          document.head.appendChild(style);
        }
        style.textContent = ${JSON.stringify(isDark ? ":root { color-scheme: dark; }" : ":root { color-scheme: light; }")};
        try {
          window.localStorage.setItem("workbench.colorTheme", ${JSON.stringify(themeName)});
        } catch {}
        try {
          if (window.monaco && window.monaco.editor && typeof window.monaco.editor.setTheme === "function") {
            window.monaco.editor.setTheme(${JSON.stringify(isDark ? "vs-dark" : "vs")});
          }
        } catch {}
        return true;
      } catch {
        return false;
      }
    })();`;
  };

  const applyThemeToIdeFrame = (ideFrame) => {
    if (!ideFrame || typeof ideFrame.executeJavaScript !== "function") return;
    const isDark = getResolvedTheme() === "dark";
    const script = buildIdeThemeSyncScript(isDark, getIdeThemeName());
    ideFrame.executeJavaScript(script).catch(() => {});
  };

  const scheduleIdeThemeSync = (ideFrame) => {
    applyThemeToIdeFrame(ideFrame);
    [250, 1000, 2500].forEach((delay) => {
      setTimeout(() => applyThemeToIdeFrame(ideFrame), delay);
    });
  };

  const applyThemeToAllIdeFrames = () => {
    wsFrames.forEach((ws) => applyThemeToIdeFrame(ws.ideFrame));
  };

  const rebuildIdeFramesForTheme = () => {
    const token = String(Date.now());
    wsFrames.forEach((state, workspaceId) => {
      const workspace = workspaces.find((item) => item.id === workspaceId);
      if (!workspace || !state?.ideFrame) return;

      const previous = state.ideFrame;
      const replacement = document.createElement("webview");
      replacement.className = previous.className || "ws-ide-frame";
      replacement.dataset.workspaceId = workspaceId;
      replacement.setAttribute("partition", workspace.partition || `persist:session_${workspaceId}`);
      replacement.setAttribute("allowpopups", "");
      replacement.title = previous.title || "IDE";

      replacement.addEventListener("dom-ready", () => {
        scheduleIdeThemeSync(replacement);
      });

      const nextSrc = buildIdeSrc(workspace, token);
      if (nextSrc) {
        replacement.src = nextSrc;
        state.ideSrc = nextSrc;
      }

      if (previous.classList.contains("active")) {
        replacement.classList.add("active");
      }

      previous.replaceWith(replacement);
      state.ideFrame = replacement;
    });
  };

  /** Sync xterm terminal theme with the resolved app theme. */
  const updateTerminalTheme = () => {
    terminalViewController?.updateTheme(getResolvedTheme());
  };

  let uiChromeController = null;
  const updateSidebarState = () => uiChromeController?.updateSidebarState();
  const toggleSidebar = () => uiChromeController?.toggleSidebar();

  /* ─── Custom Prompt (Electron doesn't support window.prompt) ─────── */
  const showPrompt = (message, defaultValue = "") => {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed", inset: "0", background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: "9999",
      });
      const box = document.createElement("div");
      Object.assign(box.style, {
        background: "var(--bg-surface, #181818)", borderRadius: "8px", padding: "20px",
        minWidth: "320px", maxWidth: "420px", color: "var(--text-primary, #cccccc)",
        fontFamily: "system-ui, sans-serif", fontSize: "13px",
        border: "1px solid var(--border-default, #3c3c3c)",
      });
      const label = document.createElement("div");
      label.textContent = message;
      label.style.marginBottom = "12px";
      const input = document.createElement("input");
      Object.assign(input.style, {
        width: "100%", padding: "6px 10px", borderRadius: "4px", border: "1px solid var(--border-default, #3c3c3c)",
        background: "var(--bg-elevated, #313131)", color: "var(--text-primary, #cccccc)",
        fontSize: "13px", boxSizing: "border-box",
      });
      input.type = "text";
      input.value = defaultValue;
      const btnRow = document.createElement("div");
      Object.assign(btnRow.style, { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" });
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      Object.assign(cancelBtn.style, {
        padding: "5px 14px", borderRadius: "4px", border: "1px solid var(--border-default, #3c3c3c)",
        background: "transparent", color: "var(--text-secondary, #9d9d9d)", cursor: "pointer",
      });
      const okBtn = document.createElement("button");
      okBtn.textContent = "OK";
      Object.assign(okBtn.style, {
        padding: "5px 14px", borderRadius: "4px", border: "none",
        background: "var(--accent, #0078d4)", color: "#fff", cursor: "pointer",
      });
      const close = (val) => { overlay.remove(); resolve(val); };
      cancelBtn.addEventListener("click", () => close(null));
      okBtn.addEventListener("click", () => close(input.value));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") close(input.value);
        if (e.key === "Escape") close(null);
      });
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
      btnRow.append(cancelBtn, okBtn);
      box.append(label, input, btnRow);
      overlay.append(box);
      document.body.append(overlay);
      input.focus();
      input.select();
    });
  };

  const applyLayoutMode = () => uiChromeController?.applyLayoutMode();
  const applyIdeRatio = (value) => uiChromeController?.applyIdeRatio(value);
  const bindSurfaceSplitter = () => uiChromeController?.bindSurfaceSplitter();
  const bindLayoutSwitcher = () => uiChromeController?.bindLayoutSwitcher();
  const bindPanelCardToggles = () => uiChromeController?.bindPanelCardToggles();
  const bindBottomPanelTabs = () => uiChromeController?.bindBottomPanelTabs();

  /* ─── Workspace Empty State ───────────────────────────────────────── */
  const updateEmptyState = (hasWorkspace) => {
    if (elements.workspaceEmpty) {
      elements.workspaceEmpty.classList.toggle("visible", !hasWorkspace);
    }
  };

  let diagnosticsController = null;
  const renderProtocolDiagnostics = () => diagnosticsController?.renderProtocolDiagnostics();
  const renderActivityDiagnostics = () => diagnosticsController?.renderActivityDiagnostics();
  const renderRestoreDiagnostics = () => diagnosticsController?.renderRestoreDiagnostics();

  /* ─── App Preview with Retry ──────────────────────────────────────── */
  let previewManager = null;
  let previewFallbackRetryTimer = null;
  let previewFallbackTargetSrc = null;

  const setPreviewSrcFallback = (frame, nextSrc) => {
    if (!frame || !nextSrc) return;
    if (frame.src === nextSrc) return;
    try {
      frame.src = nextSrc;
    } catch {}
  };

  const buildPreviewLoadingHtmlFallback = (port) => {
    const isDark = getResolvedTheme() === "dark";
    const background = isDark ? "#1f1f1f" : "#ffffff";
    const textPrimary = isDark ? "#9d9d9d" : "#4b5563";
    const textSecondary = isDark ? "#6e7681" : "#9ca3af";
    const spinnerBase = isDark ? "#3c3c3c" : "#d1d5db";
    const spinnerTop = isDark ? "#0078d4" : "#2563eb";
    return `<!doctype html><html><head><style>
      body { margin:0; display:flex; align-items:center; justify-content:center; height:100vh;
             font:14px system-ui; color:${textPrimary}; background:${background}; flex-direction:column; gap:12px; }
      .spinner { width:24px; height:24px; border:3px solid ${spinnerBase}; border-top-color:${spinnerTop};
                 border-radius:50%; animation:spin 0.8s linear infinite; }
      @keyframes spin { to { transform:rotate(360deg); } }
    </style></head><body>
      <div class="spinner"></div>
      <div>Waiting for server on port ${port}\u2026</div>
      <div style="font-size:12px;color:${textSecondary};">Will auto-load when ready</div>
    </body></html>`;
  };

  const buildPreviewNoPortHtmlFallback = () => {
    const isDark = getResolvedTheme() === "dark";
    const background = isDark ? "#1f1f1f" : "#ffffff";
    const text = isDark ? "#9d9d9d" : "#4b5563";
    return `<!doctype html><html><body style='margin:0;padding:24px;font:14px system-ui;color:${text};background:${background};'>Set an app port to load the browser preview.</body></html>`;
  };

  const stopPreviewFallbackRetry = () => {
    if (previewFallbackRetryTimer) {
      clearInterval(previewFallbackRetryTimer);
      previewFallbackRetryTimer = null;
    }
    previewFallbackTargetSrc = null;
  };

  const renderPreviewLoadingFallback = (frame, port) => {
    if (!frame) return;
    const src = "data:text/html;charset=utf-8," + encodeURIComponent(buildPreviewLoadingHtmlFallback(port));
    setPreviewSrcFallback(frame, src);
  };

  const renderPreviewNoPortFallback = (frame) => {
    if (!frame) return;
    const src = "data:text/html;charset=utf-8," + encodeURIComponent(buildPreviewNoPortHtmlFallback());
    setPreviewSrcFallback(frame, src);
  };

  const stopAppPreviewRetry = () => {
    if (previewManager?.stopAppPreviewRetry) {
      previewManager.stopAppPreviewRetry();
      return;
    }
    stopPreviewFallbackRetry();
  };
  const renderPreviewLoading = (frame, port) => {
    if (previewManager?.renderPreviewLoading) {
      previewManager.renderPreviewLoading(frame, port);
      return;
    }
    renderPreviewLoadingFallback(frame, port);
  };
  const renderPreviewNoPort = (frame) => {
    if (previewManager?.renderPreviewNoPort) {
      previewManager.renderPreviewNoPort(frame);
      return;
    }
    renderPreviewNoPortFallback(frame);
  };
  const reskinPreviewPlaceholders = () => {
    if (previewManager?.reskinPreviewPlaceholders) {
      previewManager.reskinPreviewPlaceholders();
      return;
    }
    wsFrames.forEach((ws) => {
      if (typeof ws.previewLoadingPort === "number") {
        renderPreviewLoadingFallback(ws.previewFrame, ws.previewLoadingPort);
        return;
      }
      if (ws.usingSrcDoc) {
        renderPreviewNoPortFallback(ws.previewFrame);
      }
    });
  };
  const startAppPreviewWithRetry = (targetSrc, port) => {
    if (previewManager?.startAppPreviewWithRetry) {
      previewManager.startAppPreviewWithRetry(targetSrc, port);
      return;
    }

    stopPreviewFallbackRetry();
    previewFallbackTargetSrc = targetSrc;

    const frame = getActivePreviewFrame();
    if (!frame) return;
    switchBrowserTab("preview", { persist: false });

    const ws = wsFrames.get(selectedWorkspaceId);
    if (ws) {
      ws.previewLoadingPort = port;
      ws.usingSrcDoc = false;
    }
    renderPreviewLoadingFallback(frame, port);

    const capturedWsId = selectedWorkspaceId;
    const tryLoad = async () => {
      try {
        const res = await fetch(targetSrc, { method: "HEAD" });
        if (!res.ok) return false;
        stopPreviewFallbackRetry();
        const currentWs = wsFrames.get(capturedWsId);
        if (currentWs) currentWs.previewLoadingPort = undefined;
        const targetFrame = currentWs?.previewFrame;
        if (targetFrame) {
          setPreviewSrcFallback(targetFrame, targetSrc);
        }
        return true;
      } catch {
        return false;
      }
    };

    void tryLoad().then((ok) => {
      if (ok || previewFallbackTargetSrc !== targetSrc) return;
      previewFallbackRetryTimer = setInterval(async () => {
        if (previewFallbackTargetSrc !== targetSrc) {
          stopPreviewFallbackRetry();
          return;
        }
        await tryLoad();
      }, 2000);
    });
  };

  /* ─── Per-Workspace Frame State ───────────────────────────────────── */
  const getWsFrameState = (wsId) => {
    if (wsFrames.has(wsId)) return wsFrames.get(wsId);

    // Find the workspace to get its partition
    const workspace = workspaces.find((w) => w.id === wsId);
    const partition = workspace?.partition || `persist:session_${wsId}`;

    // Create IDE webview (stays alive across workspace switches)
    const ideFrame = document.createElement("webview");
    ideFrame.className = "ws-ide-frame";
    ideFrame.dataset.workspaceId = wsId;
    ideFrame.setAttribute("partition", partition);
    ideFrame.setAttribute("allowpopups", "");
    ideFrame.title = "IDE";
    ideFrame.addEventListener("dom-ready", () => {
      scheduleIdeThemeSync(ideFrame);
    });
    elements.ideFrameContent?.appendChild(ideFrame);

    // Create preview webview
    const previewFrame = document.createElement("webview");
    previewFrame.className = "surface-frame browser-frame";
    previewFrame.dataset.workspaceId = wsId;
    previewFrame.dataset.tabId = "preview";
    previewFrame.setAttribute("partition", partition);
    previewFrame.setAttribute("allowpopups", "");
    previewFrame.title = "App Preview";
    elements.browserTabContent?.appendChild(previewFrame);

    const persistedTabs = Array.isArray(workspace?.browserTabs)
      ? workspace.browserTabs
          .filter((tab) => tab && typeof tab.id === "string" && typeof tab.label === "string")
          .map((tab) => ({
            id: tab.id,
            label: tab.label,
            closable: Boolean(tab.closable),
            ...(typeof tab.url === "string" ? { url: tab.url } : {}),
          }))
      : [{ id: "preview", label: "Preview", closable: false }];

    const tabs = persistedTabs.some((tab) => tab.id === "preview")
      ? persistedTabs.map((tab) => (tab.id === "preview" ? { ...tab, closable: false } : tab))
      : [{ id: "preview", label: "Preview", closable: false }, ...persistedTabs];

    for (const tab of tabs) {
      if (tab.id === "preview") continue;
      const wv = document.createElement("webview");
      wv.className = "surface-frame browser-frame";
      wv.dataset.tabId = tab.id;
      wv.dataset.workspaceId = wsId;
      wv.setAttribute("partition", partition);
      wv.setAttribute("allowpopups", "");
      wv.title = tab.label;
      if (tab.url) {
        wv.src = tab.url;
      }
      elements.browserTabContent?.appendChild(wv);
    }

    const persistedActive = typeof workspace?.activeBrowserTab === "string" ? workspace.activeBrowserTab : "preview";
    const activeTab = tabs.some((tab) => tab.id === persistedActive) ? persistedActive : "preview";

    const state = {
      ideFrame,
      ideSrc: undefined,
      previewFrame,
      appSrc: undefined,
      usingSrcDoc: false,
      previewLoadingPort: undefined,
      tabs,
      activeTab,
    };
    wsFrames.set(wsId, state);
    return state;
  };

  const getActivePreviewFrame = () => {
    if (!selectedWorkspaceId) return null;
    return wsFrames.get(selectedWorkspaceId)?.previewFrame || null;
  };

  /* ─── Browser Tabs ────────────────────────────────────────────────── */
  let browserTabsController = null;

  const persistBrowserTabState = (workspaceId = selectedWorkspaceId) => {
    browserTabsController?.persistBrowserTabState(workspaceId);
  };
  const renderBrowserTabBar = () => {
    browserTabsController?.renderBrowserTabBar();
  };
  const switchBrowserTab = (tabId, options = { persist: true }) => {
    browserTabsController?.switchBrowserTab(tabId, options);
  };
  const bindBrowserTabs = () => {
    browserTabsController?.bind();
  };

  /* ─── Terminal Tabs ──────────────────────────────────────────────── */
  let terminalTabsController = null;

  const applyTerminalBufferToViews = () => {
    terminalTabsController?.applyTerminalBufferToViews();
  };
  const renderTerminalTabBar = () => {
    terminalTabsController?.renderTerminalTabBar();
  };
  const ensureTerminalTabsForWorkspace = async (workspaceId) => {
    await terminalTabsController?.ensureTerminalTabsForWorkspace(workspaceId);
  };
  const bindTerminalTabs = () => {
    terminalTabsController?.bind();
  };

  /* ─── Workspace Surface ───────────────────────────────────────────── */
  const renderWorkspaceSurface = async () => {
    const selected = workspaces.find((w) => w.id === selectedWorkspaceId);

    if (!selected) {
      // Hide all workspace frames
      elements.ideFrameContent?.querySelectorAll(".ws-ide-frame").forEach((f) => f.classList.remove("active"));
      elements.browserTabContent?.querySelectorAll(".browser-frame").forEach((f) => f.classList.remove("active"));
      elements.workspaceGrid?.classList.add("hidden");
      updateEmptyState(false);

      browserTabs = [{ id: "preview", label: "Preview", closable: false }];
      activeBrowserTab = "preview";
      renderBrowserTabBar();
      elements.browserAddressBar?.classList.add("hidden");

      terminalWorkspaceId = undefined;
      activeTerminalId = undefined;
      terminalTabs = [];
      renderTerminalTabBar();
      terminalViewController?.resetBoth();
      if (elements.workspaceTitle) elements.workspaceTitle.textContent = "Omni";
      setStatus("Select or create a workspace to begin.");
      return;
    }

    const terminalMarker = selected.terminalProgress && selected.terminalProgress !== "idle"
      ? ` \u2022 terminal:${selected.terminalProgress}`
      : "";
    setStatus(`${selected.name} \u2022 ${selected.status} \u2022 ${selected.resourceTier}${terminalMarker}`);
    elements.workspaceGrid?.classList.remove("hidden");
    updateEmptyState(true);

    if (elements.workspaceTitle) {
      elements.workspaceTitle.textContent = selected.name;
    }

    // Get or create per-workspace frame state
    const ws = getWsFrameState(selected.id);

    // --- Workspace Switch ---
    if (terminalWorkspaceId !== selected.id) {
      // Save outgoing workspace's tab state
      const prev = wsFrames.get(terminalWorkspaceId);
      if (prev) {
        prev.tabs = browserTabs;
        prev.activeTab = activeBrowserTab;
        prev.ideFrame.classList.remove("active");
      }
      persistBrowserTabState(terminalWorkspaceId);

      // Terminal reset
      terminalViewController?.resetBoth();

      // Load incoming workspace's tab state
      browserTabs = ws.tabs;
      activeBrowserTab = ws.activeTab;
      renderBrowserTabBar();

      terminalWorkspaceId = selected.id;

      const terminalSnapshot = terminalTabsByWorkspace.get(selected.id);
      if (terminalSnapshot) {
        terminalTabs = terminalSnapshot.terminals;
        activeTerminalId = terminalSnapshot.activeTerminalId;
      } else {
        terminalTabs = [];
        activeTerminalId = undefined;
      }
      renderTerminalTabBar();
    }

    // --- IDE Frame ---
    elements.ideFrameContent?.querySelectorAll(".ws-ide-frame").forEach((f) => {
      f.classList.toggle("active", f.dataset.workspaceId === selected.id);
    });

    const nextIdeSrc = buildIdeSrc(selected);
    if (ws.ideSrc !== nextIdeSrc) {
      ws.ideFrame.src = nextIdeSrc;
      ws.ideSrc = nextIdeSrc;
    } else {
      applyThemeToIdeFrame(ws.ideFrame);
    }

    // --- Browser Tabs / Preview ---
    switchBrowserTab(activeBrowserTab, { persist: false });

    const nextAppSrc = selected.appPort
      ? `http://localhost:${selected.appPort}`
      : null;

    if (nextAppSrc) {
      if (ws.usingSrcDoc || ws.appSrc !== nextAppSrc) {
        ws.appSrc = nextAppSrc;
        ws.usingSrcDoc = false;
        ws.previewLoadingPort = selected.appPort;
        renderPreviewLoading(ws.previewFrame, selected.appPort);
        startAppPreviewWithRetry(nextAppSrc, selected.appPort);
      }
    } else {
      stopAppPreviewRetry();
      if (!ws.usingSrcDoc) {
        ws.previewLoadingPort = undefined;
        renderPreviewNoPort(ws.previewFrame);
        ws.appSrc = undefined;
        ws.usingSrcDoc = true;
      }
    }

    // --- Terminal ---
    await ensureTerminalTabsForWorkspace(selected.id);
    applyTerminalBufferToViews();
    if (activeTerminalId) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => fitAllTerminals());
      });
      setTimeout(() => fitAllTerminals(), 200);
    }
  };

  /* ─── Workspace List ──────────────────────────────────────────────── */
  let workspaceListController = null;
  const renderWorkspaceList = () => {
    workspaceListController?.renderWorkspaceList();
  };
  const renderSessionTabs = () => {
    workspaceListController?.renderSessionTabs();
  };

  /* ─── Activity Loading ────────────────────────────────────────────── */
  const loadActivity = async () => {
    if (!selectedWorkspaceId || !api?.listActivityDiagnostics) {
      activityEvents = [];
      renderActivityDiagnostics();
      return;
    }
    activityEvents = await api.listActivityDiagnostics(selectedWorkspaceId, 60);
    renderActivityDiagnostics();
  };

  /* ─── Selected Workspace Info ─────────────────────────────────────── */
  const renderSelectedWorkspaceDiagnostics = () => {
    if (selectedWorkspaceId === undefined) {
      activityEvents = [];
    }
    diagnosticsController?.renderSelectedWorkspaceDiagnostics();
  };

  /* ─── Workspace Update Batching ───────────────────────────────────── */
  const flushWorkspaceUpdates = async () => {
    if (applyingWorkspaceUpdate) return;
    applyingWorkspaceUpdate = true;
    try {
      while (pendingWorkspacesPayload) {
        const prev = workspaces;
        const prevSelected = getSelectedWorkspace();
        workspaces = pendingWorkspacesPayload;
        pendingWorkspacesPayload = null;

        const identityChanged = buildSessionIdentityKey(prev) !== buildSessionIdentityKey(workspaces);
        const dataChanged = buildSessionSnapshotKey(prev) !== buildSessionSnapshotKey(workspaces);

        // Always re-render the workspace list when any visible data changes
        // (tier badges, status dots, port labels, etc.)
        if (dataChanged || identityChanged) {
          renderWorkspaceList();
        }
        // Only re-render session tabs when workspaces are added/removed/renamed
        if (identityChanged) {
          renderSessionTabs();
        }

        renderSelectedWorkspaceDiagnostics();

        const nextSelected = getSelectedWorkspace();
        const removed = Boolean(prevSelected) && !nextSelected;
        const chosen = !prevSelected && Boolean(nextSelected);
        const portOrPathChanged = Boolean(prevSelected && nextSelected) && (
          prevSelected.projectPath !== nextSelected.projectPath ||
          prevSelected.idePort !== nextSelected.idePort ||
          prevSelected.appPort !== nextSelected.appPort
        );

        if (removed || chosen || portOrPathChanged) {
          await renderWorkspaceSurface();
        }
      }
    } finally {
      applyingWorkspaceUpdate = false;
    }
  };

  const scheduleWorkspaceUpdateFlush = () => {
    if (workspacesUpdateTimer) clearTimeout(workspacesUpdateTimer);
    workspacesUpdateTimer = setTimeout(() => void flushWorkspaceUpdates(), 120);
  };

  /**
   * Merge a single-workspace patch into the pending payload (or current
   * list if none pending) and schedule the normal debounced flush. This
   * is the renderer counterpart to the main process's broadcastWorkspacePatch
   * fast path.
   */
  const applyWorkspacePatch = (patch) => {
    if (!patch || !patch.id) return;
    const base = pendingWorkspacesPayload || workspaces;
    const idx = base.findIndex((w) => w.id === patch.id);
    const next = base.slice();
    if (idx >= 0) next[idx] = patch;
    else next.push(patch);
    pendingWorkspacesPayload = next;
    scheduleWorkspaceUpdateFlush();
  };

  /* ─── Refresh ─────────────────────────────────────────────────────── */
  const refresh = async (options = {}) => {
    const { loadActivity: doActivity = false } = options;
    workspaces = await api.listWorkspaces();
    renderWorkspaceList();
    renderSessionTabs();

    if (api.listProtocolDiagnostics) {
      protocolEvents = await api.listProtocolDiagnostics(80);
      renderProtocolDiagnostics();
    }

    if (api.listRestoreDiagnostics) {
      restoreEvents = await api.listRestoreDiagnostics(80);
      renderRestoreDiagnostics();
    }

    renderSelectedWorkspaceDiagnostics();

    if (doActivity) await loadActivity();
    await renderWorkspaceSurface();
  };

  /* ─── Quick Actions Palette ───────────────────────────────────────── */
  let quickActionsController = null;
  let initController = null;

  /* ─── Settings ────────────────────────────────────────────────────── */
  // The Settings modal now owns both the shortcut keys and the AI-provider
  // key management UI. `bindSettings` is kept as a thin shim so the existing
  // initController wiring continues to work; the real logic lives in
  // settingsModalController.js.
  let settingsModalController = null;
  const bindSettings = () => {
    settingsModalController = modules.createSettingsModalController?.({
      elements,
      api,
      onShortcutsSaved: ({ paletteKey, restartKey }) => {
        paletteShortcut = paletteKey;
        restartShortcut = restartKey;
      },
    }) || null;
    settingsModalController?.bind();
  };

  /* ─── Workspace Search / Sort ─────────────────────────────────────── */
  const bindWorkspaceFilters = () => {
    workspaceListController?.bindFilters();
  };

  /* ─── Initialization ──────────────────────────────────────────────── */
  const init = async () => {
    initController = modules.createInitController?.() || null;
    await initController?.init({
      api,
      modules,
      elements,
      setStatus,
      persistIdeThemePreference,
      updateTerminalTheme,
      reskinPreviewPlaceholders,
      rebuildIdeFramesForTheme,
      applyThemeToAllIdeFrames,
      fitAllTerminals,
      getSelectedWorkspace,
      setThemeController: (next) => { themeController = next; },
      getThemeController: () => themeController,
      setTerminalViewController: (next) => { terminalViewController = next; },
      getTerminalViewController: () => terminalViewController,
      setUiChromeController: (next) => { uiChromeController = next; },
      getUiChromeController: () => uiChromeController,
      setDiagnosticsController: (next) => { diagnosticsController = next; },
      setBrowserTabsController: (next) => { browserTabsController = next; },
      setTerminalTabsController: (next) => { terminalTabsController = next; },
      setWorkspaceListController: (next) => { workspaceListController = next; },
      setWorkspaceModalController: (next) => { workspaceModalController = next; },
      getWorkspaceModalController: () => workspaceModalController,
      setPreviewManager: (next) => { previewManager = next; },
      getPreviewManager: () => previewManager,
      setQuickActionsController: (next) => { quickActionsController = next; },
      getQuickActionsController: () => quickActionsController,
      getSelectedWorkspaceId: () => selectedWorkspaceId,
      setSelectedWorkspaceId: (next) => { selectedWorkspaceId = next; },
      getActiveTerminalId: () => activeTerminalId,
      setActiveTerminalId: (next) => { activeTerminalId = next; },
      getLayoutMode: () => layoutMode,
      setLayoutMode: (next) => { layoutMode = next; },
      getFocusedSurface: () => focusedSurface,
      setFocusedSurface: (next) => { focusedSurface = next; },
      getSidebarCollapsed: () => sidebarCollapsed,
      setSidebarCollapsed: (next) => { sidebarCollapsed = next; },
      getIdeRatio: () => ideRatio,
      setIdeRatio: (next) => { ideRatio = next; },
      getWorkspaces: () => workspaces,
      getBrowserTabs: () => browserTabs,
      setBrowserTabs: (next) => { browserTabs = next; },
      getActiveBrowserTab: () => activeBrowserTab,
      setActiveBrowserTab: (next) => { activeBrowserTab = next; },
      getBrowserTabCounter: () => browserTabCounter,
      setBrowserTabCounter: (next) => { browserTabCounter = next; },
      getTerminalTabs: () => terminalTabs,
      setTerminalTabs: (next) => { terminalTabs = next; },
      getProtocolEvents: () => protocolEvents,
      setProtocolEvents: (next) => { protocolEvents = next; },
      getActivityEvents: () => activityEvents,
      setActivityEvents: (next) => { activityEvents = next; },
      getRestoreEvents: () => restoreEvents,
      setRestoreEvents: (next) => { restoreEvents = next; },
      wsFrames,
      terminalTabsByWorkspace,
      terminalBufferByKey,
      terminalBufferKey,
      getBottomTerm,
      getFocusedTerm,
      showPrompt,
      refresh,
      loadActivity,
      renderWorkspaceSurface,
      openWorkspaceModal,
      toggleSidebar,
      bindSurfaceSplitter,
      bindLayoutSwitcher,
      bindPanelCardToggles,
      bindBottomPanelTabs,
      bindBrowserTabs,
      bindTerminalTabs,
      bindSettings,
      bindWorkspaceFilters,
      renderProtocolDiagnostics,
      renderActivityDiagnostics,
      renderRestoreDiagnostics,
      scheduleWorkspaceUpdateFlush,
      setPendingWorkspacesPayload: (next) => { pendingWorkspacesPayload = next; },
      applyWorkspacePatch,
      startAppPreviewWithRetry,
      getResolvedTheme,
      getActivePreviewFrame,
      switchBrowserTab,
      updateSidebarState,
      applyIdeRatio,
      applyLayoutMode,
      getPaletteShortcut: () => paletteShortcut,
    });
  };

  void init();
})();
} // end double-execution guard
