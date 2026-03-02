(() => {
  const root = window;
  root.OmniRendererModules = root.OmniRendererModules || {};

  root.OmniRendererModules.createBrowserTabsController = ({
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
    getWsFrames,
    startAppPreviewWithRetry,
    onToggleDevTools,
  }) => {
    const getTabIframe = (tabId) => {
      const selectedWorkspaceId = getSelectedWorkspaceId();
      if (!selectedWorkspaceId) return null;
      return elements.browserTabContent?.querySelector(
        `webview[data-workspace-id="${selectedWorkspaceId}"][data-tab-id="${tabId}"]`,
      );
    };

    const snapshotBrowserTabs = (workspaceId) => {
      const browserTabs = getBrowserTabs();
      return browserTabs.map((tab) => {
        if (tab.id === "preview") {
          return {
            id: tab.id,
            label: tab.label,
            closable: false,
          };
        }

        const frame = elements.browserTabContent?.querySelector(
          `webview[data-workspace-id="${workspaceId}"][data-tab-id="${tab.id}"]`,
        );
        const currentUrl = frame?.getURL?.() || frame?.src || tab.url;
        return {
          id: tab.id,
          label: tab.label,
          closable: Boolean(tab.closable),
          ...(currentUrl ? { url: currentUrl } : {}),
        };
      });
    };

    const persistBrowserTabState = (workspaceId = getSelectedWorkspaceId()) => {
      if (!workspaceId || !api?.setBrowserState) {
        return;
      }

      const tabsSnapshot = snapshotBrowserTabs(workspaceId);
      void api.setBrowserState(workspaceId, tabsSnapshot, getActiveBrowserTab() || "preview");
    };

    const renderBrowserTabBar = () => {
      if (!elements.browserTabs) return;
      elements.browserTabs.innerHTML = "";
      const browserTabs = getBrowserTabs();
      const activeBrowserTab = getActiveBrowserTab();

      for (const tab of browserTabs) {
        const btn = document.createElement("button");
        btn.className = `browser-tab${tab.id === activeBrowserTab ? " active" : ""}`;
        btn.dataset.tabId = tab.id;
        btn.title = tab.label;

        const label = document.createElement("span");
        label.className = "browser-tab-label";
        label.textContent = tab.label;
        btn.appendChild(label);

        if (tab.closable) {
          const close = document.createElement("span");
          close.className = "browser-tab-close";
          close.textContent = "\u00d7";
          close.addEventListener("click", (event) => {
            event.stopPropagation();
            closeBrowserTab(tab.id);
          });
          btn.appendChild(close);
        }

        btn.addEventListener("click", () => switchBrowserTab(tab.id));
        elements.browserTabs.appendChild(btn);
      }
    };

    const switchBrowserTab = (tabId, options = { persist: true }) => {
      setActiveBrowserTab(tabId);
      const wsId = getSelectedWorkspaceId();

      elements.browserTabContent?.querySelectorAll(".browser-frame").forEach((frame) => {
        const match = frame.dataset.workspaceId === wsId && frame.dataset.tabId === tabId;
        frame.classList.toggle("active", match);
      });

      elements.browserTabs?.querySelectorAll(".browser-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tabId === tabId);
      });

      const isCustom = tabId !== "preview";
      elements.browserAddressBar?.classList.toggle("hidden", !isCustom);

      if (isCustom && elements.browserAddressInput) {
        const iframe = getTabIframe(tabId);
        const src = iframe?.src || iframe?.getURL?.() || "";
        elements.browserAddressInput.value = src.startsWith("about:") || src.startsWith("data:") ? "" : src;
        elements.browserAddressInput.focus();
      }

      if (options.persist) {
        persistBrowserTabState();
      }
    };

    const createBrowserTab = (url) => {
      const selectedWorkspaceId = getSelectedWorkspaceId();
      if (!selectedWorkspaceId) return null;

      const nextCounter = getBrowserTabCounter() + 1;
      setBrowserTabCounter(nextCounter);
      const tabId = `tab-${nextCounter}`;

      let label = "New Tab";
      if (url) {
        try {
          label = new URL(url).hostname || "New Tab";
        } catch {
          label = "New Tab";
        }
      }

      setBrowserTabs([...getBrowserTabs(), { id: tabId, label, closable: true }]);

      const workspace = getWorkspaces().find((w) => w.id === selectedWorkspaceId);
      const partition = workspace?.partition || `persist:session_${selectedWorkspaceId}`;

      const wv = document.createElement("webview");
      wv.className = "surface-frame browser-frame";
      wv.dataset.tabId = tabId;
      wv.dataset.workspaceId = selectedWorkspaceId;
      wv.setAttribute("partition", partition);
      wv.setAttribute("allowpopups", "");
      wv.title = label;
      if (url) wv.src = url;
      elements.browserTabContent?.appendChild(wv);

      renderBrowserTabBar();
      switchBrowserTab(tabId);
      persistBrowserTabState();
      return tabId;
    };

    const closeBrowserTab = (tabId) => {
      if (tabId === "preview") return;

      const wv = getTabIframe(tabId);
      wv?.remove();

      const browserTabs = getBrowserTabs().filter((tab) => tab.id !== tabId);
      setBrowserTabs(browserTabs);

      if (getActiveBrowserTab() === tabId) {
        const fallback = browserTabs[browserTabs.length - 1]?.id || "preview";
        switchBrowserTab(fallback);
      }

      renderBrowserTabBar();
      persistBrowserTabState();
    };

    const navigateBrowserTab = (tabId, rawUrl) => {
      if (tabId === "preview") return;
      const wv = getTabIframe(tabId);
      if (!wv) return;

      let url = rawUrl.trim();
      if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
      if (!url) return;

      wv.src = url;

      const browserTabs = getBrowserTabs();
      const tab = browserTabs.find((entry) => entry.id === tabId);
      if (tab) {
        try {
          tab.label = new URL(url).hostname || url;
        } catch {
          tab.label = url;
        }
      }
      setBrowserTabs(browserTabs);
      renderBrowserTabBar();
      persistBrowserTabState();
    };

    const bind = () => {
      elements.browserTabNew?.addEventListener("click", () => {
        createBrowserTab("");
      });

      const doNavigate = () => {
        const activeBrowserTab = getActiveBrowserTab();
        if (activeBrowserTab === "preview") return;
        const url = elements.browserAddressInput?.value || "";
        navigateBrowserTab(activeBrowserTab, url);
      };

      elements.browserAddressGo?.addEventListener("click", doNavigate);
      elements.browserAddressInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") doNavigate();
      });

      elements.previewRefresh?.addEventListener("click", () => {
        const activeBrowserTab = getActiveBrowserTab();
        const selectedWorkspaceId = getSelectedWorkspaceId();

        if (activeBrowserTab === "preview") {
          const selected = getSelectedWorkspace();
          if (!selected?.appPort) return;
          const src = `http://localhost:${selected.appPort}`;
          const ws = getWsFrames().get(selectedWorkspaceId);
          if (ws) ws.appSrc = undefined;
          startAppPreviewWithRetry(src, selected.appPort);
        } else {
          const wv = getTabIframe(activeBrowserTab);
          if (wv) {
            const url = wv.getURL ? wv.getURL() : wv.src;
            if (url) wv.src = url;
          }
        }
      });

      elements.browserDevtools?.addEventListener("click", () => {
        onToggleDevTools();
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "F12") {
          event.preventDefault();
          onToggleDevTools();
        }
      });
    };

    return {
      bind,
      getTabIframe,
      snapshotBrowserTabs,
      persistBrowserTabState,
      renderBrowserTabBar,
      switchBrowserTab,
      createBrowserTab,
      closeBrowserTab,
      navigateBrowserTab,
    };
  };
})();
