(() => {
  const root = (window.OmniRendererModules = window.OmniRendererModules || {});

  /**
   * Provider metadata mirrored from @omni/shared's AI_PROVIDER_META. Kept
   * inline here (instead of resolved through the preload bridge) because
   * the renderer runs as sandboxed browser JS and doesn't require Node
   * modules. If providers change, update both this list and
   * packages/shared/src/contracts.ts together.
   */
  const PROVIDERS = [
    { id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY", hint: "Claude Code, Anthropic SDK" },
    { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY", hint: "OpenAI Codex, Aider, OpenAI SDK" },
    { id: "google", label: "Google Gemini", envVar: "GEMINI_API_KEY", hint: "Gemini CLI, Google AI SDK" },
    { id: "mistral", label: "Mistral", envVar: "MISTRAL_API_KEY", hint: "Mistral CLI, le-chat-cli" },
    { id: "groq", label: "Groq", envVar: "GROQ_API_KEY", hint: "Groq SDK, fast inference" },
    { id: "deepseek", label: "DeepSeek", envVar: "DEEPSEEK_API_KEY", hint: "DeepSeek CLI / SDK" },
    { id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY", hint: "Aggregator — routes to many models" },
    { id: "xai", label: "xAI (Grok)", envVar: "XAI_API_KEY", hint: "xAI SDK, Grok API" },
  ];

  root.createSettingsModalController = function createSettingsModalController(options = {}) {
    const {
      elements,
      api,
      onShortcutsSaved = () => {},
    } = options;

    const getShortcuts = () => ({
      paletteKey: localStorage.getItem("omni-palette-key") || "k",
      restartKey: localStorage.getItem("omni-restart-key") || "r",
    });

    let keyRecords = [];

    const findRecord = (providerId) => keyRecords.find((r) => r.provider === providerId);

    const setProviderRowState = (row, state, message) => {
      const status = row.querySelector("[data-provider-status]");
      if (!status) return;
      status.textContent = message || "";
      status.dataset.state = state || "";
    };

    const renderProviderList = () => {
      const list = elements.settingsProviderList;
      if (!list) return;
      list.replaceChildren();

      for (const meta of PROVIDERS) {
        const record = findRecord(meta.id);
        const li = document.createElement("li");
        li.className = "settings-provider-row";
        li.dataset.provider = meta.id;

        const header = document.createElement("div");
        header.className = "settings-provider-head";

        const labelWrap = document.createElement("div");
        labelWrap.className = "settings-provider-label";
        const nameEl = document.createElement("strong");
        nameEl.textContent = meta.label;
        const envEl = document.createElement("code");
        envEl.className = "settings-provider-env";
        envEl.textContent = meta.envVar;
        const hintEl = document.createElement("span");
        hintEl.className = "settings-provider-hint";
        hintEl.textContent = meta.hint;
        labelWrap.append(nameEl, envEl, hintEl);

        const stateEl = document.createElement("span");
        stateEl.className = "settings-provider-state";
        if (record) {
          stateEl.textContent = `Saved ${record.maskedValue}`;
          stateEl.classList.add("saved");
        } else {
          stateEl.textContent = "Not set";
        }

        header.append(labelWrap, stateEl);

        const controls = document.createElement("div");
        controls.className = "settings-provider-controls";

        const input = document.createElement("input");
        input.type = "password";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.placeholder = record ? "Enter to replace" : `Paste ${meta.label} API key`;
        input.dataset.providerInput = meta.id;

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "btn-primary";
        saveBtn.textContent = "Save";

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "ghost";
        deleteBtn.textContent = "Remove";
        deleteBtn.disabled = !record;

        const status = document.createElement("span");
        status.className = "settings-provider-status";
        status.dataset.providerStatus = "";

        saveBtn.addEventListener("click", async () => {
          const value = (input.value || "").trim();
          if (!value) {
            setProviderRowState(li, "error", "Key is empty");
            return;
          }
          setProviderRowState(li, "pending", "Saving…");
          try {
            keyRecords = (await api.setKey(meta.id, value)) || [];
            input.value = "";
            renderProviderList();
          } catch (err) {
            setProviderRowState(li, "error", err?.message || "Save failed");
          }
        });

        deleteBtn.addEventListener("click", async () => {
          if (!record) return;
          setProviderRowState(li, "pending", "Removing…");
          try {
            keyRecords = (await api.deleteKey(meta.id)) || [];
            renderProviderList();
          } catch (err) {
            setProviderRowState(li, "error", err?.message || "Delete failed");
          }
        });

        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") saveBtn.click();
        });

        controls.append(input, saveBtn, deleteBtn, status);
        li.append(header, controls);
        list.append(li);
      }
    };

    const loadKeys = async () => {
      if (!api?.listKeys) {
        keyRecords = [];
        renderProviderList();
        return;
      }
      try {
        keyRecords = (await api.listKeys()) || [];
      } catch (err) {
        keyRecords = [];
        console.warn("[omni/settings] listKeys failed", err);
      }
      renderProviderList();
    };

    const activateTab = (tabId) => {
      const tabs = elements.settingsModal?.querySelectorAll(".settings-tab") || [];
      const panels = elements.settingsModal?.querySelectorAll("[data-settings-panel]") || [];
      tabs.forEach((btn) => {
        const active = btn.dataset.settingsTab === tabId;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach((panel) => {
        const active = panel.dataset.settingsPanel === tabId;
        panel.classList.toggle("active", active);
        panel.hidden = !active;
      });
    };

    const open = async () => {
      if (!elements.settingsModal) return;
      const shortcuts = getShortcuts();
      if (elements.paletteKey) elements.paletteKey.value = shortcuts.paletteKey;
      if (elements.restartKey) elements.restartKey.value = shortcuts.restartKey;
      if (elements.settingsStatus) elements.settingsStatus.textContent = "Ctrl/Cmd + key shortcuts.";
      elements.settingsModal.classList.remove("hidden");
      activateTab("providers");
      await loadKeys();
    };

    const close = () => {
      elements.settingsModal?.classList.add("hidden");
    };

    const bindShortcuts = () => {
      elements.saveSettings?.addEventListener("click", () => {
        const pk = (elements.paletteKey?.value || "k").trim().toLowerCase() || "k";
        const rk = (elements.restartKey?.value || "r").trim().toLowerCase() || "r";
        localStorage.setItem("omni-palette-key", pk);
        localStorage.setItem("omni-restart-key", rk);
        if (elements.settingsStatus) elements.settingsStatus.textContent = "Settings saved.";
        onShortcutsSaved({ paletteKey: pk, restartKey: rk });
      });
      elements.resetSettings?.addEventListener("click", () => {
        localStorage.setItem("omni-palette-key", "k");
        localStorage.setItem("omni-restart-key", "r");
        if (elements.paletteKey) elements.paletteKey.value = "k";
        if (elements.restartKey) elements.restartKey.value = "r";
        if (elements.settingsStatus) elements.settingsStatus.textContent = "Reset to defaults.";
        onShortcutsSaved({ paletteKey: "k", restartKey: "r" });
      });
    };

    const bind = () => {
      elements.settingsOpen?.addEventListener("click", () => {
        void open();
      });
      elements.settingsModalClose?.addEventListener("click", close);
      elements.settingsModal?.addEventListener("click", (event) => {
        if (event.target === elements.settingsModal) close();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !elements.settingsModal?.classList.contains("hidden")) {
          close();
        }
      });
      elements.settingsModal?.querySelectorAll(".settings-tab").forEach((btn) => {
        btn.addEventListener("click", () => activateTab(btn.dataset.settingsTab));
      });
      bindShortcuts();
    };

    return { bind, open, close };
  };
})();
