(() => {
  const root = window;
  root.OmniRendererModules = root.OmniRendererModules || {};

  root.OmniRendererModules.createPreviewManager = ({
    getResolvedTheme,
    getActivePreviewFrame,
    switchBrowserTab,
    wsFrames,
    getSelectedWorkspaceId,
    fetchImpl,
  }) => {
    let appPreviewRetryTimer = null;
    let appPreviewTargetSrc = null;
    const fetchFn = fetchImpl || root.fetch.bind(root);

    const stopAppPreviewRetry = () => {
      if (appPreviewRetryTimer) {
        clearInterval(appPreviewRetryTimer);
        appPreviewRetryTimer = null;
      }
      appPreviewTargetSrc = null;
    };

    const isExpectedNavigationAbort = (error) => {
      if (!error) return false;
      const code = error.code ?? error.errno;
      if (code === "ERR_ABORTED" || code === -3 || code === "-3") {
        return true;
      }
      return String(error.message || "").includes("ERR_ABORTED");
    };

    const setWebviewSrcSafe = (frame, nextSrc) => {
      if (!frame || !nextSrc) return;
      if (frame.src === nextSrc) return;
      try {
        frame.src = nextSrc;
      } catch (error) {
        if (!isExpectedNavigationAbort(error)) {
          console.warn("[preview] webview src set failed", error);
        }
      }
    };

    const buildPreviewLoadingHtml = (port) => {
      const isDark = getResolvedTheme() === "dark";
      const background = isDark ? "#1f1f1f" : "#ffffff";
      const textPrimary = isDark ? "#9d9d9d" : "#4b5563";
      const textSecondary = isDark ? "#6e7681" : "#9ca3af";
      const spinnerBase = isDark ? "#3c3c3c" : "#d1d5db";
      const spinnerTop = isDark ? "#0078d4" : "#2563eb";
      return `<!doctype html><html><head><style>
      body { margin:0; display:flex; align-items:center; justify-content:center; height:100vh;
             font:14px system-ui; color:${textPrimary}; background:${background}; flex-direction:column; gap:12px; }
      .spinner { width:24px; height:24px; border:3px solid ${spinnerBase}; border-top-color:${spinnerTop};
                 border-radius:50%; animation:spin 0.8s linear infinite; }
      @keyframes spin { to { transform:rotate(360deg); } }
    </style></head><body>
      <div class="spinner"></div>
      <div>Waiting for server on port ${port}\u2026</div>
      <div style="font-size:12px;color:${textSecondary};">Will auto-load when ready</div>
    </body></html>`;
    };

    const buildPreviewNoPortHtml = () => {
      const isDark = getResolvedTheme() === "dark";
      const background = isDark ? "#1f1f1f" : "#ffffff";
      const text = isDark ? "#9d9d9d" : "#4b5563";
      return `<!doctype html><html><body style='margin:0;padding:24px;font:14px system-ui;color:${text};background:${background};'>Set an app port to load the browser preview.</body></html>`;
    };

    const renderPreviewLoading = (frame, port) => {
      if (!frame) return;
      const src = "data:text/html;charset=utf-8," + encodeURIComponent(buildPreviewLoadingHtml(port));
      setWebviewSrcSafe(frame, src);
    };

    const renderPreviewNoPort = (frame) => {
      if (!frame) return;
      const src = "data:text/html;charset=utf-8," + encodeURIComponent(buildPreviewNoPortHtml());
      setWebviewSrcSafe(frame, src);
    };

    const reskinPreviewPlaceholders = () => {
      wsFrames.forEach((ws) => {
        if (typeof ws.previewLoadingPort === "number") {
          renderPreviewLoading(ws.previewFrame, ws.previewLoadingPort);
          return;
        }
        if (ws.usingSrcDoc) {
          renderPreviewNoPort(ws.previewFrame);
        }
      });
    };

    const showPreviewLoading = (port) => {
      const frame = getActivePreviewFrame();
      if (!frame) return;
      switchBrowserTab("preview", { persist: false });
      const ws = wsFrames.get(getSelectedWorkspaceId());
      if (ws) {
        ws.previewLoadingPort = port;
        ws.usingSrcDoc = false;
      }
      renderPreviewLoading(frame, port);
    };

    const startAppPreviewWithRetry = (targetSrc, port) => {
      stopAppPreviewRetry();
      appPreviewTargetSrc = targetSrc;
      const capturedWsId = getSelectedWorkspaceId();
      showPreviewLoading(port);

      const loadPreview = (src) => {
        stopAppPreviewRetry();
        const ws = wsFrames.get(capturedWsId);
        if (ws) {
          ws.previewLoadingPort = undefined;
        }
        const frame = ws?.previewFrame;
        if (!frame) return;
        setWebviewSrcSafe(frame, src);
      };

      const tryLoad = async () => {
        try {
          const res = await fetchFn(targetSrc, { method: "HEAD" });
          if (!res.ok) return false;
          loadPreview(targetSrc);
          return true;
        } catch {
          return false;
        }
      };

      tryLoad().then((ok) => {
        if (ok || appPreviewTargetSrc !== targetSrc) return;
        appPreviewRetryTimer = setInterval(async () => {
          if (appPreviewTargetSrc !== targetSrc) {
            stopAppPreviewRetry();
            return;
          }
          await tryLoad();
        }, 2000);
      });
    };

    return {
      stopAppPreviewRetry,
      renderPreviewLoading,
      renderPreviewNoPort,
      reskinPreviewPlaceholders,
      startAppPreviewWithRetry,
    };
  };
})();
