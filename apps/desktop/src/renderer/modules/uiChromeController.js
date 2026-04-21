(() => {
  const root = window;
  root.OmniRendererModules = root.OmniRendererModules || {};

  root.OmniRendererModules.createUiChromeController = ({
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
    onFitTerminals,
  }) => {
    const updateSidebarState = () => {
      if (!elements.appShell) return;
      elements.appShell.classList.toggle("sidebar-collapsed", getSidebarCollapsed());
    };

    const toggleSidebar = () => {
      const next = !getSidebarCollapsed();
      setSidebarCollapsed(next);
      localStorage.setItem("omni-sidebar-collapsed", String(next));
      updateSidebarState();
    };

    const applyFocusedSurface = () => {
      const idePane = elements.workspaceGrid?.querySelector(".surface-ide");
      const browserPane = elements.workspaceGrid?.querySelector(".surface-browser");
      const focusedTerm = elements.focusedTerminal;
      const focusedSurface = getFocusedSurface();
      const isOverview = getLayoutMode() === "overview";

      document.querySelectorAll(".focused-surface-tab").forEach((tab) => {
        tab.classList.toggle("active", !isOverview && tab.dataset.surface === focusedSurface);
      });

      // In overview mode no single surface is "active"; the grid shows all
      // three side-by-side. In focused mode exactly one of
      // ide/preview/terminal is toggled on. Keep this as the single source
      // of truth for surface visibility so `applyLayoutMode` can delegate.
      const showIde = !isOverview && focusedSurface === "ide";
      const showPreview = !isOverview && focusedSurface === "preview";
      const showTerminal = !isOverview && focusedSurface === "terminal";

      idePane?.classList.toggle("surface-active", showIde);
      browserPane?.classList.toggle("surface-active", showPreview);

      if (focusedTerm) {
        focusedTerm.classList.toggle("visible", showTerminal);
        focusedTerm.classList.toggle("hidden", !showTerminal);
      }

      // Hide the main grid only when the terminal takes full focus;
      // otherwise it always renders (overview + focused ide/preview).
      if (showTerminal) {
        elements.workspaceGrid?.classList.add("hidden");
      } else if (getSelectedWorkspaceId()) {
        elements.workspaceGrid?.classList.remove("hidden");
      }

      requestAnimationFrame(() => onFitTerminals?.());
    };

    const applyLayoutMode = () => {
      const shell = document.querySelector(".workspace-shell");
      if (!shell) return;

      const isOverview = getLayoutMode() === "overview";
      shell.classList.toggle("layout-focused", !isOverview);

      elements.layoutOverview?.classList.toggle("active", isOverview);
      elements.layoutFocused?.classList.toggle("active", !isOverview);
      elements.focusedSurfaceTabs?.classList.toggle("hidden", isOverview);

      // Always route through applyFocusedSurface so surface visibility
      // stays consistent with the layout mode — no duplicated toggles.
      applyFocusedSurface();
    };

    const setLayout = (mode) => {
      setLayoutMode(mode);
      localStorage.setItem("omni-layout", mode);
      applyLayoutMode();
    };

    const setSurface = (surface) => {
      const next = surface || "ide";
      setFocusedSurface(next);
      localStorage.setItem("omni-focused-surface", next);
      // Switching surface implies focused mode — promote automatically so
      // users don't have to click Focused first. This matches the command
      // palette "Layout: Focused (X)" actions.
      if (getLayoutMode() !== "focused") {
        setLayout("focused");
      } else {
        applyFocusedSurface();
      }
    };

    const bindLayoutSwitcher = () => {
      elements.layoutOverview?.addEventListener("click", () => setLayout("overview"));
      elements.layoutFocused?.addEventListener("click", () => setLayout("focused"));
      document.querySelectorAll(".focused-surface-tab").forEach((tab) => {
        tab.addEventListener("click", () => setSurface(tab.dataset.surface));
      });
    };

    const clampIdeRatio = (value) => Math.max(25, Math.min(75, value));

    const applyIdeRatio = (value) => {
      const next = clampIdeRatio(value);
      setIdeRatio(next);
      document.documentElement.style.setProperty("--ide-ratio", `${next}%`);
      localStorage.setItem("omni-ide-ratio", String(next));
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

      splitter.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        grid.classList.add("resizing");
        splitter.setPointerCapture(event.pointerId);
        resizeFromClientX(event.clientX);
      });

      splitter.addEventListener("pointermove", (event) => {
        if (!splitter.hasPointerCapture(event.pointerId)) return;
        resizeFromClientX(event.clientX);
      });

      const releasePointer = (event) => {
        if (splitter.hasPointerCapture(event.pointerId)) {
          splitter.releasePointerCapture(event.pointerId);
        }
        grid.classList.remove("resizing");
      };

      splitter.addEventListener("pointerup", releasePointer);
      splitter.addEventListener("pointercancel", releasePointer);

      splitter.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          applyIdeRatio(getIdeRatio() - 2);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          applyIdeRatio(getIdeRatio() + 2);
        }
      });
    };

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

    const bindBottomPanelTabs = () => {
      const tabs = document.querySelectorAll(".bottom-panel-tab");
      const contents = document.querySelectorAll(".bottom-tab-content");

      tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          const target = tab.dataset.tab;
          tabs.forEach((item) => item.classList.toggle("active", item.dataset.tab === target));
          contents.forEach((item) => item.classList.toggle("active", item.dataset.tabContent === target));
          if (target === "terminal") {
            requestAnimationFrame(() => onFitTerminals?.());
          }
        });
      });
    };

    return {
      updateSidebarState,
      toggleSidebar,
      applyFocusedSurface,
      applyLayoutMode,
      applyIdeRatio,
      setLayout,
      setSurface,
      bindLayoutSwitcher,
      bindSurfaceSplitter,
      bindPanelCardToggles,
      bindBottomPanelTabs,
    };
  };
})();
