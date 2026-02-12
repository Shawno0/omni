# OmniContext Release Checklist (Windows)

## Build and Packaging
- [ ] Run `npm install` from repository root.
- [ ] Run `npm run build` and confirm no TypeScript errors.
- [ ] Run `npm run package:win -w @omni/desktop`.
- [ ] Verify installer artifact exists under `apps/desktop/out`.

## Protocol Registration
- [ ] Register protocol manually for dev check: `npm run protocol:register -w @omni/desktop`.
- [ ] Validate registration: `npm run protocol:validate -w @omni/desktop`.
- [ ] Confirm `omnicontext://health` launches OmniContext.

## Runtime Smoke Tests
- [ ] Launch packaged app and create at least 2 workspaces.
- [ ] Confirm `.ide` and `.local` routes resolve per workspace.
- [ ] Confirm no cookie/session bleed between workspaces.
- [ ] Confirm activity tier transitions (`focused` / `background-active` / `idle`).
- [ ] Confirm key vault save/list/delete for OpenAI and Anthropic keys.
- [ ] Confirm quick actions, keyboard shortcuts, favorites, and sort mode persist.

## Recovery and Resilience
- [ ] Restart app and confirm persisted workspace restore behavior.
- [ ] Validate restore diagnostics panel entries (`restored` / `failed`).
- [ ] Stop/restart/dispose workspaces without orphan child processes.

## Security and Logging
- [ ] Confirm API keys are encrypted at rest (`safeStorage`) and never shown in plaintext.
- [ ] Confirm logs and diagnostics do not include raw secrets.

## Release Readiness
- [ ] Update changelog/release notes with key features and known limitations.
- [ ] Document rollback approach and known caveats in deployment note.
