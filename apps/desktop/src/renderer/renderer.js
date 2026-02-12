window.__omniRendererInitialized = false;

(() => {
  const el = (id) => document.getElementById(id);
  const api = window.omniAPI;

  /* ─── Element References ──────────────────────────────────────────── */
  const elements = {
    appShell: el("app"),
    sidebarToggle: el("sidebar-toggle"),
    workspaceSidebarToggle: el("workspace-sidebar-toggle"),
    workspaceFocusToggle: el("workspace-focus-toggle"),
    workspaceStatus: el("workspace-status"),
    workspaceGrid: el("workspace-grid"),
    workspaceEmpty: el("workspace-empty"),
    workspaceTitle: el("workspace-title"),
    surfaceSplitter: el("surface-splitter"),
    ideFrame: el("ide-frame"),
    appFrame: el("app-frame"),
    terminalOutput: el("terminal-output"),
    terminalInput: el("terminal-input"),
    terminalRun: el("terminal-run"),
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
  };

  /* ─── State ───────────────────────────────────────────────────────── */
  let selectedWorkspaceId;
  let workspaces = [];
  let protocolEvents = [];
  let activityEvents = [];
  let restoreEvents = [];
  let sidebarCollapsed = localStorage.getItem("omni-sidebar-collapsed") === "true";
  let currentIdeSrc;
  let currentAppSrc;
  let usingAppSrcDoc = false;
  let terminalWorkspaceId;
  let currentTheme = localStorage.getItem("omni-theme") || "system";
  let pendingWorkspacesPayload = null;
  let workspacesUpdateTimer;
  let applyingWorkspaceUpdate = false;
  let terminalSessionId;
  let focusMode = localStorage.getItem("omni-focus-mode") === "true";
  let sidebarPeek = false;
  let ideRatio = Number(localStorage.getItem("omni-ide-ratio") || "50");
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

  /* ─── Sidebar State ───────────────────────────────────────────────── */
  const updateSidebarState = () => {
    if (!elements.appShell) return;
    elements.appShell.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    elements.appShell.classList.toggle("workspace-focus", focusMode);
    elements.appShell.classList.toggle("sidebar-peek", focusMode && sidebarPeek);

    if (elements.workspaceFocusToggle) {
      elements.workspaceFocusToggle.textContent = focusMode ? "Exit Focus" : "Focus";
    }

    if (elements.workspaceSidebarToggle) {
      elements.workspaceSidebarToggle.textContent = focusMode
        ? (sidebarPeek ? "✕" : "☰")
        : (sidebarCollapsed ? "☰" : "☰");
    }
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

  /* ─── Workspace Surface ───────────────────────────────────────────── */
  const renderWorkspaceSurface = async () => {
    const selected = workspaces.find((w) => w.id === selectedWorkspaceId);

    if (!selected) {
      elements.workspaceGrid?.classList.add("hidden");
      updateEmptyState(false);
      if (elements.ideFrame) elements.ideFrame.removeAttribute("src");
      if (elements.appFrame) {
        elements.appFrame.removeAttribute("src");
        elements.appFrame.removeAttribute("srcdoc");
      }
      currentIdeSrc = undefined;
      currentAppSrc = undefined;
      usingAppSrcDoc = false;
      terminalWorkspaceId = undefined;
      terminalSessionId = undefined;
      if (elements.terminalOutput) elements.terminalOutput.textContent = "No terminal output yet.";
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

    if (elements.ideFrame) {
      const nextIdeSrc = `http://127.0.0.1:${selected.idePort}/?folder=${encodeURIComponent(selected.projectPath)}&vscode-theme=${encodeURIComponent(getIdeThemeName())}`;
      if (currentIdeSrc !== nextIdeSrc) {
        elements.ideFrame.src = nextIdeSrc;
        currentIdeSrc = nextIdeSrc;
      }
    }

    if (elements.appFrame) {
      if (selected.appPort) {
        const nextAppSrc = `http://127.0.0.1:${selected.appPort}`;
        if (usingAppSrcDoc || currentAppSrc !== nextAppSrc) {
          elements.appFrame.removeAttribute("srcdoc");
          elements.appFrame.src = nextAppSrc;
          currentAppSrc = nextAppSrc;
          usingAppSrcDoc = false;
        }
      } else {
        if (!usingAppSrcDoc) {
          elements.appFrame.removeAttribute("src");
          elements.appFrame.srcdoc = "<!doctype html><html><body style='margin:0;padding:24px;font:14px system-ui;color:#8b95a8;background:#12151e;'>Set an app port to load the browser preview.</body></html>";
          currentAppSrc = undefined;
          usingAppSrcDoc = true;
        }
      }
    }

    if (elements.terminalOutput && terminalWorkspaceId !== selected.id) {
      elements.terminalOutput.textContent = `Terminal ready \u2022 ${selected.projectPath}`;
      terminalWorkspaceId = selected.id;
    }

    if (terminalSessionId !== selected.id && api?.startTerminal) {
      await api.startTerminal(selected.id);
      terminalSessionId = selected.id;
    }
  };

  /* ─── Terminal ────────────────────────────────────────────────────── */
  const runTerminalCommand = async () => {
    if (!selectedWorkspaceId || !api?.sendTerminalInput || !elements.terminalInput) return;
    const value = String(elements.terminalInput.value || "");
    if (!value.trim()) return;
    await api.sendTerminalInput(selectedWorkspaceId, `${value}\n`);
    elements.terminalInput.value = "";
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
        const value = window.prompt("Enter app port:", workspace.appPort ? String(workspace.appPort) : "3000");
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
    { group: "View", title: "Toggle Focus Mode", key: "f", action: () => {
      focusMode = !focusMode;
      localStorage.setItem("omni-focus-mode", String(focusMode));
      if (!focusMode) sidebarPeek = false;
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
        currentIdeSrc = undefined;
        void renderWorkspaceSurface();
      });
    }

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (currentTheme !== "system") return;
      currentIdeSrc = undefined;
      void renderWorkspaceSurface();
    });

    updateSidebarState();
    applyIdeRatio(ideRatio);
    bindSurfaceSplitter();
    bindPanelCardToggles();
    bindBottomPanelTabs();
    bindQuickActions();
    bindBYOK();
    bindSettings();
    bindWorkspaceFilters();

    // Sidebar toggle
    elements.sidebarToggle?.addEventListener("click", () => {
      sidebarCollapsed = !sidebarCollapsed;
      localStorage.setItem("omni-sidebar-collapsed", String(sidebarCollapsed));
      if (focusMode) sidebarPeek = !sidebarPeek;
      updateSidebarState();
    });

    elements.workspaceSidebarToggle?.addEventListener("click", () => {
      if (focusMode) {
        sidebarPeek = !sidebarPeek;
      } else {
        sidebarCollapsed = !sidebarCollapsed;
        localStorage.setItem("omni-sidebar-collapsed", String(sidebarCollapsed));
      }
      updateSidebarState();
    });

    elements.workspaceFocusToggle?.addEventListener("click", () => {
      focusMode = !focusMode;
      localStorage.setItem("omni-focus-mode", String(focusMode));
      if (!focusMode) sidebarPeek = false;
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

    // Terminal
    elements.terminalRun?.addEventListener("click", () => void runTerminalCommand());
    elements.terminalInput?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      void runTerminalCommand();
    });

    // IPC listeners
    api.onWorkspacesUpdated((payload) => {
      pendingWorkspacesPayload = payload;
      scheduleWorkspaceUpdateFlush();
    });

    api.onTerminalData((workspaceId, stream, chunk) => {
      if (workspaceId !== selectedWorkspaceId || !elements.terminalOutput) return;

      const lines = String(chunk).split(/\r?\n/).filter((l) => l.length > 0);
      if (lines.length === 0) return;

      const existing = elements.terminalOutput.textContent === "No terminal output yet."
        ? []
        : String(elements.terminalOutput.textContent || "").split(/\r?\n/);

      const merged = [...existing, ...lines.map((l) => `${stream === "stderr" ? "[err]" : "[out]"} ${l}`)].slice(-400);
      elements.terminalOutput.textContent = merged.join("\n");
      elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
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
