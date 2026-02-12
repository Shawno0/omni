# OmniContext Architecture (Current Scaffold)

## Desktop Supervisor
- Electron main process in `apps/desktop/src/main`
- Workspace lifecycle managed by `WorkspaceManager`
- Partition-aware request interception via `ProtocolInterceptor`
- Activity heartbeats and tier assignment via `ActivityMonitor`
- BYOK storage using Electron `safeStorage` via `KeyVault`

## UI Shell
- Renderer shell in `apps/desktop/src/renderer`
- Sidebar supports workspace creation, filtering, launch, and stop
- Diagnostics panel surfaces selected workspace state
- Key management panel supports OpenAI/Anthropic key CRUD

## Bridge Extension
- VS Code extension scaffold in `packages/omni-bridge`
- Placeholder chat and tool-call commands
- Telemetry emitted to extension output channel

## Next Milestones
1. Full `vscode.lm` provider registration and streaming response pipeline
2. PTY bridge integration for terminal heartbeat signal
3. Workspace app-view split controls and richer diagnostics table
4. Release packaging workflow and protocol installer validation
