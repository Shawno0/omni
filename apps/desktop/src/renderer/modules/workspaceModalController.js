(() => {
  const root = (window.OmniRendererModules = window.OmniRendererModules || {});

  root.createWorkspaceModalController = function createWorkspaceModalController(options = {}) {
    const {
      elements,
      api,
      setStatus = () => {},
      onWorkspaceCreated = async () => {},
    } = options;

    const open = () => {
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
      if (elements.modalProjectPath) elements.modalProjectPath.value = folderPath;
      if (elements.modalWorkspaceName && !elements.modalWorkspaceName.value.trim()) {
        const parts = folderPath.replace(/[\\/]+$/, "").split(/[\\/]/);
        const folderName = parts[parts.length - 1] || "";
        elements.modalWorkspaceName.value = folderName;
      }
      elements.modalWorkspaceName?.focus();
      elements.modalWorkspaceName?.select();
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
    };

    return {
      open,
      close,
      bind,
      submit,
    };
  };
})();
