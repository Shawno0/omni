# OmniContext Implementation Plan

## Metadata
- **Project:** OmniContext
- **Date:** 2026-02-12
- **Platform Target (MVP):** Windows (native `code-server` child processes)
- **Delivery Strategy:** Dev-first, then packaged desktop app
- **Status:** In Progress (Phases 0-4 partially complete)

## Execution Checkpoint (2026-02-12)
### Phase Status
- **Phase 0 (Foundation & Tooling):** 🟡 Mostly complete
- **Phase 1 (Core Supervisor):** ✅ Complete for MVP baseline
- **Phase 2 (Isolation & Networking):** ✅ Complete for MVP baseline
- **Phase 3 (Activity & Resource Tiers):** ✅ Complete for MVP baseline
- **Phase 4 (BYOK & Omni-Bridge):** 🟡 Partial
- **Phase 5 (Packaging):** ✅ Complete (local validation complete)

### Task Completion Tracker
#### Phase 0 — Foundation & Tooling
- [x] Initialize workspace package manager and root scripts.
- [x] Configure TypeScript project references.
- [ ] Add linting/formatting/test scaffolds.
- [x] Create shared contract definitions.

#### Phase 1 — Electron Core Supervisor
- [x] Implement app bootstrap (`main.ts`) with single-instance lock and graceful shutdown.
- [x] Implement `WorkspaceManager` lifecycle APIs (`create/start/stop/dispose`).
- [x] Launch `code-server` with per-session token/env and readiness probing.
- [x] Implement `WebContentsView` IDE/app composition.
- [x] Build advanced renderer shell baseline with diagnostics + controls.

#### Phase 2 — Isolation & Hybrid Networking
- [x] Implement partition factory (`persist:session_[session_id]`).
- [x] Implement protocol interceptor for `*.ide` and `*.local`.
- [x] Implement host/origin/referer rewrite policy baseline.
- [x] Implement routing diagnostics surfaced in UI.

#### Phase 3 — Activity Heartbeat & Resource Tiers
- [x] Implement `ActivityMonitor` polling loop with `pidusage`.
- [x] Build **process-tree** aggregation.
- [x] Integrate PTY stream activity ingestion from terminal bridge.
- [x] Add agent lock flag API.
- [x] Implement tier state computation (`focused`, `background-active`, `idle`).
- [x] Surface real-time state/timeline in diagnostics.

#### Phase 4 — BYOK Security & Omni-Bridge
- [x] Implement `KeyVault` with `safeStorage` encryption + CRUD IPC.
- [x] Inject provider env keys into workspace process launches.
- [x] Register `LanguageModelChatProvider` in Omni-Bridge.
- [x] Implement provider abstraction for OpenAI/Anthropic calls.
- [x] Add tool invocation bridge path and telemetry emission.
- [x] Add key-management UI in shell.

#### Phase 5 — Packaging & Release Readiness
- [x] Configure `electron-builder` baseline.
- [x] Add protocol registration + validation scripts.
- [x] Validate packaged app behavior on local machine profile.
- [ ] Validate packaged app behavior on clean machine profile.
- [x] Add release checklist baseline.
- [x] Add rollback notes.

### Current Footing (Next Work Slice)
1. **Harden Phase 4 bridge:** improve tool result chaining across turns and richer failure telemetry.
2. **Complete external Phase 5 verification:** run clean-machine smoke + deep-link launch check.
3. **Quality pass:** add lint/format/test scaffolding to complete Phase 0 criteria.

### Validation Artifacts
- `docs/release-checklist.md`
- `docs/phase5-validation-report.md`
- `docs/rollback-notes.md`

## Companion Documents
- **UI/UX Guideline:** [ui-ux-guidelines.md](ui-ux-guidelines.md)

## 1) Objectives and Scope
### Objectives
- Deliver a multi-session, agentic orchestration desktop app with isolated workspaces.
- Provide each workspace with:
  - Isolated IDE session (`code-server`)
  - Dedicated browser/app view (`*.local`)
  - Integrated terminal activity tracking for heartbeat
- Support BYOK AI integration via preinstalled Omni-Bridge extension.

### In-Scope (MVP + Packaging Follow-on)
- Electron supervisor with advanced workspace sidebar UX.
- Workspace lifecycle management (spawn, monitor, stop, cleanup).
- Session isolation via persistent partitions.
- Domain/protocol routing for `*.ide` and `*.local`.
- Heartbeat-based resource tiering.
- API key encryption and storage via Electron `safeStorage`.
- Omni-Bridge extension with chat provider, tool calls, telemetry streaming.
- Windows packaging and protocol registration.

