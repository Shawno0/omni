# OmniContext

Multi-session, agentic workspace supervisor built with Electron and code-server.

## Project Structure
- `apps/desktop`: Electron supervisor desktop app
- `packages/shared`: Shared contracts/types for orchestration surfaces
- `packages/omni-bridge`: VS Code extension scaffold for BYOK AI bridge
- `.plans`: Product/implementation planning artifacts
- `docs`: Architecture notes

## Current Implementation Status
- Phase 0 scaffold complete: monorepo, TypeScript baseline, package layout
- Phase 1 core running: workspace lifecycle manager, shell UI, workspace open/stop flow
- Phase 2 foundation in place: partition assignment and host rewrite interceptor
- Phase 3/4 baseline in place: activity tier monitor + encrypted key vault

## Quick Start
1. Install dependencies from repo root.
2. Build all packages.
3. Launch desktop app workspace.

```bash
npm install
npm run build
npm run dev
```

## Environment Variables
- `OMNI_CODE_SERVER_BIN` (optional): path to `code-server` executable.

## Companion Plans
- `.plans/implementation-plan.md`
- `.plans/ui-ux-guidelines.md`
