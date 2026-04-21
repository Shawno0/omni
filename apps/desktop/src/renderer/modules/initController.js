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
        getUiChromeController,
        setDiagnosticsController,
        setBrowserTabsController,
        setTerminalTabsController,
        setWorkspaceListController,
        setWorkspaceModalController,
        getWorkspaceModalController,
        setPreviewManager,
        getPreviewManager,
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

      // Start the global toast rail as early as possible so backend errors
      // emitted during the rest of init show up instead of being dropped.
      try {
        const toast = modules.createToastController?.({ api });
        await toast?.init?.();
      } catch (err) {
        console.warn("[omni/init] toastController failed", err);
      }

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
          getSelectedWorkspaceId,
          setSelectedWorkspaceId: (workspaceId) => {
            setSelectedWorkspaceId(workspaceId);
          },
          onRefresh: refresh,
          onToggleSidebar: toggleSidebar,
          onOpenWorkspaceModal: openWorkspaceModal,
          focusWorkspace: async (workspaceId) => api.focusWorkspace(workspaceId),
          restartWorkspace: api?.restartWorkspace
            ? async (workspaceId) => {
                await api.restartWorkspace(workspaceId);
                await refresh({ loadActivity: true });
              }
            : null,
          stopWorkspace: api?.stopWorkspace
            ? async (workspaceId) => {
                await api.stopWorkspace(workspaceId);
                await refresh({ loadActivity: true });
              }
            : null,
          onToggleTheme: () => getThemeController()?.cycleTheme?.(),
          onToggleDevTools: () => api?.toggleDevTools?.(),
          onSetLayoutMode: (mode) => {
            getUiChromeController?.()?.setLayout?.(mode);
          },
          onSetFocusedSurface: (surface) => {
            getUiChromeController?.()?.setSurface?.(surface);
          },
          onOpenDiagnosticsTab: (tabId) => {
            const trigger = document.querySelector(`.bottom-panel-tab[data-tab="${tabId}"]`);
            trigger?.click?.();
          },
          onDetectDevPort: async (workspaceId) => {
            const preview = getPreviewManager?.();
            if (!preview?.detectRunningDevPort || !api?.setAppPort) {
              setStatus("Port auto-detect unavailable in this build.", true);
              return;
            }
            setStatus("Scanning common dev ports…");
            try {
              const port = await preview.detectRunningDevPort({ timeoutMs: 1000 });
              if (!port) {
                setStatus("No dev server detected on common ports.", true);
                return;
              }
              await api.setAppPort(workspaceId, port);
              setStatus(`Detected dev server on port ${port}.`);
              await refresh();
            } catch (err) {
              setStatus(`Detect failed: ${err?.message || "unknown error"}`, true);
            }
          },
        }) || null,
      );
      getQuickActionsController()?.bind();

      bindSettings();
      bindWorkspaceFilters();

      // Vibe overlay opener — the overlay window is owned by main; we just
      // ask main to show it. The global shortcut (Cmd/Ctrl+Shift+Space)
      // still works as before.
      elements.vibeOpen?.addEventListener("click", () => {
        if (typeof api?.showVibe === "function") {
          void api.showVibe().catch((err) => {
            console.warn("[omni/init] showVibe failed", err);
          });
        }
      });

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

      if (typeof api.onWorkspacePatch === "function" && typeof ctx.applyWorkspacePatch === "function") {
        api.onWorkspacePatch((patch) => {
          ctx.applyWorkspacePatch(patch);
        });
      }

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
