(() => {
  const root = (window.OmniRendererModules = window.OmniRendererModules || {});

  const RECENT_KEY = "omni-recent-folders";
  const RECENT_MAX = 6;

  const loadRecent = () => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
    } catch {
      return [];
    }
  };

  const saveRecent = (folder) => {
    if (!folder || typeof folder !== "string") return;
    const trimmed = folder.trim();
    if (!trimmed) return;
    const existing = loadRecent().filter((entry) => entry !== trimmed);
    existing.unshift(trimmed);
    const next = existing.slice(0, RECENT_MAX);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // ignore quota errors — recents are best-effort UX.
    }
  };

  const deriveFolderName = (folderPath) => {
    const parts = folderPath.replace(/[\\/]+$/, "").split(/[\\/]/);
    return parts[parts.length - 1] || "";
  };

  root.createWorkspaceModalController = function createWorkspaceModalController(options = {}) {
    const {
      elements,
      api,
      setStatus = () => {},
      onWorkspaceCreated = async () => {},
    } = options;

    const applyFolderToInputs = (folderPath) => {
      if (!folderPath) return;
      if (elements.modalProjectPath) elements.modalProjectPath.value = folderPath;
      if (elements.modalWorkspaceName && !elements.modalWorkspaceName.value.trim()) {
        elements.modalWorkspaceName.value = deriveFolderName(folderPath);
      }
      elements.modalWorkspaceName?.focus();
      elements.modalWorkspaceName?.select();
    };

    const renderRecent = () => {
      const listEl = elements.modalRecentList;
      const wrapper = elements.modalRecent;
      if (!listEl || !wrapper) return;
      const items = loadRecent();
      if (items.length === 0) {
        wrapper.hidden = true;
        listEl.replaceChildren();
        return;
      }
      wrapper.hidden = false;
      const fragment = document.createDocumentFragment();
      for (const folder of items) {
        const li = document.createElement("li");
        li.className = "workspace-modal-recent-item";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ghost";
        btn.title = folder;
        btn.textContent = folder;
        btn.addEventListener("click", () => {
          applyFolderToInputs(folder);
        });
        li.append(btn);
        fragment.append(li);
      }
      listEl.replaceChildren(fragment);
    };

    const open = () => {
      renderRecent();
      elements.workspaceModalOverlay?.classList.remove("hidden");
      setTimeout(() => {
        elements.modalProjectPath?.focus();
        elements.modalProjectPath?.select();
      }, 10);
    };

    const close = () => {
      elements.workspaceModalOverlay?.classList.add("hidden");
    };

    const browse = async () => {
      if (!api?.browseFolder) return;
      const folderPath = await api.browseFolder();
      if (!folderPath) return;
      applyFolderToInputs(folderPath);
    };

    const submit = async () => {
      try {
        const projectPath = String(elements.modalProjectPath?.value || "").trim();
        const name = String(elements.modalWorkspaceName?.value || "").trim();

        if (!projectPath) {
          setStatus("Project path is required.", true);
          return;
        }

        const created = await api.createWorkspace({
          projectPath,
          name: name || undefined,
        });

        saveRecent(projectPath);

        await api.openWorkspace(created.id);
        await api.focusWorkspace(created.id);

        if (elements.modalProjectPath) elements.modalProjectPath.value = "";
        if (elements.modalWorkspaceName) elements.modalWorkspaceName.value = "";
        close();

        await onWorkspaceCreated(created);
      } catch (error) {
        const msg = error?.message || "Failed to create workspace";
        setStatus(`Failed: ${msg}`, true);
      }
    };

    const bindDropzone = () => {
      const dropzone = elements.modalDropzone;
      const overlay = elements.workspaceModalOverlay;
      if (!dropzone || !overlay) return;

      const setActive = (active) => {
        dropzone.classList.toggle("active", Boolean(active));
      };

      // Accept drops anywhere on the modal overlay; visually highlight dropzone.
      ["dragenter", "dragover"].forEach((type) => {
        overlay.addEventListener(type, (event) => {
          if (overlay.classList.contains("hidden")) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
          setActive(true);
        });
      });
      ["dragleave", "drop"].forEach((type) => {
        overlay.addEventListener(type, (event) => {
          if (overlay.classList.contains("hidden")) return;
          if (type === "dragleave" && event.target !== overlay && event.target !== dropzone) return;
          setActive(false);
        });
      });

      overlay.addEventListener("drop", (event) => {
        if (overlay.classList.contains("hidden")) return;
        event.preventDefault();
        event.stopPropagation();
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;
        // Electron extends File with `path` for DataTransfer drops.
        const folderPath = file.path || "";
        if (folderPath) applyFolderToInputs(folderPath);
      });
    };

    const bind = () => {
      elements.workspaceAdd?.addEventListener("click", () => {
        open();
      });
      elements.workspaceModalClose?.addEventListener("click", () => {
        close();
      });
      elements.workspaceModalCancel?.addEventListener("click", () => {
        close();
      });
      elements.workspaceModalOverlay?.addEventListener("click", (event) => {
        if (event.target === elements.workspaceModalOverlay) {
          close();
        }
      });
      elements.modalBrowsePath?.addEventListener("click", () => {
        void browse();
      });
      elements.workspaceModalCreate?.addEventListener("click", () => {
        void submit();
      });

      [elements.modalProjectPath, elements.modalWorkspaceName].forEach((input) => {
        input?.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        });
      });

      bindDropzone();
    };

    return {
      open,
      close,
      bind,
      submit,
    };
  };
})();
