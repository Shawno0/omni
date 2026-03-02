(() => {
  const root = window;
  root.OmniRendererModules = root.OmniRendererModules || {};

  root.OmniRendererModules.createDiagnosticsController = ({
    elements,
    getProtocolEvents,
    getActivityEvents,
    getRestoreEvents,
    getSelectedWorkspace,
    getSelectedWorkspaceId,
    setStatus,
  }) => {
    const renderProtocolDiagnostics = () => {
      if (!elements.protocolDiagnostics) return;

      const protocolEvents = getProtocolEvents();
      if (protocolEvents.length === 0) {
        elements.protocolDiagnostics.textContent = "No protocol events captured.";
        return;
      }

      const workspaceFilter = elements.protocolWorkspaceFilter?.value || "all";
      const severityFilter = elements.protocolSeverityFilter?.value || "all";
      const filtered = protocolEvents.filter((event) => {
        const workspaceOk = workspaceFilter === "all" || event.workspaceId === workspaceFilter;
        const severityOk = severityFilter === "all" || event.severity === severityFilter;
        return workspaceOk && severityOk;
      });

      if (filtered.length === 0) {
        elements.protocolDiagnostics.textContent = "No events for selected filters.";
        return;
      }

      elements.protocolDiagnostics.textContent = filtered
        .slice(0, 25)
        .map((event) => {
          const timestamp = new Date(event.at).toLocaleTimeString();
          return `${timestamp}  ${event.severity}  ${event.method} ${event.path}  ${event.status}`;
        })
        .join("\n");
    };

    const renderActivityDiagnostics = () => {
      if (!elements.activityDiagnostics) return;

      const selected = getSelectedWorkspace();
      if (!getSelectedWorkspaceId() && !selected) {
        elements.activityDiagnostics.textContent = "Select a workspace to view activity.";
        return;
      }

      const activityEvents = getActivityEvents();
      if (activityEvents.length === 0) {
        elements.activityDiagnostics.textContent = "No activity samples captured.";
        return;
      }

      elements.activityDiagnostics.textContent = activityEvents
        .slice(0, 30)
        .map((event) => {
          const timestamp = new Date(event.sampledAt).toLocaleTimeString();
          const cpu = Number(event.cpuPercent || 0).toFixed(1);
          return `${timestamp}  tier=${event.tier}  cpu=${cpu}%  terminal=${event.terminalActive ? "on" : "off"}  progress=${event.terminalProgress || "idle"}`;
        })
        .join("\n");
    };

    const renderRestoreDiagnostics = () => {
      if (!elements.restoreDiagnostics) return;

      const restoreEvents = getRestoreEvents();
      if (restoreEvents.length === 0) {
        elements.restoreDiagnostics.textContent = "No restore diagnostics available.";
        return;
      }

      elements.restoreDiagnostics.textContent = restoreEvents
        .slice(0, 20)
        .map((event) => {
          const timestamp = new Date(event.at).toLocaleTimeString();
          return `${timestamp}  ${event.status}  ${event.workspaceName}  ${event.message}`;
        })
        .join("\n");
    };

    const renderSelectedWorkspaceDiagnostics = () => {
      const selected = getSelectedWorkspace();

      if (elements.diagnostics) {
        elements.diagnostics.textContent = selected
          ? JSON.stringify(selected, null, 2)
          : "No workspace selected.";
      }

      if (!selected) {
        if (getSelectedWorkspaceId() === undefined) {
          renderActivityDiagnostics();
          setStatus("Select or create a workspace to begin.");
        }
        return;
      }

      setStatus(`${selected.name} • ${selected.status} • ${selected.resourceTier}`);
    };

    return {
      renderProtocolDiagnostics,
      renderActivityDiagnostics,
      renderRestoreDiagnostics,
      renderSelectedWorkspaceDiagnostics,
    };
  };
})();
