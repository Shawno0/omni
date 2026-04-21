(() => {
  const root = window;
  root.OmniRendererModules = root.OmniRendererModules || {};

  root.OmniRendererModules.createTerminalTabsController = ({
    elements,
    api,
    getSelectedWorkspaceId,
    getActiveTerminalId,
    setActiveTerminalId,
    getTerminalTabs,
    setTerminalTabs,
    getTerminalTabsByWorkspace,
    getTerminalBufferByKey,
    terminalBufferKey,
    getBottomTerm,
    getFocusedTerm,
    fitAllTerminals,
    showPrompt,
  }) => {
    const applyTerminalBufferToViews = () => {
      const bottomTerm = getBottomTerm();
      bottomTerm?.reset();

      const selectedWorkspaceId = getSelectedWorkspaceId();
      const activeTerminalId = getActiveTerminalId();
      if (!selectedWorkspaceId || !activeTerminalId) {
        return;
      }

      const key = terminalBufferKey(selectedWorkspaceId, activeTerminalId);
      const buffered = getTerminalBufferByKey().get(key);
      if (buffered) {
        bottomTerm?.write(buffered);
      }
    };

    const rememberTerminalSnapshot = (workspaceId, payload) => {
      const tabs = Array.isArray(payload?.terminals) ? payload.terminals : [];
      const nextActive = payload?.activeTerminalId;
      getTerminalTabsByWorkspace().set(workspaceId, {
        terminals: tabs,
        activeTerminalId: nextActive,
      });

      if (workspaceId === getSelectedWorkspaceId()) {
        setTerminalTabs(tabs);
        setActiveTerminalId(nextActive);
      }
    };

    const renderTerminalTabBar = () => {
      if (!elements.terminalTabs) return;
      elements.terminalTabs.innerHTML = "";

      const terminalTabs = getTerminalTabs();
      const activeTerminalId = getActiveTerminalId();

      for (const tab of terminalTabs) {
        const btn = document.createElement("button");
        btn.className = `terminal-tab${tab.id === activeTerminalId ? " active" : ""}`;
        btn.dataset.terminalId = tab.id;
        btn.title = tab.name;

        const label = document.createElement("span");
        label.className = "terminal-tab-label";
        label.textContent = tab.name;
        btn.appendChild(label);

        const close = document.createElement("span");
        close.className = "terminal-tab-close";
        close.textContent = "\u00d7";
        close.addEventListener("click", (event) => {
          event.stopPropagation();
          void closeTerminalTab(tab.id);
        });
        btn.appendChild(close);

        btn.addEventListener("click", () => {
          if (tab.id !== getActiveTerminalId()) {
            void switchTerminalTab(tab.id);
          }
        });
        btn.addEventListener("dblclick", () => {
          if (tab.id === getActiveTerminalId()) {
            void renameActiveTerminalTab();
          }
        });

        elements.terminalTabs.appendChild(btn);
      }

      if (elements.terminalTabRename) {
        elements.terminalTabRename.disabled = !getActiveTerminalId();
      }
    };

    const ensureTerminalTabsForWorkspace = async (workspaceId) => {
      if (!api?.listTerminals) return;

      let snapshot = await api.listTerminals(workspaceId);
      if (!snapshot || !Array.isArray(snapshot.terminals) || snapshot.terminals.length === 0) {
        snapshot = await api.createTerminal(workspaceId);
      }

      rememberTerminalSnapshot(workspaceId, snapshot);
      if (workspaceId === getSelectedWorkspaceId()) {
        renderTerminalTabBar();
        applyTerminalBufferToViews();
      }

      if (snapshot?.activeTerminalId && api?.startTerminal) {
        await api.startTerminal(workspaceId, snapshot.activeTerminalId);
      }
    };

    const switchTerminalTab = async (terminalId) => {
      const selectedWorkspaceId = getSelectedWorkspaceId();
      if (!selectedWorkspaceId || !terminalId || !api?.setActiveTerminal) return;
      const snapshot = await api.setActiveTerminal(selectedWorkspaceId, terminalId);
      rememberTerminalSnapshot(selectedWorkspaceId, snapshot);
      renderTerminalTabBar();
      applyTerminalBufferToViews();
      requestAnimationFrame(() => fitAllTerminals());
    };

    const createTerminalTab = async () => {
      const selectedWorkspaceId = getSelectedWorkspaceId();
      if (!selectedWorkspaceId || !api?.createTerminal) return;
      const snapshot = await api.createTerminal(selectedWorkspaceId);
      rememberTerminalSnapshot(selectedWorkspaceId, snapshot);
      renderTerminalTabBar();
      applyTerminalBufferToViews();
      requestAnimationFrame(() => fitAllTerminals());
    };

    const renameActiveTerminalTab = async () => {
      const selectedWorkspaceId = getSelectedWorkspaceId();
      const activeTerminalId = getActiveTerminalId();
      if (!selectedWorkspaceId || !activeTerminalId || !api?.renameTerminal) return;
      const active = getTerminalTabs().find((tab) => tab.id === activeTerminalId);
      const nextName = await showPrompt("Rename terminal:", active?.name || "");
      if (nextName === null) {
        return;
      }

      const normalized = String(nextName).trim();
      if (!normalized) {
        return;
      }

      const snapshot = await api.renameTerminal(selectedWorkspaceId, activeTerminalId, normalized);
      rememberTerminalSnapshot(selectedWorkspaceId, snapshot);
      renderTerminalTabBar();
    };

    const closeTerminalTab = async (terminalId) => {
      const selectedWorkspaceId = getSelectedWorkspaceId();
      if (!selectedWorkspaceId || !terminalId || !api?.closeTerminal) return;
      const snapshot = await api.closeTerminal(selectedWorkspaceId, terminalId);
      rememberTerminalSnapshot(selectedWorkspaceId, snapshot);
      renderTerminalTabBar();
      applyTerminalBufferToViews();
      if (getActiveTerminalId()) {
        await api.startTerminal(selectedWorkspaceId, getActiveTerminalId());
      }
      requestAnimationFrame(() => fitAllTerminals());
    };

    const bind = () => {
      elements.terminalTabNew?.addEventListener("click", () => {
        void createTerminalTab();
      });
      elements.terminalTabRename?.addEventListener("click", () => {
        void renameActiveTerminalTab();
      });
    };

    return {
      bind,
      applyTerminalBufferToViews,
      rememberTerminalSnapshot,
      renderTerminalTabBar,
      ensureTerminalTabsForWorkspace,
      switchTerminalTab,
      createTerminalTab,
      renameActiveTerminalTab,
      closeTerminalTab,
    };
  };
})();
