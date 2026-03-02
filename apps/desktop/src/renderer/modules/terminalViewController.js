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

    let bottomTerm = null;
    let bottomFit = null;
    let focusedTerm = null;
    let focusedFit = null;

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
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
        } catch {}
      });
      return { term, fitAddon };
    };

    const fitAllTerminals = () => {
      try {
        bottomFit?.fit();
      } catch {}
      try {
        focusedFit?.fit();
      } catch {}

      const activeTerm =
        getLayoutMode() === "focused" && getFocusedSurface() === "terminal"
          ? focusedTerm
          : bottomTerm;

      if (activeTerm && getSelectedWorkspaceId() && getActiveTerminalId() && api?.resizeTerminal) {
        api.resizeTerminal(getSelectedWorkspaceId(), getActiveTerminalId(), activeTerm.cols, activeTerm.rows);
      }
    };

    const init = () => {
      const diagnostics = [];
      diagnostics.push(`Terminal=${typeof Terminal} (${Terminal ? "ok" : "MISSING"})`);
      diagnostics.push(`FitAddon=${typeof FitAddon} (${FitAddon ? "ok" : "MISSING"})`);
      diagnostics.push(`container=${elements.terminalContainer ? "ok" : "MISSING"}`);
      diagnostics.push(`focusedContainer=${elements.focusedTerminalContainer ? "ok" : "MISSING"}`);

      const bottom = createXtermInstance(elements.terminalContainer);
      if (bottom) {
        bottomTerm = bottom.term;
        bottomFit = bottom.fitAddon;
        bottomTerm.onData((data) => {
          if (getSelectedWorkspaceId() && getActiveTerminalId() && api?.sendTerminalInput) {
            api.sendTerminalInput(getSelectedWorkspaceId(), getActiveTerminalId(), data);
          }
        });
        bottomTerm.write(`\x1b[36m[xterm] ${diagnostics.join(", ")}\x1b[0m\r\n`);
        bottomTerm.write("\x1b[36m[xterm] bottomTerm created successfully\x1b[0m\r\n");
      } else if (elements.terminalContainer) {
        elements.terminalContainer.innerHTML = `<pre style="color:#f87171;padding:8px;font:12px monospace;">[xterm init failed]\n${diagnostics.join("\n")}</pre>`;
      }

      const focused = createXtermInstance(elements.focusedTerminalContainer);
      if (focused) {
        focusedTerm = focused.term;
        focusedFit = focused.fitAddon;
        focusedTerm.onData((data) => {
          if (getSelectedWorkspaceId() && getActiveTerminalId() && api?.sendTerminalInput) {
            api.sendTerminalInput(getSelectedWorkspaceId(), getActiveTerminalId(), data);
          }
        });
      }

      const termTabContent = elements.terminalContainer?.closest(".bottom-tab-content");
      if (termTabContent) {
        termTabContent.style.overflow = "hidden";
        termTabContent.style.padding = "0";
        requestAnimationFrame(() => fitAllTerminals());
      }
    };

    const updateTheme = (resolvedTheme) => {
      const theme = resolvedTheme === "dark" ? xtermDarkTheme : xtermLightTheme;
      if (bottomTerm) {
        bottomTerm.options.theme = theme;
        if (typeof bottomTerm.refresh === "function") {
          bottomTerm.refresh(0, Math.max(0, bottomTerm.rows - 1));
        }
      }
      if (focusedTerm) {
        focusedTerm.options.theme = theme;
        if (typeof focusedTerm.refresh === "function") {
          focusedTerm.refresh(0, Math.max(0, focusedTerm.rows - 1));
        }
      }
    };

    return {
      init,
      fitAllTerminals,
      updateTheme,
      getBottomTerm: () => bottomTerm,
      getFocusedTerm: () => focusedTerm,
      resetBoth: () => {
        bottomTerm?.reset();
        focusedTerm?.reset();
      },
      writeBoth: (data) => {
        bottomTerm?.write(data);
        focusedTerm?.write(data);
      },
      fitBottomPanelOnly: () => {
        try {
          bottomFit?.fit();
        } catch {}
      },
    };
  };
})();
