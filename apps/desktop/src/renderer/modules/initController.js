(() => {
  const root = window;
  root.OmniRendererModules = root.OmniRendererModules || {};

  root.OmniRendererModules.createInitController = () => {
    const init = async (ctx) => {
      const {
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
        setThemeController,
        getThemeController,
        setTerminalViewController,
        getTerminalViewController,
        setUiChromeController,
        setDiagnosticsController,
        setBrowserTabsController,
        setTerminalTabsController,
        setWorkspaceListController,
        setWorkspaceModalController,
        getWorkspaceModalController,
        setPreviewManager,
        setQuickActionsController,
        getQuickActionsController,
        getSelectedWorkspaceId,
        setSelectedWorkspaceId,
        getActiveTerminalId,
        setActiveTerminalId,
        getLayoutMode,
        setLayoutMode,
        getFocusedSurface,
        setFocusedSurface,
        getSidebarCollapsed,
        setSidebarCollapsed,
        getIdeRatio,
        setIdeRatio,
        getWorkspaces,
        getBrowserTabs,
        setBrowserTabs,
        getActiveBrowserTab,
        setActiveBrowserTab,
        getBrowserTabCounter,
        setBrowserTabCounter,
        getTerminalTabs,
        setTerminalTabs,
        getProtocolEvents,
        setProtocolEvents,
        setActivityEvents,
        setRestoreEvents,
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
        startAppPreviewWithRetry,
        getResolvedTheme,
        getActivePreviewFrame,
      } = ctx;

      if (!api || typeof api.listWorkspaces !== "function") {
        setStatus("Desktop bridge unavailable. Close all app windows and relaunch.", true);
        return;
      }

      setThemeController(
        modules.createThemeController?.({
          themeToggle: elements.themeToggle,
          themeToggleIcon: elements.themeToggleIcon,
          onPersistTheme: persistIdeThemePreference,
          onThemeChanged: () => {
            updateTerminalTheme();
            reskinPreviewPlaceholders();
            rebuildIdeFramesForTheme();
            applyThemeToAllIdeFrames();
          },
        }) || null,
      );
      const themeController = getThemeController();
      themeController?.initFromStorage();
      themeController?.bindInteractions();

      setTerminalViewController(
        modules.createTerminalViewController?.({
          elements,
          api,
          getSelectedWorkspaceId,
          getActiveTerminalId,
          getLayoutMode,
          getFocusedSurface,
        }) || null,
      );

      setUiChromeController(
        modules.createUiChromeController?.({
          elements,
          getSidebarCollapsed,
          setSidebarCollapsed,
          getSelectedWorkspaceId,
          getLayoutMode,
          setLayoutMode,
          getFocusedSurface,
          setFocusedSurface,
          getIdeRatio,
          setIdeRatio,
          onFitTerminals: fitAllTerminals,
        }) || null,
      );

      setDiagnosticsController(
        modules.createDiagnosticsController?.({
          elements,
          getProtocolEvents,
          getActivityEvents: ctx.getActivityEvents,
          getRestoreEvents: ctx.getRestoreEvents,
          getSelectedWorkspace,
          getSelectedWorkspaceId,
          setStatus,
        }) || null,
      );

      ctx.updateSidebarState();
      ctx.applyIdeRatio(getIdeRatio());
      ctx.applyLayoutMode();

      setBrowserTabsController(
        modules.createBrowserTabsController?.({
          elements,
          api,
          getSelectedWorkspaceId,
          getWorkspaces,
          getBrowserTabs,
          setBrowserTabs,
          getActiveBrowserTab,
          setActiveBrowserTab,
          getBrowserTabCounter,
          setBrowserTabCounter,
          getSelectedWorkspace,
          getWsFrames: () => wsFrames,
          startAppPreviewWithRetry,
          onToggleDevTools: () => window.omniAPI.toggleDevTools(),
        }) || null,
      );

      setTerminalTabsController(
        modules.createTerminalTabsController?.({
          elements,
          api,
          getSelectedWorkspaceId,
          getActiveTerminalId,
          setActiveTerminalId,
          getTerminalTabs,
          setTerminalTabs,
          getTerminalTabsByWorkspace: () => terminalTabsByWorkspace,
          getTerminalBufferByKey: () => terminalBufferByKey,
          terminalBufferKey,
          getBottomTerm,
          getFocusedTerm,
          fitAllTerminals,
          showPrompt,
        }) || null,
      );

      setWorkspaceListController(
        modules.createWorkspaceListController?.({
          elements,
          api,
          getWorkspaces,
          getSelectedWorkspaceId,
          setSelectedWorkspaceId,
          refresh,
          loadActivity,
          renderWorkspaceSurface,
          openWorkspaceModal,
          setDiagnostics: (workspace) => {
            if (elements.diagnostics) {
              elements.diagnostics.textContent = JSON.stringify(workspace, null, 2);
            }
          },
          setStatus,
          showPrompt,
        }) || null,
      );

      bindSurfaceSplitter();
      bindLayoutSwitcher();
      bindPanelCardToggles();
      bindBottomPanelTabs();
      bindBrowserTabs();
      bindTerminalTabs();

      setWorkspaceModalController(
        modules.createWorkspaceModalController?.({
          elements,
          api,
          setStatus,
          onWorkspaceCreated: async (created) => {
            setSelectedWorkspaceId(created?.id);
            await refresh({ loadActivity: true });
          },
        }) || null,
      );
      getWorkspaceModalController()?.bind();

      setPreviewManager(
        modules.createPreviewManager?.({
          getResolvedTheme,
          getActivePreviewFrame,
          switchBrowserTab: ctx.switchBrowserTab,
          wsFrames,
          getSelectedWorkspaceId,
        }) || null,
      );

      setQuickActionsController(
        modules.createQuickActionsController?.({
          elements,
          getPaletteShortcut: ctx.getPaletteShortcut,
          getWorkspaces,
          setSelectedWorkspaceId: (workspaceId) => {
            setSelectedWorkspaceId(workspaceId);
          },
          onRefresh: refresh,
          onToggleSidebar: toggleSidebar,
          onOpenWorkspaceModal: openWorkspaceModal,
          focusWorkspace: async (workspaceId) => api.focusWorkspace(workspaceId),
        }) || null,
      );
      getQuickActionsController()?.bind();

      bindSettings();
      bindWorkspaceFilters();

      localStorage.removeItem("omni-focus-mode");

      elements.workspaceSidebarToggle?.addEventListener("click", () => {
        toggleSidebar();
      });

      elements.protocolWorkspaceFilter?.addEventListener("change", renderProtocolDiagnostics);
      elements.protocolSeverityFilter?.addEventListener("change", renderProtocolDiagnostics);

      try {
        getTerminalViewController()?.init();
      } catch (error) {
        console.warn("xterm init failed:", error);
      }

      updateTerminalTheme();
      persistIdeThemePreference();
      window.addEventListener("resize", () => fitAllTerminals());

      const bottomPanel = document.querySelector(".bottom-panel");
      if (bottomPanel && typeof ResizeObserver !== "undefined") {
        new ResizeObserver(() => {
          getTerminalViewController()?.fitBottomPanelOnly();
        }).observe(bottomPanel);
      }

      api.onWorkspacesUpdated((payload) => {
        ctx.setPendingWorkspacesPayload(payload);
        scheduleWorkspaceUpdateFlush();
      });

      api.onTerminalData((workspaceId, terminalId, data) => {
        const key = terminalBufferKey(workspaceId, terminalId);
        const existing = terminalBufferByKey.get(key) || "";
        terminalBufferByKey.set(key, existing + data);

        if (workspaceId !== getSelectedWorkspaceId() || terminalId !== getActiveTerminalId()) return;
        getTerminalViewController()?.writeBoth(data);
      });

      api.onProtocolDiagnosticsUpdated((events) => {
        setProtocolEvents(events);
        renderProtocolDiagnostics();
      });

      api.onActivityDiagnosticsUpdated((workspaceId, events) => {
        if (workspaceId !== getSelectedWorkspaceId()) return;
        setActivityEvents(events);
        renderActivityDiagnostics();
      });

      api.onRestoreDiagnosticsUpdated((events) => {
        setRestoreEvents(events);
        renderRestoreDiagnostics();
      });

      await refresh({ loadActivity: true });
      window.__omniRendererInitialized = true;
    };

    return { init };
  };
})();
