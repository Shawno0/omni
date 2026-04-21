(() => {
  const root = window;
  root.OmniRendererModules = root.OmniRendererModules || {};

  root.OmniRendererModules.createTerminalViewController = ({
    elements,
    api,
    getSelectedWorkspaceId,
    getActiveTerminalId,
    getLayoutMode,
    getFocusedSurface,
  }) => {
    const Terminal = window.Terminal;
    const FitAddon = window.FitAddon;

    // Single-instance xterm architecture: we keep one `Terminal` + one
    // `FitAddon`, mounted into a persistent host element (`termHost`).
    // When the layout switches between the bottom panel and the focused
    // surface we physically reparent `termHost` into whichever container
    // is visible. xterm's internal canvas follows the DOM move, which
    // eliminates the duplicate write/reset bookkeeping the controller
    // used to do for mirrored instances — and halves memory/CPU since
    // every PTY byte was previously written twice.
    let term = null;
    let fitAddon = null;
    let termHost = null;
    /** Container currently hosting `termHost` (bottom or focused). */
    let activeContainer = null;

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

    const createXtermInstance = () => {
      if (!Terminal || !FitAddon) return null;
      const host = document.createElement("div");
      host.className = "xterm-host";
      const addon = new FitAddon.FitAddon();
      const instance = new Terminal({
        theme: xtermDarkTheme,
        fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: "bar",
        allowProposedApi: true,
        scrollback: 5000,
      });
      instance.loadAddon(addon);
      return { term: instance, fitAddon: addon, host };
    };

    /**
     * Decides which container the shared xterm host should live in,
     * based on the current layout mode + focused surface, and moves
     * the host if it is somewhere else. Safe to call repeatedly.
     */
    const syncHostContainer = () => {
      if (!termHost) return null;
      const preferFocused =
        getLayoutMode() === "focused" && getFocusedSurface() === "terminal";
      const target = preferFocused
        ? elements.focusedTerminalContainer
        : elements.terminalContainer;
      if (!target) return activeContainer;
      if (termHost.parentElement !== target) {
        target.appendChild(termHost);
        activeContainer = target;
        // xterm computes its renderer dimensions from the host's bounding
        // box; the DOM move invalidates those, so fit on the next frame
        // once layout settles.
        requestAnimationFrame(() => {
          try {
            fitAddon?.fit();
          } catch {}
        });
      } else {
        activeContainer = target;
      }
      return activeContainer;
    };

    const fitAllTerminals = () => {
      syncHostContainer();
      try {
        fitAddon?.fit();
      } catch {}

      if (term && getSelectedWorkspaceId() && getActiveTerminalId() && api?.resizeTerminal) {
        api.resizeTerminal(getSelectedWorkspaceId(), getActiveTerminalId(), term.cols, term.rows);
      }
    };

    const init = () => {
      const diagnostics = [];
      diagnostics.push(`Terminal=${typeof Terminal} (${Terminal ? "ok" : "MISSING"})`);
      diagnostics.push(`FitAddon=${typeof FitAddon} (${FitAddon ? "ok" : "MISSING"})`);
      diagnostics.push(`container=${elements.terminalContainer ? "ok" : "MISSING"}`);
      diagnostics.push(`focusedContainer=${elements.focusedTerminalContainer ? "ok" : "MISSING"}`);

      const created = createXtermInstance();
      if (!created) {
        if (elements.terminalContainer) {
          elements.terminalContainer.innerHTML = `<pre style="color:#f87171;padding:8px;font:12px monospace;">[xterm init failed]\n${diagnostics.join("\n")}</pre>`;
        }
        return;
      }

      term = created.term;
      fitAddon = created.fitAddon;
      termHost = created.host;

      // Park the host in whichever container is currently visible, then
      // open xterm against it. `term.open()` only needs to be called once
      // and is happy to follow subsequent `appendChild` reparenting.
      syncHostContainer();
      if (activeContainer) {
        term.open(termHost);
      }

      term.onData((data) => {
        if (getSelectedWorkspaceId() && getActiveTerminalId() && api?.sendTerminalInput) {
          api.sendTerminalInput(getSelectedWorkspaceId(), getActiveTerminalId(), data);
        }
      });

      term.write(`\x1b[36m[xterm] ${diagnostics.join(", ")}\x1b[0m\r\n`);
      term.write("\x1b[36m[xterm] single-instance terminal ready\x1b[0m\r\n");

      const termTabContent = elements.terminalContainer?.closest(".bottom-tab-content");
      if (termTabContent) {
        termTabContent.style.overflow = "hidden";
        termTabContent.style.padding = "0";
      }
      requestAnimationFrame(() => fitAllTerminals());
    };

    const updateTheme = (resolvedTheme) => {
      const theme = resolvedTheme === "dark" ? xtermDarkTheme : xtermLightTheme;
      if (!term) return;
      term.options.theme = theme;
      if (typeof term.refresh === "function") {
        term.refresh(0, Math.max(0, term.rows - 1));
      }
    };

    return {
      init,
      fitAllTerminals,
      updateTheme,
      /** Returns the single shared xterm instance (or null before init). */
      getTerminal: () => term,
      // Back-compat shims so other modules don't need to change in lockstep.
      // Both "bottom" and "focused" map to the same underlying terminal.
      getBottomTerm: () => term,
      getFocusedTerm: () => term,
      reset: () => term?.reset(),
      write: (data) => term?.write(data),
      // Deprecated aliases kept while callers are migrated.
      resetBoth: () => term?.reset(),
      writeBoth: (data) => term?.write(data),
      fitBottomPanelOnly: () => {
        if (activeContainer !== elements.terminalContainer) return;
        try {
          fitAddon?.fit();
        } catch {}
      },
    };
  };
})();
