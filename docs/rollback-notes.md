# OmniContext Rollback Notes (Windows)

## Scope
This rollback guidance covers packaged desktop releases created from `apps/desktop`.

## Rollback Triggers
- Installer launch failures on supported Windows versions.
- Protocol deep-link handling regression (`omnicontext://...`).
- Workspace restore/start regressions causing repeated startup failures.
- Severe routing/partition isolation defects.

## Rollback Procedure
1. **Stop active OmniContext instances** from Task Manager.
2. **Uninstall current version** from Windows Apps settings.
3. **Install previous known-good installer** artifact.
4. **Re-register protocol** using:
   - `npm run protocol:register -w @omni/desktop` (dev/local)
   - or rerun previous installer (packaged)
5. **Validate protocol key**:
   - `npm run protocol:validate -w @omni/desktop`
6. **Smoke test**:
   - Launch app
   - Open at least one workspace
   - Verify route handling and diagnostics panels

## Data Considerations
- Session metadata and encrypted keys are kept under `%APPDATA%/../Local` app data paths and are not guaranteed to be backward-compatible across all versions.
- If rollback reveals state incompatibility, clear only OmniContext session cache files (preserve backup first).

## Safe Cleanup Commands (Manual)
- Remove protocol registration (optional):
  - `pwsh -ExecutionPolicy Bypass -File apps/desktop/scripts/registerProtocol.ps1 -Unregister`

## Verification After Rollback
- Protocol registration succeeds and points to expected executable.
- Workspaces can be created/opened.
- No startup crash loops.
- No severe diagnostics errors in shell panels.
