(() => {
  const root = window;
  root.OmniRendererModules = root.OmniRendererModules || {};

  root.OmniRendererModules.createQuickActionsController = ({
    elements,
    getPaletteShortcut,
    getWorkspaces,
    getSelectedWorkspaceId,
    setSelectedWorkspaceId,
    onRefresh,
    onToggleSidebar,
    onOpenWorkspaceModal,
    focusWorkspace,
    restartWorkspace,
    stopWorkspace,
    onToggleTheme,
    onToggleDevTools,
    onSetLayoutMode,
    onSetFocusedSurface,
    onOpenDiagnosticsTab,
    onDetectDevPort,
  }) => {
    let quickActiveIndex = 0;

    const safe = (fn) => (...args) => {
      try {
        const result = fn?.(...args);
        if (result && typeof result.catch === "function") {
          result.catch((err) => console.warn("[omni/palette] action failed", err));
        }
      } catch (err) {
        console.warn("[omni/palette] action threw", err);
      }
    };

    const quickActions = [
      { group: "Workspaces", title: "New Workspace", key: "n", handler: onOpenWorkspaceModal },
      {
        group: "Workspaces",
        title: "Refresh All",
        key: "r",
        handler: onRefresh ? () => onRefresh({ loadActivity: true }) : null,
      },
      {
        group: "Workspaces",
        title: "Restart Current Workspace",
        handler: restartWorkspace ? () => {
          const id = getSelectedWorkspaceId?.();
          if (id) restartWorkspace(id);
        } : null,
      },
      {
        group: "Workspaces",
        title: "Stop Current Workspace",
        handler: stopWorkspace ? () => {
          const id = getSelectedWorkspaceId?.();
          if (id) stopWorkspace(id);
        } : null,
      },
      { group: "View", title: "Toggle Sidebar", key: "b", handler: onToggleSidebar },
      { group: "View", title: "Layout: Overview", handler: onSetLayoutMode ? () => onSetLayoutMode("overview") : null },
      {
        group: "View",
        title: "Layout: Focused (IDE)",
        handler: onSetLayoutMode && onSetFocusedSurface ? () => { onSetLayoutMode("focused"); onSetFocusedSurface("ide"); } : null,
      },
      {
        group: "View",
        title: "Layout: Focused (Preview)",
        handler: onSetLayoutMode && onSetFocusedSurface ? () => { onSetLayoutMode("focused"); onSetFocusedSurface("preview"); } : null,
      },
      {
        group: "View",
        title: "Layout: Focused (Terminal)",
        handler: onSetLayoutMode && onSetFocusedSurface ? () => { onSetLayoutMode("focused"); onSetFocusedSurface("terminal"); } : null,
      },
      { group: "View", title: "Toggle Theme", handler: onToggleTheme },
      {
        group: "Preview",
        title: "Detect App Port (scan common dev ports)",
        handler: onDetectDevPort ? () => {
          const id = getSelectedWorkspaceId?.();
          if (id) onDetectDevPort(id);
        } : null,
      },
      { group: "Diagnostics", title: "Open Diagnostics Panel", handler: onOpenDiagnosticsTab ? () => onOpenDiagnosticsTab("diagnostics") : null },
      { group: "Diagnostics", title: "Open Protocol Events", handler: onOpenDiagnosticsTab ? () => onOpenDiagnosticsTab("protocol") : null },
      { group: "Diagnostics", title: "Open Activity Monitor", handler: onOpenDiagnosticsTab ? () => onOpenDiagnosticsTab("activity") : null },
      { group: "Diagnostics", title: "Toggle Developer Tools", handler: onToggleDevTools },
    ]
      .filter((a) => typeof a.handler === "function")
      .map((a) => ({ ...a, action: safe(a.handler) }));

    const closeQuickActions = () => {
      if (!elements.quickActionsOverlay) return;
      elements.quickActionsOverlay.classList.add("hidden");
    };

    const getFilteredQuickActions = () => {
      const q = (elements.quickActionsSearch?.value || "").trim().toLowerCase();
      const wsActions = getWorkspaces().map((w) => ({
        group: "Switch Workspace",
        title: w.name,
        subtitle: w.projectPath,
        action: async () => {
          setSelectedWorkspaceId(w.id);
          await focusWorkspace(w.id);
          await onRefresh({ loadActivity: true });
        },
      }));

      const all = [...quickActions, ...wsActions];
      if (!q) return all;
      return all.filter((action) =>
        action.title.toLowerCase().includes(q) ||
        (action.subtitle || "").toLowerCase().includes(q) ||
        (action.group || "").toLowerCase().includes(q),
      );
    };

    const renderQuickActions = () => {
      if (!elements.quickActionsList) return;
      elements.quickActionsList.innerHTML = "";

      const filtered = getFilteredQuickActions();
      let lastGroup = "";

      filtered.forEach((action, index) => {
        if (action.group !== lastGroup) {
          const groupEl = document.createElement("li");
          groupEl.className = "quick-group";
          groupEl.textContent = action.group;
          elements.quickActionsList.append(groupEl);
          lastGroup = action.group;
        }

        const item = document.createElement("li");
        item.className = `quick-item${index === quickActiveIndex ? " active" : ""}`;

        const titleEl = document.createElement("span");
        titleEl.className = "quick-title";
        titleEl.textContent = action.title;
        item.append(titleEl);

        if (action.subtitle) {
          const subtitle = document.createElement("span");
          subtitle.className = "quick-subtitle";
          subtitle.textContent = action.subtitle;
          item.append(subtitle);
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

    const openQuickActions = () => {
      if (!elements.quickActionsOverlay) return;
      elements.quickActionsOverlay.classList.remove("hidden");
      elements.quickActionsSearch.value = "";
      quickActiveIndex = 0;
      renderQuickActions();
      setTimeout(() => elements.quickActionsSearch?.focus(), 50);
    };

    const bind = () => {
      elements.quickActionsButton?.addEventListener("click", openQuickActions);

      elements.quickActionsOverlay?.addEventListener("click", (event) => {
        if (event.target === elements.quickActionsOverlay) closeQuickActions();
      });

      elements.quickActionsSearch?.addEventListener("input", () => {
        quickActiveIndex = 0;
        renderQuickActions();
      });

      elements.quickActionsSearch?.addEventListener("keydown", (event) => {
        const filtered = getFilteredQuickActions();
        if (event.key === "ArrowDown") {
          event.preventDefault();
          quickActiveIndex = Math.min(quickActiveIndex + 1, filtered.length - 1);
          renderQuickActions();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          quickActiveIndex = Math.max(quickActiveIndex - 1, 0);
          renderQuickActions();
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (filtered[quickActiveIndex]) {
            closeQuickActions();
            filtered[quickActiveIndex].action();
          }
        } else if (event.key === "Escape") {
          closeQuickActions();
        }
      });

      document.addEventListener("keydown", (event) => {
        const mod = event.ctrlKey || event.metaKey;
        if (mod && event.key.toLowerCase() === getPaletteShortcut()) {
          event.preventDefault();
          if (elements.quickActionsOverlay?.classList.contains("hidden")) {
            openQuickActions();
          } else {
            closeQuickActions();
          }
        }
        if (event.key === "Escape" && !elements.quickActionsOverlay?.classList.contains("hidden")) {
          closeQuickActions();
        }
      });
    };

    return {
      bind,
      renderQuickActions,
    };
  };
})();
