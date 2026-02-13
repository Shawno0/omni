// Guard against double-execution (script tag + executeJavaScript fallback race)
if (window.__omniRendererLoaded) {
  // Already loaded via <script> tag — skip re-injection
} else {
window.__omniRendererLoaded = true;
window.__omniRendererInitialized = false;

(() => {
  const el = (id) => document.getElementById(id);
  const api = window.omniAPI;

  /* ─── Element References ──────────────────────────────────────────── */
  const elements = {
    appShell: el("app"),
    sidebarToggle: el("sidebar-toggle"),
    workspaceSidebarToggle: el("workspace-sidebar-toggle"),
    workspaceStatus: el("workspace-status"),
    workspaceGrid: el("workspace-grid"),
    workspaceEmpty: el("workspace-empty"),
    workspaceTitle: el("workspace-title"),
    surfaceSplitter: el("surface-splitter"),
    ideFrameContent: el("ide-frame-content"),
    diagnostics: el("diagnostics"),
    workspaceList: el("workspace-list"),
    projectPath: el("project-path"),
    workspaceName: el("workspace-name"),
    createWorkspace: el("create-workspace"),
    sessionTabs: el("session-tabs"),
    themeSelect: el("theme-select"),
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
    saveOpenai: el("save-openai"),
    deleteOpenai: el("delete-openai"),
    openaiKey: el("openai-key"),
    saveAnthropic: el("save-anthropic"),
    deleteAnthropic: el("delete-anthropic"),
    anthropicKey: el("anthropic-key"),
    keyList: el("key-list"),
    layoutOverview: el("layout-overview"),
    layoutFocused: el("layout-focused"),
    focusedSurfaceTabs: el("focused-surface-tabs"),
    focusedTerminal: el("focused-terminal"),
    terminalContainer: el("terminal-container"),
    focusedTerminalContainer: el("focused-terminal-container"),
    previewRefresh: el("preview-refresh"),
    browserTabs: el("browser-tabs"),
    browserTabNew: el("browser-tab-new"),
    browserTabContent: el("browser-tab-content"),
    browserAddressBar: el("browser-address-bar"),
    browserAddressInput: el("browser-address-input"),
    browserAddressGo: el("browser-address-go"),
    browserDevtools: el("browser-devtools"),
  };

  /* ─── xterm.js Instances ──────────────────────────────────────────── */
  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon;
  let bottomTerm = null;
  let bottomFit = null;
  let focusedTerm = null;
  let focusedFit = null;

  /* VS Code Default Dark Modern terminal palette */
  const xtermDarkTheme = {
    background: "#181818",
    foreground: "#cccccc",
    cursor: "#aeafad",
    cursorAccent: "#000000",
    selectionBackground: "rgba(38, 79, 120, 0.5)",
    black: "#000000",
    red: "#cd3131",
    green: "#0dbc79",
    yellow: "#e5e510",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#11a8cd",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#e5e5e5",
  };

  /* VS Code Default Light Modern terminal palette */
  const xtermLightTheme = {
    background: "#ffffff",
    foreground: "#3b3b3b",
    cursor: "#000000",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(0, 120, 215, 0.25)",
    black: "#000000",
    red: "#cd3131",
    green: "#00bc7c",
    yellow: "#949800",
    blue: "#0451a5",
    magenta: "#bc05bc",
    cyan: "#0598bc",
    white: "#555555",
    brightBlack: "#666666",
    brightRed: "#cd3131",
    brightGreen: "#14ce14",
    brightYellow: "#b5ba00",
    brightBlue: "#0451a5",
    brightMagenta: "#bc05bc",
    brightCyan: "#0598bc",
    brightWhite: "#a5a5a5",
  };

  const createXtermInstance = (container) => {
    if (!Terminal || !FitAddon || !container) return null;
    const fitAddon = new FitAddon.FitAddon();
    const term = new Terminal({
      theme: xtermDarkTheme,
      fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 5000,
    });
    term.loadAddon(fitAddon);
    term.open(container);
    // Small delay before first fit to let layout settle
    requestAnimationFrame(() => { try { fitAddon.fit(); } catch {} });
    return { term, fitAddon };
  };

  const initTerminals = () => {
    // Diagnostic: log what globals are available
    const diag = [];
    diag.push(`Terminal=${typeof Terminal} (${Terminal ? 'ok' : 'MISSING'})`);
    diag.push(`FitAddon=${typeof FitAddon} (${FitAddon ? 'ok' : 'MISSING'})`);
    diag.push(`container=${elements.terminalContainer ? 'ok' : 'MISSING'}`);
    diag.push(`focusedContainer=${elements.focusedTerminalContainer ? 'ok' : 'MISSING'}`);

    const b = createXtermInstance(elements.terminalContainer);
    if (b) {
      bottomTerm = b.term;
      bottomFit = b.fitAddon;
      bottomTerm.onData((data) => {
        if (selectedWorkspaceId && api?.sendTerminalInput) {
          api.sendTerminalInput(selectedWorkspaceId, data);
        }
      });
      // Write init diagnostics into the terminal so they're visible
      bottomTerm.write(`\x1b[36m[xterm] ${diag.join(', ')}\x1b[0m\r\n`);
      bottomTerm.write(`\x1b[36m[xterm] bottomTerm created successfully\x1b[0m\r\n`);
    } else {
      // Terminal creation failed — show diagnostics in the container itself
      if (elements.terminalContainer) {
        elements.terminalContainer.innerHTML = `<pre style="color:#f87171;padding:8px;font:12px monospace;">[xterm init failed]\n${diag.join('\n')}</pre>`;
      }
    }
    const f = createXtermInstance(elements.focusedTerminalContainer);
    if (f) {
      focusedTerm = f.term;
      focusedFit = f.fitAddon;
      focusedTerm.onData((data) => {
        if (selectedWorkspaceId && api?.sendTerminalInput) {
          api.sendTerminalInput(selectedWorkspaceId, data);
        }
      });
    }

    // Fix: The terminal tab's parent (.bottom-tab-content) has overflow:auto,
    // which makes the browser treat Space as "scroll down" — eating the keypress
    // before xterm can handle it. We remove overflow on the terminal-specific
    // tab content so it's not scrollable (xterm handles its own scrolling).
    // Applied via JS *after* xterm creation to avoid layout measurement issues.
    const termTabContent = elements.terminalContainer?.closest(".bottom-tab-content");
    if (termTabContent) {
      termTabContent.style.overflow = "hidden";
      termTabContent.style.padding = "0";
      // Re-fit after layout change
      requestAnimationFrame(() => fitAllTerminals());
    }
  };

  const fitAllTerminals = () => {
    try { bottomFit?.fit(); } catch {}
    try { focusedFit?.fit(); } catch {}
    // Send resize to backend for whichever terminal is visible
    const activeTerm = layoutMode === "focused" && focusedSurface === "terminal" ? focusedTerm : bottomTerm;
    if (activeTerm && selectedWorkspaceId && api?.resizeTerminal) {
      api.resizeTerminal(selectedWorkspaceId, activeTerm.cols, activeTerm.rows);
    }
  };

  /* ─── State ───────────────────────────────────────────────────────── */
  let selectedWorkspaceId;
  let workspaces = [];
  let protocolEvents = [];
  let activityEvents = [];
  let restoreEvents = [];
  let sidebarCollapsed = localStorage.getItem("omni-sidebar-collapsed") === "true";
  let terminalWorkspaceId;
  let currentTheme = localStorage.getItem("omni-theme") || "system";
  let pendingWorkspacesPayload = null;
  let workspacesUpdateTimer;
  let applyingWorkspaceUpdate = false;
  let terminalSessionId;
  let ideRatio = Number(localStorage.getItem("omni-ide-ratio") || "50");
  let appPreviewRetryTimer = null;
  let appPreviewTargetSrc = null;
  let browserTabCounter = 0;
  let activeBrowserTab = "preview";
  let browserTabs = [{ id: "preview", label: "Preview", closable: false }];
  const wsFrames = new Map(); // workspaceId → per-workspace frame state
  let layoutMode = localStorage.getItem("omni-layout") || "overview"; // "overview" | "focused"
  let focusedSurface = localStorage.getItem("omni-focused-surface") || "ide"; // "ide" | "preview" | "terminal"
  let paletteShortcut = localStorage.getItem("omni-palette-key") || "k";
  let restartShortcut = localStorage.getItem("omni-restart-key") || "r";

  /* ─── Helpers ─────────────────────────────────────────────────────── */
  const getSelectedWorkspace = () => workspaces.find((w) => w.id === selectedWorkspaceId);

  const buildSessionIdentityKey = (items) => items.map((w) => `${w.id}:${w.name}`).join("|");

  const setStatus = (text, isError = false) => {
    if (!elements.workspaceStatus) return;
    elements.workspaceStatus.textContent = text;
    elements.workspaceStatus.classList.toggle("error", isError);
  };

  const applyTheme = (theme) => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    currentTheme = theme;
  };

  const getResolvedTheme = () => {
    if (currentTheme === "light" || currentTheme === "dark") return currentTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  const getIdeThemeName = () =>
    getResolvedTheme() === "dark" ? "Default Dark Modern" : "Default Light Modern";

  /** Sync xterm terminal theme with the resolved app theme. */
  const updateTerminalTheme = () => {
    const theme = getResolvedTheme() === "dark" ? xtermDarkTheme : xtermLightTheme;
    if (bottomTerm) bottomTerm.options.theme = theme;
    if (focusedTerm) focusedTerm.options.theme = theme;
  };

  /* ─── Sidebar State ───────────────────────────────────────────────── */
  const updateSidebarState = () => {
    if (!elements.appShell) return;
    elements.appShell.classList.toggle("sidebar-collapsed", sidebarCollapsed);
  };

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

  /* ─── Layout Mode ──────────────────────────────────────────────────── */
  const applyLayoutMode = () => {
    const shell = document.querySelector(".workspace-shell");
    if (!shell) return;

    const isOverview = layoutMode === "overview";
    shell.classList.toggle("layout-focused", !isOverview);

    // Toggle layout button active states
    elements.layoutOverview?.classList.toggle("active", isOverview);
    elements.layoutFocused?.classList.toggle("active", !isOverview);

    // Show/hide focused surface tabs
    elements.focusedSurfaceTabs?.classList.toggle("hidden", isOverview);

    // In overview, show both panes + splitter, hide focused terminal
    // In focused, show only the active surface pane
    const idePane = elements.workspaceGrid?.querySelector(".surface-ide");
    const browserPane = elements.workspaceGrid?.querySelector(".surface-browser");
    const splitter = elements.surfaceSplitter;
    const focusedTerm = elements.focusedTerminal;

    if (isOverview) {
      idePane?.classList.remove("surface-active");
      browserPane?.classList.remove("surface-active");
      focusedTerm?.classList.remove("visible");
      focusedTerm?.classList.add("hidden");
      // Restore the workspace grid — applyFocusedSurface() hides it when
      // the terminal is the focused surface, so we must un-hide it here.
      if (selectedWorkspaceId) {
        elements.workspaceGrid?.classList.remove("hidden");
      }
    } else {
      applyFocusedSurface();
    }

    // Re-fit terminals after layout change
    requestAnimationFrame(() => fitAllTerminals());
  };

  const applyFocusedSurface = () => {
    const idePane = elements.workspaceGrid?.querySelector(".surface-ide");
    const browserPane = elements.workspaceGrid?.querySelector(".surface-browser");
    const focusedTerm = elements.focusedTerminal;

    // Update tab active states
    document.querySelectorAll(".focused-surface-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.surface === focusedSurface);
    });

    const showIde = focusedSurface === "ide";
    const showPreview = focusedSurface === "preview";
    const showTerminal = focusedSurface === "terminal";

    idePane?.classList.toggle("surface-active", showIde);
    browserPane?.classList.toggle("surface-active", showPreview);

    if (focusedTerm) {
      focusedTerm.classList.toggle("visible", showTerminal);
      focusedTerm.classList.toggle("hidden", !showTerminal);
    }

    // Hide/show the workspace grid when terminal is focused
    if (showTerminal) {
      elements.workspaceGrid?.classList.add("hidden");
    } else if (selectedWorkspaceId) {
      elements.workspaceGrid?.classList.remove("hidden");
    }

    // Re-fit terminals when switching surfaces
    requestAnimationFrame(() => fitAllTerminals());
  };

  const bindLayoutSwitcher = () => {
    elements.layoutOverview?.addEventListener("click", () => {
      layoutMode = "overview";
      localStorage.setItem("omni-layout", "overview");
      applyLayoutMode();
    });

    elements.layoutFocused?.addEventListener("click", () => {
      layoutMode = "focused";
      localStorage.setItem("omni-layout", "focused");
      applyLayoutMode();
    });

    // Focused surface tabs
    document.querySelectorAll(".focused-surface-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        focusedSurface = tab.dataset.surface || "ide";
        localStorage.setItem("omni-focused-surface", focusedSurface);
        applyFocusedSurface();
      });
    });

    // Focused terminal input/run — handled by xterm onData, no manual wiring needed
  };

  /* ─── IDE Ratio / Splitter ────────────────────────────────────────── */
  const clampIdeRatio = (v) => Math.max(25, Math.min(75, v));

  const applyIdeRatio = (v) => {
    ideRatio = clampIdeRatio(v);
    document.documentElement.style.setProperty("--ide-ratio", `${ideRatio}%`);
    localStorage.setItem("omni-ide-ratio", String(ideRatio));
  };

  const resizeFromClientX = (clientX) => {
    if (!elements.workspaceGrid) return;
    const rect = elements.workspaceGrid.getBoundingClientRect();
    if (rect.width <= 0) return;
    const percent = ((clientX - rect.left) / rect.width) * 100;
    applyIdeRatio(percent);
  };

  const bindSurfaceSplitter = () => {
    const splitter = elements.surfaceSplitter;
    const grid = elements.workspaceGrid;
    if (!splitter || !grid) return;

    splitter.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      grid.classList.add("resizing");
      splitter.setPointerCapture(e.pointerId);
      resizeFromClientX(e.clientX);
    });

    splitter.addEventListener("pointermove", (e) => {
      if (!splitter.hasPointerCapture(e.pointerId)) return;
      resizeFromClientX(e.clientX);
    });

    const releasePointer = (e) => {
      if (splitter.hasPointerCapture(e.pointerId)) {
        splitter.releasePointerCapture(e.pointerId);
      }
      grid.classList.remove("resizing");
    };

    splitter.addEventListener("pointerup", releasePointer);
    splitter.addEventListener("pointercancel", releasePointer);

    splitter.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); applyIdeRatio(ideRatio - 2); }
      if (e.key === "ArrowRight") { e.preventDefault(); applyIdeRatio(ideRatio + 2); }
    });
  };

  /* ─── Panel Card Toggle (sidebar sections) ────────────────────────── */
  const bindPanelCardToggles = () => {
    document.querySelectorAll("[data-card-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".panel-card");
        if (!card) return;
        const isCollapsed = card.classList.toggle("collapsed");
        btn.setAttribute("aria-expanded", String(!isCollapsed));
      });
    });
  };

  /* ─── Bottom Panel Tabs ───────────────────────────────────────────── */
  const bindBottomPanelTabs = () => {
    const tabs = document.querySelectorAll(".bottom-panel-tab");
    const contents = document.querySelectorAll(".bottom-tab-content");

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === target));
        contents.forEach((c) => c.classList.toggle("active", c.dataset.tabContent === target));
        // Re-fit terminal when its tab becomes visible
        if (target === "terminal") {
          requestAnimationFrame(() => { try { bottomFit?.fit(); } catch {} });
        }
      });
    });
  };

  /* ─── Workspace Empty State ───────────────────────────────────────── */
  const updateEmptyState = (hasWorkspace) => {
    if (elements.workspaceEmpty) {
      elements.workspaceEmpty.classList.toggle("visible", !hasWorkspace);
    }
  };

  /* ─── Protocol Diagnostics ────────────────────────────────────────── */
  const renderProtocolDiagnostics = () => {
    if (!elements.protocolDiagnostics) return;
    if (protocolEvents.length === 0) {
      elements.protocolDiagnostics.textContent = "No protocol events captured.";
      return;
    }

    const wf = elements.protocolWorkspaceFilter?.value || "all";
    const sf = elements.protocolSeverityFilter?.value || "all";
    const filtered = protocolEvents.filter((ev) => {
      const wo = wf === "all" || ev.workspaceId === wf;
      const so = sf === "all" || ev.severity === sf;
      return wo && so;
    });

    if (filtered.length === 0) {
      elements.protocolDiagnostics.textContent = "No events for selected filters.";
      return;
    }

    elements.protocolDiagnostics.textContent = filtered.slice(0, 25).map((ev) => {
      const t = new Date(ev.at).toLocaleTimeString();
      return `${t}  ${ev.severity}  ${ev.method} ${ev.path}  ${ev.status}`;
    }).join("\n");
  };

  /* ─── Activity Diagnostics ────────────────────────────────────────── */
  const renderActivityDiagnostics = () => {
    if (!elements.activityDiagnostics) return;
    const selected = getSelectedWorkspace();
    if (!selectedWorkspaceId && !selected) {
      elements.activityDiagnostics.textContent = "Select a workspace to view activity.";
      return;
    }
    if (activityEvents.length === 0) {
      elements.activityDiagnostics.textContent = "No activity samples captured.";
      return;
    }
    elements.activityDiagnostics.textContent = activityEvents.slice(0, 30).map((ev) => {
      const t = new Date(ev.sampledAt).toLocaleTimeString();
      const cpu = Number(ev.cpuPercent || 0).toFixed(1);
      return `${t}  tier=${ev.tier}  cpu=${cpu}%  terminal=${ev.terminalActive ? "on" : "off"}`;
    }).join("\n");
  };

  /* ─── Restore Diagnostics ─────────────────────────────────────────── */
  const renderRestoreDiagnostics = () => {
    if (!elements.restoreDiagnostics) return;
    if (restoreEvents.length === 0) {
      elements.restoreDiagnostics.textContent = "No restore diagnostics available.";
      return;
    }
    elements.restoreDiagnostics.textContent = restoreEvents.slice(0, 20).map((ev) => {
      const t = new Date(ev.at).toLocaleTimeString();
      return `${t}  ${ev.status}  ${ev.workspaceName}  ${ev.message}`;
    }).join("\n");
  };

  /* ─── App Preview with Retry ──────────────────────────────────────── */
  const stopAppPreviewRetry = () => {
    if (appPreviewRetryTimer) {
      clearInterval(appPreviewRetryTimer);
      appPreviewRetryTimer = null;
    }
    appPreviewTargetSrc = null;
  };

  const showPreviewLoading = (port) => {
    const frame = getActivePreviewFrame();
    if (!frame) return;
    switchBrowserTab("preview");
    const loadingHtml = `<!doctype html><html><head><style>
      body { margin:0; display:flex; align-items:center; justify-content:center; height:100vh;
             font:14px system-ui; color:#9d9d9d; background:#1f1f1f; flex-direction:column; gap:12px; }
      .spinner { width:24px; height:24px; border:3px solid #3c3c3c; border-top-color:#0078d4;
                 border-radius:50%; animation:spin 0.8s linear infinite; }
      @keyframes spin { to { transform:rotate(360deg); } }
    </style></head><body>
      <div class="spinner"></div>
      <div>Waiting for server on port ${port}\u2026</div>
      <div style="font-size:12px;color:#6e7681;">Will auto-load when ready</div>
    </body></html>`;
    frame.src = "data:text/html;charset=utf-8," + encodeURIComponent(loadingHtml);
  };

  const startAppPreviewWithRetry = (targetSrc, port) => {
    stopAppPreviewRetry();
    appPreviewTargetSrc = targetSrc;
    const capturedWsId = selectedWorkspaceId; // capture for async safety
    showPreviewLoading(port);

    const tryLoad = async () => {
      try {
        const res = await fetch(targetSrc, { method: "HEAD" });
        if (!res.ok) return false;
        loadPreview(targetSrc);
        return true;
      } catch {
        return false;
      }
    };

    const loadPreview = (src) => {
      stopAppPreviewRetry();
      const frame = wsFrames.get(capturedWsId)?.previewFrame;
      if (!frame) return;
      frame.src = src;
    };

    tryLoad().then((ok) => {
      if (ok || appPreviewTargetSrc !== targetSrc) return;
      appPreviewRetryTimer = setInterval(async () => {
        if (appPreviewTargetSrc !== targetSrc) { stopAppPreviewRetry(); return; }
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

    const state = {
      ideFrame,
      ideSrc: undefined,
      previewFrame,
      appSrc: undefined,
      usingSrcDoc: false,
      tabs: [{ id: "preview", label: "Preview", closable: false }],
      activeTab: "preview",
    };
    wsFrames.set(wsId, state);
    return state;
  };

  const getActivePreviewFrame = () => {
    if (!selectedWorkspaceId) return null;
    return wsFrames.get(selectedWorkspaceId)?.previewFrame || null;
  };

  /* ─── Browser Tabs ────────────────────────────────────────────────── */
  const getTabIframe = (tabId) => {
    if (!selectedWorkspaceId) return null;
    return elements.browserTabContent?.querySelector(
      `webview[data-workspace-id="${selectedWorkspaceId}"][data-tab-id="${tabId}"]`
    );
  };

  const getTabButton = (tabId) =>
    elements.browserTabs?.querySelector(`.browser-tab[data-tab-id="${tabId}"]`);

  const renderBrowserTabBar = () => {
    if (!elements.browserTabs) return;
    elements.browserTabs.innerHTML = "";
    for (const tab of browserTabs) {
      const btn = document.createElement("button");
      btn.className = `browser-tab${tab.id === activeBrowserTab ? " active" : ""}`;
      btn.dataset.tabId = tab.id;
      btn.title = tab.label;

      const label = document.createElement("span");
      label.className = "browser-tab-label";
      label.textContent = tab.label;
      btn.appendChild(label);

      if (tab.closable) {
        const close = document.createElement("span");
        close.className = "browser-tab-close";
        close.textContent = "\u00d7";
        close.addEventListener("click", (e) => { e.stopPropagation(); closeBrowserTab(tab.id); });
        btn.appendChild(close);
      }

      btn.addEventListener("click", () => switchBrowserTab(tab.id));
      elements.browserTabs.appendChild(btn);
    }
  };

  const switchBrowserTab = (tabId) => {
    activeBrowserTab = tabId;
    const wsId = selectedWorkspaceId;

    // Show only the active workspace's active tab frame (hides all others)
    elements.browserTabContent?.querySelectorAll(".browser-frame").forEach((frame) => {
      const match = frame.dataset.workspaceId === wsId && frame.dataset.tabId === tabId;
      frame.classList.toggle("active", match);
    });

    elements.browserTabs?.querySelectorAll(".browser-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tabId === tabId);
    });

    const isCustom = tabId !== "preview";
    elements.browserAddressBar?.classList.toggle("hidden", !isCustom);

    if (isCustom && elements.browserAddressInput) {
      const iframe = getTabIframe(tabId);
      const src = iframe?.src || iframe?.getURL?.() || "";
      elements.browserAddressInput.value = src.startsWith("about:") || src.startsWith("data:") ? "" : src;
      elements.browserAddressInput.focus();
    }
  };

  const createBrowserTab = (url) => {
    if (!selectedWorkspaceId) return null;
    browserTabCounter++;
    const tabId = `tab-${browserTabCounter}`;
    let label = "New Tab";
    if (url) { try { label = new URL(url).hostname || "New Tab"; } catch { label = "New Tab"; } }
    browserTabs.push({ id: tabId, label, closable: true });

    const workspace = workspaces.find((w) => w.id === selectedWorkspaceId);
    const partition = workspace?.partition || `persist:session_${selectedWorkspaceId}`;

    const wv = document.createElement("webview");
    wv.className = "surface-frame browser-frame";
    wv.dataset.tabId = tabId;
    wv.dataset.workspaceId = selectedWorkspaceId;
    wv.setAttribute("partition", partition);
    wv.setAttribute("allowpopups", "");
    wv.title = label;
    if (url) wv.src = url;
    elements.browserTabContent?.appendChild(wv);

    renderBrowserTabBar();
    switchBrowserTab(tabId);
    return tabId;
  };

  const closeBrowserTab = (tabId) => {
    if (tabId === "preview") return;

    const wv = getTabIframe(tabId);
    wv?.remove();

    browserTabs = browserTabs.filter((t) => t.id !== tabId);

    if (activeBrowserTab === tabId) {
      const fallback = browserTabs[browserTabs.length - 1]?.id || "preview";
      switchBrowserTab(fallback);
    }

    renderBrowserTabBar();
  };

  const navigateBrowserTab = (tabId, rawUrl) => {
    if (tabId === "preview") return;
    const wv = getTabIframe(tabId);
    if (!wv) return;
    let url = rawUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    if (!url) return;
    wv.src = url;

    const tab = browserTabs.find((t) => t.id === tabId);
    if (tab) {
      try { tab.label = new URL(url).hostname || url; } catch { tab.label = url; }
    }
    renderBrowserTabBar();
  };

  const bindBrowserTabs = () => {
    elements.browserTabNew?.addEventListener("click", () => {
      createBrowserTab("");
    });

    const doNavigate = () => {
      if (activeBrowserTab === "preview") return;
      const url = elements.browserAddressInput?.value || "";
      navigateBrowserTab(activeBrowserTab, url);
    };

    elements.browserAddressGo?.addEventListener("click", doNavigate);
    elements.browserAddressInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doNavigate();
    });

    elements.previewRefresh?.addEventListener("click", () => {
      if (activeBrowserTab === "preview") {
        const selected = getSelectedWorkspace();
        if (!selected?.appPort) return;
        const src = `http://localhost:${selected.appPort}`;
        const ws = wsFrames.get(selectedWorkspaceId);
        if (ws) ws.appSrc = undefined;
        startAppPreviewWithRetry(src, selected.appPort);
      } else {
        const wv = getTabIframe(activeBrowserTab);
        if (wv) {
          const url = wv.getURL ? wv.getURL() : wv.src;
          if (url) wv.src = url;
        }
      }
    });

    elements.browserDevtools?.addEventListener("click", () => {
      window.omniAPI.toggleDevTools();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "F12") {
        e.preventDefault();
        window.omniAPI.toggleDevTools();
      }
    });
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
      terminalSessionId = undefined;
      bottomTerm?.reset();
      focusedTerm?.reset();
      if (elements.workspaceTitle) elements.workspaceTitle.textContent = "OmniContext";
      setStatus("Select or create a workspace to begin.");
      return;
    }

    setStatus(`${selected.name} \u2022 ${selected.status} \u2022 ${selected.resourceTier}`);
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

      // Terminal reset
      bottomTerm?.reset();
      focusedTerm?.reset();

      // Load incoming workspace's tab state
      browserTabs = ws.tabs;
      activeBrowserTab = ws.activeTab;
      renderBrowserTabBar();

      terminalWorkspaceId = selected.id;
    }

    // --- IDE Frame ---
    elements.ideFrameContent?.querySelectorAll(".ws-ide-frame").forEach((f) => {
      f.classList.toggle("active", f.dataset.workspaceId === selected.id);
    });

    let folderPath = selected.projectPath.replace(/\\/g, "/");
    if (/^[A-Za-z]:/.test(folderPath)) folderPath = "/" + folderPath;
    const nextIdeSrc = `http://localhost:${selected.idePort}/?folder=${encodeURIComponent(folderPath)}&vscode-theme=${encodeURIComponent(getIdeThemeName())}`;
    if (ws.ideSrc !== nextIdeSrc) {
      ws.ideFrame.src = nextIdeSrc;
      ws.ideSrc = nextIdeSrc;
    }

    // --- Browser Tabs / Preview ---
    switchBrowserTab(activeBrowserTab);

    const nextAppSrc = selected.appPort
      ? `http://localhost:${selected.appPort}`
      : null;

    if (nextAppSrc) {
      if (ws.usingSrcDoc || ws.appSrc !== nextAppSrc) {
        ws.appSrc = nextAppSrc;
        ws.usingSrcDoc = false;
        startAppPreviewWithRetry(nextAppSrc, selected.appPort);
      }
    } else {
      stopAppPreviewRetry();
      if (!ws.usingSrcDoc) {
        ws.previewFrame.src = "data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><html><body style='margin:0;padding:24px;font:14px system-ui;color:#9d9d9d;background:#1f1f1f;'>Set an app port to load the browser preview.</body></html>");
        ws.appSrc = undefined;
        ws.usingSrcDoc = true;
      }
    }

    // --- Terminal ---
    if (terminalSessionId !== selected.id && api?.startTerminal) {
      await api.startTerminal(selected.id);
      terminalSessionId = selected.id;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => fitAllTerminals());
      });
      setTimeout(() => fitAllTerminals(), 200);
    }
  };

  /* ─── Workspace List ──────────────────────────────────────────────── */
  const getFilteredSortedWorkspaces = () => {
    const search = (elements.workspaceSearch?.value || "").trim().toLowerCase();
    const sort = elements.workspaceSort?.value || "recent";

    let list = workspaces;

    // Filter
    if (search) {
      list = list.filter((w) =>
        w.name.toLowerCase().includes(search) ||
        (w.projectPath || "").toLowerCase().includes(search)
      );
    }

    // Sort
    list = [...list].sort((a, b) => {
      if (sort === "name") return (a.name || "").localeCompare(b.name || "");
      if (sort === "status") return (a.status || "").localeCompare(b.status || "");
      if (sort === "favorites") {
        const af = localStorage.getItem(`omni-fav-${a.id}`) === "true" ? 0 : 1;
        const bf = localStorage.getItem(`omni-fav-${b.id}`) === "true" ? 0 : 1;
        return af - bf || (a.name || "").localeCompare(b.name || "");
      }
      return 0; // recent — keep server order
    });

    return list;
  };

  const renderWorkspaceList = () => {
    if (!elements.workspaceList) return;
    elements.workspaceList.innerHTML = "";

    const filtered = getFilteredSortedWorkspaces();

    for (const workspace of filtered) {
      const item = document.createElement("li");
      item.className = "workspace-item";
      if (workspace.id === selectedWorkspaceId) item.classList.add("selected");

      const isFav = localStorage.getItem(`omni-fav-${workspace.id}`) === "true";
      if (isFav) item.classList.add("favorite");

      // Title row: status dot + name + favorite
      const titleRow = document.createElement("div");
      titleRow.className = "workspace-title-row";

      const statusDot = document.createElement("span");
      statusDot.className = `status-dot ${workspace.status || "stopped"}`;
      statusDot.title = workspace.status || "stopped";

      const name = document.createElement("strong");
      name.textContent = workspace.name;

      const favBtn = document.createElement("button");
      favBtn.className = `favorite-button ${isFav ? "active" : ""}`;
      favBtn.textContent = isFav ? "★" : "☆";
      favBtn.title = isFav ? "Remove from favorites" : "Add to favorites";
      favBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = !isFav;
        localStorage.setItem(`omni-fav-${workspace.id}`, String(next));
        renderWorkspaceList();
      });

      titleRow.append(statusDot, name, favBtn);

      // Path
      const pathEl = document.createElement("div");
      pathEl.className = "workspace-path";
      pathEl.textContent = workspace.projectPath || "";

      // Meta badges
      const meta = document.createElement("div");
      meta.className = "workspace-meta";

      const tierBadge = document.createElement("span");
      tierBadge.className = `badge ${workspace.resourceTier || "idle"}`;
      tierBadge.textContent = workspace.resourceTier || "idle";
      meta.append(tierBadge);

      if (workspace.appPort) {
        const portBadge = document.createElement("span");
        portBadge.className = "badge";
        portBadge.style.background = "var(--bg-active)";
        portBadge.style.color = "var(--text-tertiary)";
        portBadge.textContent = `:${workspace.appPort}`;
        meta.append(portBadge);
      }

      // Actions (shown on hover)
      const actions = document.createElement("div");
      actions.className = "item-actions";

      const openBtn = document.createElement("button");
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        selectedWorkspaceId = workspace.id;
        await api.openWorkspace(workspace.id);
        await api.focusWorkspace(workspace.id);
        await refresh({ loadActivity: true });
      });

      const startStopBtn = document.createElement("button");
      startStopBtn.textContent = workspace.status === "running" ? "Stop" : "Start";
      startStopBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (workspace.status === "running") {
          await api.stopWorkspace(workspace.id);
        } else {
          await api.startWorkspace(workspace.id);
        }
        await refresh();
      });

      const portBtn = document.createElement("button");
      portBtn.textContent = "Port";
      portBtn.title = "Set app preview port";
      portBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const value = await showPrompt("Enter app port:", workspace.appPort ? String(workspace.appPort) : "3000");
        if (value === null) return;
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        await api.setAppPort(workspace.id, parsed);
        await refresh();
      });

      const removeBtn = document.createElement("button");
      removeBtn.className = "danger";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const confirmed = window.confirm(`Remove session "${workspace.name}"?`);
        if (!confirmed) return;
        try {
          await api.disposeWorkspace(workspace.id);
          if (selectedWorkspaceId === workspace.id) selectedWorkspaceId = undefined;
          await refresh();
        } catch (error) {
          const msg = error?.message || "Failed to remove session";
          setStatus(`Failed: ${msg}`, true);
        }
      });

      actions.append(openBtn, startStopBtn, portBtn, removeBtn);

      item.append(titleRow, pathEl, meta, actions);

      // Click to select + view
      item.addEventListener("click", async () => {
        selectedWorkspaceId = workspace.id;
        if (elements.diagnostics) {
          elements.diagnostics.textContent = JSON.stringify(workspace, null, 2);
        }
        renderWorkspaceList(); // Re-render for selection styling
        // Sync focus state with backend so resource tiers update immediately
        await api.focusWorkspace(workspace.id);
        await loadActivity();
        await renderWorkspaceSurface();
      });

      elements.workspaceList.append(item);
    }
  };

  /* ─── Session Tabs ────────────────────────────────────────────────── */
  const renderSessionTabs = () => {
    if (!elements.sessionTabs) return;
    elements.sessionTabs.innerHTML = "";

    for (const workspace of workspaces) {
      const tab = document.createElement("button");
      tab.className = "session-tab";
      if (workspace.id === selectedWorkspaceId) tab.classList.add("active");
      tab.textContent = workspace.name;
      tab.title = workspace.projectPath;
      tab.addEventListener("click", async () => {
        selectedWorkspaceId = workspace.id;
        await api.focusWorkspace(workspace.id);
        await refresh({ loadActivity: true });
      });
      elements.sessionTabs.append(tab);
    }

    const newTab = document.createElement("button");
    newTab.className = "session-tab new-session";
    newTab.textContent = "+ New";
    newTab.title = "Create a new workspace";
    newTab.addEventListener("click", () => {
      elements.projectPath?.focus();
    });
    elements.sessionTabs.append(newTab);
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
    const selected = getSelectedWorkspace();
    if (elements.diagnostics) {
      elements.diagnostics.textContent = selected
        ? JSON.stringify(selected, null, 2)
        : "No workspace selected.";
    }

    if (!selected) {
      if (selectedWorkspaceId === undefined) {
        activityEvents = [];
        renderActivityDiagnostics();
        setStatus("Select or create a workspace to begin.");
      }
      return;
    }

    setStatus(`${selected.name} \u2022 ${selected.status} \u2022 ${selected.resourceTier}`);
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

        const changed = buildSessionIdentityKey(prev) !== buildSessionIdentityKey(workspaces);
        if (changed) {
          renderWorkspaceList();
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
  const quickActions = [
    { group: "Workspaces", title: "New Workspace", key: "n", action: () => elements.projectPath?.focus() },
    { group: "Workspaces", title: "Refresh All", key: "r", action: () => void refresh({ loadActivity: true }) },
    { group: "View", title: "Toggle Sidebar", key: "b", action: () => {
      sidebarCollapsed = !sidebarCollapsed;
      localStorage.setItem("omni-sidebar-collapsed", String(sidebarCollapsed));
      updateSidebarState();
    }},
  ];

  let quickActiveIndex = 0;

  const openQuickActions = () => {
    if (!elements.quickActionsOverlay) return;
    elements.quickActionsOverlay.classList.remove("hidden");
    elements.quickActionsSearch.value = "";
    quickActiveIndex = 0;
    renderQuickActions();
    setTimeout(() => elements.quickActionsSearch?.focus(), 50);
  };

  const closeQuickActions = () => {
    if (!elements.quickActionsOverlay) return;
    elements.quickActionsOverlay.classList.add("hidden");
  };

  const getFilteredQuickActions = () => {
    const q = (elements.quickActionsSearch?.value || "").trim().toLowerCase();
    // Build full list: static actions + dynamic workspace actions
    const wsActions = workspaces.map((w) => ({
      group: "Switch Workspace",
      title: w.name,
      subtitle: w.projectPath,
      action: async () => {
        selectedWorkspaceId = w.id;
        await api.focusWorkspace(w.id);
        await refresh({ loadActivity: true });
      },
    }));

    const all = [...quickActions, ...wsActions];
    if (!q) return all;
    return all.filter((a) =>
      a.title.toLowerCase().includes(q) ||
      (a.subtitle || "").toLowerCase().includes(q) ||
      (a.group || "").toLowerCase().includes(q)
    );
  };

  const renderQuickActions = () => {
    if (!elements.quickActionsList) return;
    elements.quickActionsList.innerHTML = "";

    const filtered = getFilteredQuickActions();
    let lastGroup = "";

    filtered.forEach((action, i) => {
      if (action.group !== lastGroup) {
        const groupEl = document.createElement("li");
        groupEl.className = "quick-group";
        groupEl.textContent = action.group;
        elements.quickActionsList.append(groupEl);
        lastGroup = action.group;
      }

      const item = document.createElement("li");
      item.className = `quick-item${i === quickActiveIndex ? " active" : ""}`;

      const titleEl = document.createElement("span");
      titleEl.className = "quick-title";
      titleEl.textContent = action.title;
      item.append(titleEl);

      if (action.subtitle) {
        const sub = document.createElement("span");
        sub.className = "quick-subtitle";
        sub.textContent = action.subtitle;
        item.append(sub);
      }

      if (action.key) {
        const hint = document.createElement("span");
        hint.className = "quick-keyhint";
        hint.textContent = action.key;
        item.append(hint);
      }

      item.addEventListener("click", () => {
        closeQuickActions();
        action.action();
      });

      elements.quickActionsList.append(item);
    });
  };

  const bindQuickActions = () => {
    elements.quickActionsButton?.addEventListener("click", openQuickActions);

    elements.quickActionsOverlay?.addEventListener("click", (e) => {
      if (e.target === elements.quickActionsOverlay) closeQuickActions();
    });

    elements.quickActionsSearch?.addEventListener("input", () => {
      quickActiveIndex = 0;
      renderQuickActions();
    });

    elements.quickActionsSearch?.addEventListener("keydown", (e) => {
      const filtered = getFilteredQuickActions();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        quickActiveIndex = Math.min(quickActiveIndex + 1, filtered.length - 1);
        renderQuickActions();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        quickActiveIndex = Math.max(quickActiveIndex - 1, 0);
        renderQuickActions();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[quickActiveIndex]) {
          closeQuickActions();
          filtered[quickActiveIndex].action();
        }
      } else if (e.key === "Escape") {
        closeQuickActions();
      }
    });

    // Global shortcut
    document.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === paletteShortcut) {
        e.preventDefault();
        if (elements.quickActionsOverlay?.classList.contains("hidden")) {
          openQuickActions();
        } else {
          closeQuickActions();
        }
      }
      if (e.key === "Escape" && !elements.quickActionsOverlay?.classList.contains("hidden")) {
        closeQuickActions();
      }
    });
  };

  /* ─── BYOK Key Management ─────────────────────────────────────────── */
  const refreshKeyList = async () => {
    if (!api?.listKeys || !elements.keyList) return;
    try {
      const keys = await api.listKeys();
      elements.keyList.innerHTML = "";
      if (Array.isArray(keys) && keys.length > 0) {
        for (const k of keys) {
          const li = document.createElement("li");
          li.style.cssText = "font-size:11px;color:var(--text-tertiary);padding:2px 0;";
          li.textContent = `${k.provider || k}: configured`;
          elements.keyList.append(li);
        }
      }
    } catch {}
  };

  const bindBYOK = () => {
    elements.saveOpenai?.addEventListener("click", async () => {
      const val = elements.openaiKey?.value?.trim();
      if (!val || !api?.setKey) return;
      try {
        await api.setKey("openai", val);
        elements.openaiKey.value = "";
        await refreshKeyList();
      } catch (e) {
        alert(`Failed to save OpenAI key: ${e?.message || e}`);
      }
    });

    elements.deleteOpenai?.addEventListener("click", async () => {
      if (!api?.deleteKey) return;
      try {
        await api.deleteKey("openai");
        await refreshKeyList();
      } catch (e) {
        alert(`Failed to delete OpenAI key: ${e?.message || e}`);
      }
    });

    elements.saveAnthropic?.addEventListener("click", async () => {
      const val = elements.anthropicKey?.value?.trim();
      if (!val || !api?.setKey) return;
      try {
        await api.setKey("anthropic", val);
        elements.anthropicKey.value = "";
        await refreshKeyList();
      } catch (e) {
        alert(`Failed to save Anthropic key: ${e?.message || e}`);
      }
    });

    elements.deleteAnthropic?.addEventListener("click", async () => {
      if (!api?.deleteKey) return;
      try {
        await api.deleteKey("anthropic");
        await refreshKeyList();
      } catch (e) {
        alert(`Failed to delete Anthropic key: ${e?.message || e}`);
      }
    });

    refreshKeyList();
  };

  /* ─── Settings ────────────────────────────────────────────────────── */
  const bindSettings = () => {
    if (elements.paletteKey) elements.paletteKey.value = paletteShortcut;
    if (elements.restartKey) elements.restartKey.value = restartShortcut;

    elements.saveSettings?.addEventListener("click", () => {
      const pk = (elements.paletteKey?.value || "k").trim().toLowerCase();
      const rk = (elements.restartKey?.value || "r").trim().toLowerCase();
      paletteShortcut = pk || "k";
      restartShortcut = rk || "r";
      localStorage.setItem("omni-palette-key", paletteShortcut);
      localStorage.setItem("omni-restart-key", restartShortcut);
      if (elements.settingsStatus) elements.settingsStatus.textContent = "Settings saved.";
    });

    elements.resetSettings?.addEventListener("click", () => {
      paletteShortcut = "k";
      restartShortcut = "r";
      localStorage.setItem("omni-palette-key", "k");
      localStorage.setItem("omni-restart-key", "r");
      if (elements.paletteKey) elements.paletteKey.value = "k";
      if (elements.restartKey) elements.restartKey.value = "r";
      if (elements.settingsStatus) elements.settingsStatus.textContent = "Reset to defaults.";
    });
  };

  /* ─── Workspace Search / Sort ─────────────────────────────────────── */
  const bindWorkspaceFilters = () => {
    elements.workspaceSearch?.addEventListener("input", renderWorkspaceList);
    elements.workspaceSort?.addEventListener("change", renderWorkspaceList);
  };

  /* ─── Initialization ──────────────────────────────────────────────── */
  const init = async () => {
    if (!api || typeof api.listWorkspaces !== "function") {
      setStatus("Desktop bridge unavailable. Close all app windows and relaunch.", true);
      return;
    }

    // Theme
    if (elements.themeSelect) {
      const saved = localStorage.getItem("omni-theme") || "system";
      elements.themeSelect.value = saved;
      applyTheme(saved);
      elements.themeSelect.addEventListener("change", () => {
        localStorage.setItem("omni-theme", elements.themeSelect.value);
        applyTheme(elements.themeSelect.value);
        // Sync terminal + IDE themes
        updateTerminalTheme();
        // Force IDE reload with new theme
        wsFrames.forEach((ws) => { ws.ideSrc = undefined; });
        void renderWorkspaceSurface();
      });
    }

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (currentTheme !== "system") return;
      updateTerminalTheme();
      wsFrames.forEach((ws) => { ws.ideSrc = undefined; });
      void renderWorkspaceSurface();
    });

    updateSidebarState();
    applyIdeRatio(ideRatio);
    applyLayoutMode();
    bindSurfaceSplitter();
    bindLayoutSwitcher();
    bindPanelCardToggles();
    bindBottomPanelTabs();
    bindBrowserTabs();

    bindQuickActions();
    bindBYOK();
    bindSettings();
    bindWorkspaceFilters();

    // Clear any stuck focus-mode state from previous versions
    localStorage.removeItem("omni-focus-mode");

    // Sidebar toggle
    elements.sidebarToggle?.addEventListener("click", () => {
      sidebarCollapsed = !sidebarCollapsed;
      localStorage.setItem("omni-sidebar-collapsed", String(sidebarCollapsed));
      updateSidebarState();
    });

    elements.workspaceSidebarToggle?.addEventListener("click", () => {
      sidebarCollapsed = !sidebarCollapsed;
      localStorage.setItem("omni-sidebar-collapsed", String(sidebarCollapsed));
      updateSidebarState();
    });

    // Create workspace
    elements.createWorkspace?.addEventListener("click", async () => {
      try {
        const projectPath = String(elements.projectPath?.value || "").trim();
        const name = String(elements.workspaceName?.value || "").trim();

        if (!projectPath) {
          setStatus("Project path is required.", true);
          return;
        }

        const created = await api.createWorkspace({
          projectPath,
          name: name || undefined,
        });

        selectedWorkspaceId = created.id;
        await api.openWorkspace(created.id);
        await api.focusWorkspace(created.id);

        if (elements.projectPath) elements.projectPath.value = "";
        if (elements.workspaceName) elements.workspaceName.value = "";

        await refresh({ loadActivity: true });
      } catch (error) {
        const msg = error?.message || "Failed to create workspace";
        setStatus(`Failed: ${msg}`, true);
      }
    });

    // Protocol filters
    elements.protocolWorkspaceFilter?.addEventListener("change", renderProtocolDiagnostics);
    elements.protocolSeverityFilter?.addEventListener("change", renderProtocolDiagnostics);

    // Initialize xterm.js terminals
    try { initTerminals(); } catch (e) { console.warn("xterm init failed:", e); }
    // Apply correct terminal theme based on current settings
    updateTerminalTheme();
    window.addEventListener("resize", () => fitAllTerminals());
    // Observe bottom panel resizes for terminal fit
    const bottomPanel = document.querySelector(".bottom-panel");
    if (bottomPanel && typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => { try { bottomFit?.fit(); } catch {} }).observe(bottomPanel);
    }

    // IPC listeners
    api.onWorkspacesUpdated((payload) => {
      pendingWorkspacesPayload = payload;
      scheduleWorkspaceUpdateFlush();
    });

    api.onTerminalData((workspaceId, data) => {
      if (workspaceId !== selectedWorkspaceId) return;
      bottomTerm?.write(data);
      focusedTerm?.write(data);
    });

    api.onProtocolDiagnosticsUpdated((events) => {
      protocolEvents = events;
      renderProtocolDiagnostics();
    });

    api.onActivityDiagnosticsUpdated((workspaceId, events) => {
      if (workspaceId !== selectedWorkspaceId) return;
      activityEvents = events;
      renderActivityDiagnostics();
    });

    api.onRestoreDiagnosticsUpdated((events) => {
      restoreEvents = events;
      renderRestoreDiagnostics();
    });

    await refresh({ loadActivity: true });
    window.__omniRendererInitialized = true;
  };

  void init();
})();
} // end double-execution guard
