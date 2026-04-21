/**
 * Lightweight toast rail. Self-contained: injects its own DOM + CSS on
 * first activation, subscribes to `onErrorsUpdated` + `onRestoreDiagnosticsUpdated`
 * from the preload, and renders the latest errors as a bottom-right stack.
 *
 * Toasts:
 *   - info: auto-dismiss after 4s
 *   - warn: auto-dismiss after 8s
 *   - error: sticky until user dismisses, with copy-detail action
 *
 * This module does not own the bottom-panel "workspace-status" line — that
 * remains for workspace-scoped messages. This rail handles app-wide issues
 * so the user actually sees backend failures instead of silent drops.
 */
(() => {
  const root = window;
  root.OmniRendererModules = root.OmniRendererModules || {};

  root.OmniRendererModules.createToastController = ({ api } = {}) => {
    if (!api) return null;

    const seenIds = new Set();
    /** @type {Map<string, { el: HTMLElement, timer: number | null }>} */
    const visibleToasts = new Map();
    const MAX_VISIBLE = 4;

    let container = null;

    const ensureDom = () => {
      if (container) return container;
      const existing = document.getElementById("omni-toast-rail");
      if (existing) {
        container = existing;
        return container;
      }

      const style = document.createElement("style");
      style.id = "omni-toast-rail-style";
      style.textContent = `
        #omni-toast-rail {
          position: fixed;
          bottom: 16px;
          right: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          z-index: 9999;
          pointer-events: none;
          max-width: 360px;
        }
        .omni-toast {
          pointer-events: auto;
          background: var(--surface-2, #1e1e24);
          color: var(--text-primary, #f0f0f5);
          border-left: 3px solid var(--toast-accent, #888);
          border-radius: 6px;
          padding: 10px 12px;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
          font-size: 12px;
          line-height: 1.4;
          display: flex;
          flex-direction: column;
          gap: 4px;
          opacity: 0;
          transform: translateX(16px);
          transition: opacity 160ms ease, transform 160ms ease;
          max-width: 360px;
        }
        .omni-toast.visible {
          opacity: 1;
          transform: translateX(0);
        }
        .omni-toast.level-info { --toast-accent: #5b9cff; }
        .omni-toast.level-warn { --toast-accent: #f5b041; }
        .omni-toast.level-error { --toast-accent: #e74c3c; }
        .omni-toast-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
        }
        .omni-toast-source {
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          opacity: 0.8;
        }
        .omni-toast-close {
          background: transparent;
          border: 0;
          color: inherit;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          padding: 0 2px;
          opacity: 0.6;
        }
        .omni-toast-close:hover { opacity: 1; }
        .omni-toast-message { word-break: break-word; }
        .omni-toast-detail {
          margin: 4px 0 0;
          padding: 6px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 4px;
          font-family: var(--font-mono, monospace);
          font-size: 11px;
          white-space: pre-wrap;
          max-height: 120px;
          overflow: auto;
        }
        .omni-toast-actions {
          display: flex;
          gap: 8px;
          margin-top: 4px;
        }
        .omni-toast-action {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.18);
          color: inherit;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
          cursor: pointer;
        }
        .omni-toast-action:hover { background: rgba(255, 255, 255, 0.08); }
      `;
      if (!document.getElementById("omni-toast-rail-style")) {
        document.head.appendChild(style);
      }

      container = document.createElement("div");
      container.id = "omni-toast-rail";
      container.setAttribute("role", "status");
      container.setAttribute("aria-live", "polite");
      document.body.appendChild(container);
      return container;
    };

    const dismissToast = (id) => {
      const entry = visibleToasts.get(id);
      if (!entry) return;
      if (entry.timer !== null) {
        window.clearTimeout(entry.timer);
      }
      entry.el.classList.remove("visible");
      window.setTimeout(() => {
        entry.el.remove();
        visibleToasts.delete(id);
      }, 180);
    };

    const evictOldestIfNeeded = () => {
      while (visibleToasts.size >= MAX_VISIBLE) {
        const firstId = visibleToasts.keys().next().value;
        if (!firstId) break;
        dismissToast(firstId);
      }
    };

    const autoDismissDelayForLevel = (level) => {
      if (level === "error") return null; // sticky
      if (level === "warn") return 8_000;
      return 4_000;
    };

    const pushToast = (record) => {
      if (!record || !record.id || seenIds.has(record.id)) return;
      seenIds.add(record.id);
      const host = ensureDom();
      evictOldestIfNeeded();

      const el = document.createElement("div");
      el.className = `omni-toast level-${record.level || "info"}`;

      const head = document.createElement("div");
      head.className = "omni-toast-head";
      const source = document.createElement("span");
      source.className = "omni-toast-source";
      source.textContent = record.source || "omni";
      const close = document.createElement("button");
      close.className = "omni-toast-close";
      close.setAttribute("aria-label", "Dismiss");
      close.textContent = "×";
      close.addEventListener("click", () => dismissToast(record.id));
      head.append(source, close);
      el.appendChild(head);

      const message = document.createElement("div");
      message.className = "omni-toast-message";
      message.textContent = record.message || "";
      el.appendChild(message);

      if (record.detail) {
        const detail = document.createElement("pre");
        detail.className = "omni-toast-detail";
        detail.textContent = record.detail;
        el.appendChild(detail);

        const actions = document.createElement("div");
        actions.className = "omni-toast-actions";
        const copy = document.createElement("button");
        copy.className = "omni-toast-action";
        copy.textContent = "Copy";
        copy.addEventListener("click", () => {
          try {
            void navigator.clipboard?.writeText(`${record.message}\n${record.detail}`);
            copy.textContent = "Copied";
            window.setTimeout(() => { copy.textContent = "Copy"; }, 1_200);
          } catch {
            /* clipboard may be denied */
          }
        });
        actions.appendChild(copy);
        el.appendChild(actions);
      }

      host.appendChild(el);
      // Animate in on next frame.
      window.requestAnimationFrame(() => el.classList.add("visible"));

      const delay = autoDismissDelayForLevel(record.level);
      const timer =
        typeof delay === "number"
          ? window.setTimeout(() => dismissToast(record.id), delay)
          : null;
      visibleToasts.set(record.id, { el, timer });
    };

    const handleErrors = (events) => {
      if (!Array.isArray(events)) return;
      // Events arrive newest-first from the main process. Reverse so we push
      // in chronological order (oldest first) — makes the stack bottom-newest.
      const chronological = [...events].reverse();
      for (const event of chronological) {
        pushToast(event);
      }
    };

    const handleRestore = (events) => {
      if (!Array.isArray(events)) return;
      for (const event of events) {
        if (!event || !event.workspaceId) continue;
        if (event.status === "restored") continue;
        const id = `restore_${event.workspaceId}_${event.at}`;
        if (seenIds.has(id)) continue;
        pushToast({
          id,
          at: event.at,
          level: event.status === "timeout" ? "warn" : "error",
          source: "Workspace restore",
          message: `${event.workspaceName}: ${event.message}`,
        });
      }
    };

    const init = async () => {
      ensureDom();
      try {
        api.onErrorsUpdated?.(handleErrors);
      } catch (err) {
        console.warn("[omni/toast] onErrorsUpdated subscribe failed", err);
      }
      try {
        const existing = await api.listErrors?.(60);
        if (existing) handleErrors(existing);
      } catch (err) {
        console.warn("[omni/toast] listErrors failed", err);
      }
      try {
        api.onRestoreDiagnosticsUpdated?.(handleRestore);
      } catch {
        /* optional */
      }
    };

    return { init, dismiss: dismissToast };
  };
})();