### Out of Scope (for this plan version)
- Linux/macOS production support.
- Remote multi-user hosting model.
- Enterprise vault integrations beyond `safeStorage`.

---

## 2) Approved Architecture Decisions
- **Runtime:** Native Windows `code-server` process per workspace.
- **Session naming:** User-named tabs, defaulting to sanitized project folder name.
- **Domain mapping:** Hostnames derived from session slug (e.g., `project-a.ide`, `project-a.local`).
- **IDE auth:** Per-session random token.
- **UI scope:** Advanced shell UX (tabs, filters/grouping, diagnostics, resource indicators).
- **AI bridge scope:** Chat + tool calls + streaming telemetry.

---

## 3) Proposed Monorepo Layout
```text
/apps
  /desktop
    /src
      /main
      /preload
      /renderer
    /tests
    electron-builder.yml
    package.json
/packages
  /shared
    /src
  /omni-bridge
    /src
    package.json
/docs
.plans
README.md
```

### Core Module Ownership
- `apps/desktop/src/main`: Supervisor, process orchestration, protocol/network, monitoring, key vault.
- `apps/desktop/src/renderer`: Sidebar UI, session tabs, diagnostics panel.
- `packages/shared`: Contracts, event types, schemas, shared utilities.
- `packages/omni-bridge`: VS Code extension (`vscode.lm` provider and tool bridge).

---

## 4) Phase-by-Phase Execution Plan

## Phase 0 — Foundation & Tooling
### Deliverables
- Monorepo bootstrapped with workspace package manager.
- TypeScript + lint + format + test baseline.
- Shared contracts package scaffold.

### Tasks
1. Initialize workspace package manager and root scripts.
2. Configure TypeScript project references.
3. Add linting/formatting/test scaffolds.
4. Create shared contract definitions:
   - Workspace/session identifiers
   - Route and protocol mappings
   - Heartbeat/activity payloads
   - Key management IPC request/response shapes

### Exit Criteria
- `install`, `lint`, `typecheck`, and `test` scripts run successfully in CI/local.

---

## Phase 1 — Electron Core Supervisor (MVP Core)
### Deliverables
- Electron app boots with single-instance lock and advanced sidebar shell.
- WorkspaceManager can spawn and terminate native `code-server` instances.
- IDE view and app view can be created per workspace.

### Tasks
1. Implement app bootstrap (`main.ts`) with:
   - Single-instance lock
   - Structured logging bootstrap
   - Graceful shutdown hooks
2. Implement `WorkspaceManager` with lifecycle APIs:
   - `createWorkspace(projectPath, optionalName)`
   - `startWorkspace(sessionId)`
   - `stopWorkspace(sessionId)`
   - `disposeWorkspace(sessionId)`
3. Launch `code-server` as child process per workspace:
   - Unique session token generation
   - Session-specific env injection
   - Readiness probe and timeout handling
4. Implement `WebContentsView` composition for:
   - IDE surface
   - App surface
5. Build initial renderer shell:
   - Workspace tabs
   - Basic diagnostics panel placeholders
   - Start/stop controls

### Exit Criteria
- User can create a workspace and open IDE/app views reliably.
- Child process lifecycle is stable across start/stop/restart cycles.

---

## Phase 2 — Isolation and Hybrid Networking
### Deliverables
- Per-workspace persistent partition assignment.
- Functional protocol interception for `*.ide` and `*.local`.
- Host header rewrite support for local dev servers.

### Tasks
1. Implement partition factory:
   - Partition key: `persist:session_[session_id]`
   - Session storage root mapping
2. Implement protocol interceptor:
   - Route `*.ide` to workspace IDE target
   - Route `*.local` to workspace local app target (`localhost:[port]`)
3. Implement request/response rewriting policy:
   - Host header rewrites for Next.js/Vite compatibility
   - Preserve origin/security semantics where required
4. Implement routing diagnostics:
   - Active route table
   - Last error/retry metadata in diagnostics panel

### Exit Criteria
- Multiple workspaces can run concurrently without cookie/storage conflicts.
- `*.ide` and `*.local` resolve correctly per workspace.

---

## Phase 3 — Activity Heartbeat and Resource Tiers
### Deliverables
- Activity monitor tracks CPU/process tree, PTY stream, and agent lock.
- Resource tier policies applied based on heartbeat state.

### Tasks
1. Implement `ActivityMonitor` polling loop with `pidusage`.
2. Build process-tree aggregation for each workspace.
3. Integrate PTY stream activity signal ingestion.
4. Add agent lock flag API for long-running AI operations.
5. Implement tier policy application:
   - Focused: 100%
   - Background Active: 70%
   - Idle: 10%
6. Surface real-time state in diagnostics sidebar.

