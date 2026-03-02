(() => {
  const root = (window.OmniRendererModules = window.OmniRendererModules || {});

  root.createThemeController = function createThemeController(options = {}) {
    const {
      themeToggle,
      themeToggleIcon,
      storageKey = "omni-theme",
      onPersistTheme = () => {},
      onThemeChanged = () => {},
    } = options;

    let currentTheme = localStorage.getItem(storageKey) || "system";

    const themeIconByMode = {
      light: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>`,
      dark: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"></path></svg>`,
      system: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M8 20h8"></path><path d="M12 18v2"></path></svg>`,
    };

    const applyTheme = (theme) => {
      const nextTheme = theme || "system";
      if (nextTheme === "system") {
        document.documentElement.removeAttribute("data-theme");
      } else {
        document.documentElement.setAttribute("data-theme", nextTheme);
      }
      currentTheme = nextTheme;
      return currentTheme;
    };

    const getCurrentTheme = () => currentTheme;

    const getResolvedTheme = () => {
      if (currentTheme === "light" || currentTheme === "dark") {
        return currentTheme;
      }
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };

    const getIdeThemeName = () =>
      getResolvedTheme() === "dark" ? "Default Dark Modern" : "Default Light Modern";

    const updateThemeToggleVisual = () => {
      const mode = currentTheme === "light" || currentTheme === "dark" ? currentTheme : "system";
      if (themeToggleIcon) {
        themeToggleIcon.innerHTML = themeIconByMode[mode];
      }
      if (themeToggle) {
        const nextMode = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
        themeToggle.title = `Theme: ${mode[0].toUpperCase()}${mode.slice(1)} (next: ${nextMode})`;
        themeToggle.setAttribute("aria-label", `Theme ${mode}`);
      }
    };

    const cycleThemeMode = () => {
      const nextMode = currentTheme === "system" ? "light" : currentTheme === "light" ? "dark" : "system";
      localStorage.setItem(storageKey, nextMode);
      applyTheme(nextMode);
      onPersistTheme();
      updateThemeToggleVisual();
      onThemeChanged();
    };

    const bindInteractions = () => {
      themeToggle?.addEventListener("click", () => {
        cycleThemeMode();
      });

      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (currentTheme !== "system") return;
        onPersistTheme();
        onThemeChanged();
      });
    };

    const initFromStorage = () => {
      const savedTheme = localStorage.getItem(storageKey) || "system";
      applyTheme(savedTheme);
      updateThemeToggleVisual();
      return savedTheme;
    };

    return {
      initFromStorage,
      bindInteractions,
      applyTheme,
      getCurrentTheme,
      getResolvedTheme,
      getIdeThemeName,
      updateThemeToggleVisual,
      cycleThemeMode,
    };
  };
})();
