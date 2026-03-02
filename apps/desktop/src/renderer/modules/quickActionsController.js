(() => {
  const root = window;
  root.OmniRendererModules = root.OmniRendererModules || {};

  root.OmniRendererModules.createQuickActionsController = ({
    elements,
    getPaletteShortcut,
    getWorkspaces,
    setSelectedWorkspaceId,
    onRefresh,
    onToggleSidebar,
    onOpenWorkspaceModal,
    focusWorkspace,
  }) => {
    let quickActiveIndex = 0;

    const quickActions = [
      { group: "Workspaces", title: "New Workspace", key: "n", action: () => onOpenWorkspaceModal() },
      { group: "Workspaces", title: "Refresh All", key: "r", action: () => void onRefresh({ loadActivity: true }) },
      { group: "View", title: "Toggle Sidebar", key: "b", action: () => onToggleSidebar() },
    ];

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