### Exit Criteria
- Workspace tier transitions are accurate under real workloads.
- No false idle transitions while terminal/agent work is active.

---

## Phase 4 — BYOK Security and Omni-Bridge Integration
### Deliverables
- Secure key storage and retrieval via `safeStorage`.
- Supervisor-to-workspace env injection.
- Omni-Bridge extension with chat, tools, telemetry.

### Tasks
1. Implement `KeyVault` service:
   - Encrypt/decrypt API keys with `safeStorage`
   - CRUD IPC endpoints
2. Integrate provider env injection per workspace launch.
3. Implement Omni-Bridge extension boilerplate:
   - Register `LanguageModelChatProvider`
   - Provider abstraction for Anthropic/OpenAI
   - Tool invocation bridge contract
4. Implement streaming telemetry channel to supervisor.
5. Add minimal key-management UI in desktop shell.

### Exit Criteria
- Key material is never stored in plaintext.
- Extension can execute chat and tool-call paths using injected keys.
- Telemetry events are emitted and visible in diagnostics.

---

## Phase 5 — Packaging and Release Readiness
### Deliverables
- Windows installer packaging.
- Protocol registration validated in packaged app.
- Install/uninstall cleanup flows documented.

### Tasks
1. Configure `electron-builder` for Windows artifacts.
2. Add protocol registration and validation scripts.
3. Validate packaged app behavior on clean machine profile:
   - App launch
   - Protocol handling
   - Session persistence
4. Add release checklist and rollback notes.

### Exit Criteria
- Installer build is reproducible.
- Protocol routing works in packaged mode.
- Shutdown/uninstall leaves no orphaned child processes.

---

## 5) Work Breakdown (Module-Level)
- **Supervisor Core:** lifecycle, locks, shutdown, diagnostics bus.
- **Workspace Engine:** process spawn/readiness, token generation, teardown.
- **Networking:** host mapping, protocol handlers, header rewriting.
- **Isolation:** partition assignment and storage root ownership.
- **Monitoring:** heartbeat aggregation and tier policy execution.
- **Security:** key vault, env injection, redaction-safe logging.
- **Extension:** LM provider, tools interface, streaming telemetry.
- **UI/UX:** advanced sidebar, tabs, filter/grouping, status indicators, actions.

---

## 6) Validation Strategy
### Automated
- Unit tests:
  - Name sanitizer/domain mapper
  - Route resolver and header rewrite logic
  - Heartbeat classifier
  - KeyVault encrypt/decrypt and failure handling
- Integration tests:
  - Workspace lifecycle (create/start/stop/dispose)
  - Concurrent workspace isolation
  - Protocol routing for `*.ide` and `*.local`
- Extension tests:
  - Chat provider registration
  - Tool-call contract validation
  - Telemetry event formatting

### Manual
- Multi-session stress run (3+ concurrent workspaces).
- Vite/Next.js compatibility checks for host rewrite.
- Crash/restart resilience for `code-server` child processes.
- Security pass for key entry/retrieval and log redaction.

---

## 7) Risks and Mitigations
- **Risk:** Native Windows `code-server` stability variance.
  - **Mitigation:** Robust readiness probes, restart policy, fallback diagnostics.
- **Risk:** Protocol behavior differences in dev vs packaged builds.
  - **Mitigation:** Dedicated packaged smoke tests in each milestone.
- **Risk:** False idle classifications causing UX regressions.
  - **Mitigation:** Tunable thresholds + PTY/activity debounce windows.
- **Risk:** Localhost/app server incompatibilities.
  - **Mitigation:** Header rewrite strategy with per-framework compatibility checks.

---

## 8) Acceptance Criteria (Program-Level)
- Create, run, and switch between isolated workspaces from advanced sidebar.
- Access IDE via session-bound route and app via matching `.local` route.
- No cross-workspace cookie/session leakage.
- Heartbeat tiers behave as specified and are observable in UI diagnostics.
- BYOK keys are encrypted at rest and usable by Omni-Bridge.
- Omni-Bridge supports chat + tool calls + streaming telemetry in workspace IDE.
- Packaged Windows build preserves expected runtime behavior.

---

## 9) Suggested Execution Order (Sprint-Like)
1. Phase 0 + Phase 1 (foundational MVP shell and lifecycle).
2. Phase 2 (isolation/networking correctness).
3. Phase 3 (heartbeat/resource intelligence).
4. Phase 4 (AI bridge + secure keys).
5. Phase 5 (packaging and release hardening).

---

## 10) Definition of Done
- All phase exit criteria met.
- No critical or high-severity open defects in core lifecycle, isolation, routing, or key handling.
- Documentation updated in `README` and `/docs` with architecture and operator notes.
- Reproducible local setup and packaged validation checklist completed.
