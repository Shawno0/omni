(() => {
  const root = window;
  root.OmniRendererModules = root.OmniRendererModules || {};

  root.OmniRendererModules.createWorkspaceListController = ({
    elements,
    api,
    getWorkspaces,
    getSelectedWorkspaceId,
    setSelectedWorkspaceId,
    refresh,
    loadActivity,
    renderWorkspaceSurface,
    openWorkspaceModal,
    setDiagnostics,
    setStatus,
    showPrompt,
  }) => {
    const getFilteredSortedWorkspaces = () => {
      const search = (elements.workspaceSearch?.value || "").trim().toLowerCase();
      const sort = elements.workspaceSort?.value || "recent";

      let list = getWorkspaces();

      if (search) {
        list = list.filter((workspace) =>
          workspace.name.toLowerCase().includes(search) ||
          (workspace.projectPath || "").toLowerCase().includes(search),
        );
      }

      list = [...list].sort((a, b) => {
        if (sort === "name") return (a.name || "").localeCompare(b.name || "");
        if (sort === "status") return (a.status || "").localeCompare(b.status || "");
        if (sort === "favorites") {
          const af = localStorage.getItem(`omni-fav-${a.id}`) === "true" ? 0 : 1;
          const bf = localStorage.getItem(`omni-fav-${b.id}`) === "true" ? 0 : 1;
          return af - bf || (a.name || "").localeCompare(b.name || "");
        }
        return 0;
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
        if (workspace.id === getSelectedWorkspaceId()) item.classList.add("selected");

        const isFav = localStorage.getItem(`omni-fav-${workspace.id}`) === "true";
        if (isFav) item.classList.add("favorite");

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
        favBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          const next = !isFav;
          localStorage.setItem(`omni-fav-${workspace.id}`, String(next));
          renderWorkspaceList();
        });

        titleRow.append(statusDot, name, favBtn);

        const pathEl = document.createElement("div");
        pathEl.className = "workspace-path";
        pathEl.textContent = workspace.projectPath || "";

        const meta = document.createElement("div");
        meta.className = "workspace-meta";

        const tierBadge = document.createElement("span");
        tierBadge.className = `badge ${workspace.resourceTier || "idle"}`;
        tierBadge.textContent = workspace.resourceTier || "idle";
        meta.append(tierBadge);

        if (workspace.terminalProgress && workspace.terminalProgress !== "idle") {
          const terminalBadge = document.createElement("span");
          terminalBadge.className = `badge ${workspace.terminalProgress}`;
          terminalBadge.textContent = workspace.terminalProgress;
          meta.append(terminalBadge);
        }

        if (workspace.appPort) {
          const portBadge = document.createElement("span");
          portBadge.className = "badge";
          portBadge.style.background = "var(--bg-active)";
          portBadge.style.color = "var(--text-tertiary)";
          portBadge.textContent = `:${workspace.appPort}`;
          meta.append(portBadge);
        }

        const actions = document.createElement("div");
        actions.className = "item-actions";

        const openBtn = document.createElement("button");
        openBtn.textContent = "Open";
        openBtn.addEventListener("click", async (event) => {
          event.stopPropagation();
          setSelectedWorkspaceId(workspace.id);
          await api.openWorkspace(workspace.id);
          await api.focusWorkspace(workspace.id);
          await refresh({ loadActivity: true });
        });

        const startStopBtn = document.createElement("button");
        startStopBtn.textContent = workspace.status === "running" ? "Stop" : "Start";
        startStopBtn.addEventListener("click", async (event) => {
          event.stopPropagation();
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
        portBtn.addEventListener("click", async (event) => {
          event.stopPropagation();
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
        removeBtn.addEventListener("click", async (event) => {
          event.stopPropagation();
          const confirmed = window.confirm(`Remove session "${workspace.name}"?`);
          if (!confirmed) return;
          try {
            await api.disposeWorkspace(workspace.id);
            if (getSelectedWorkspaceId() === workspace.id) setSelectedWorkspaceId(undefined);
            await refresh();
          } catch (error) {
            const msg = error?.message || "Failed to remove session";
            setStatus(`Failed: ${msg}`, true);
          }
        });

        actions.append(openBtn, startStopBtn, portBtn, removeBtn);

        item.append(titleRow, pathEl, meta, actions);

        item.addEventListener("click", async () => {
          setSelectedWorkspaceId(workspace.id);
          setDiagnostics(workspace);
          renderWorkspaceList();
          await api.focusWorkspace(workspace.id);
          await loadActivity();
          await renderWorkspaceSurface();
        });

        elements.workspaceList.append(item);
      }
    };

    const renderSessionTabs = () => {
      if (!elements.sessionTabs) return;
      elements.sessionTabs.innerHTML = "";

      for (const workspace of getWorkspaces()) {
        const tab = document.createElement("button");
        tab.className = "session-tab";
        if (workspace.id === getSelectedWorkspaceId()) tab.classList.add("active");
        tab.textContent = workspace.name;
        tab.title = workspace.projectPath;
        tab.addEventListener("click", async () => {
          setSelectedWorkspaceId(workspace.id);
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
        openWorkspaceModal();
      });
      elements.sessionTabs.append(newTab);
    };

    const bindFilters = () => {
      elements.workspaceSearch?.addEventListener("input", renderWorkspaceList);
      elements.workspaceSort?.addEventListener("change", renderWorkspaceList);
    };

    return {
      bindFilters,
      renderWorkspaceList,
      renderSessionTabs,
    };
  };
})();
