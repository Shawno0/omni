# OmniContext UI/UX Guidelines

## Metadata
- **Project:** OmniContext
- **Date:** 2026-02-12
- **Purpose:** Define a production-ready, implementation-oriented UI/UX standard for the desktop app
- **Design Direction:** Clean, minimalist, productivity-first; visually refined with subtle depth; inspired by modern AI coding tools (Codex-like) but richer in workspace orchestration affordances

## Implementation Checkpoint (2026-02-12)
### Implemented
- [x] Light/dark/system theming with persisted selection
- [x] Advanced sidebar with create/filter/sort controls
- [x] Workspace diagnostics, protocol diagnostics, activity timeline, restore status panels
- [x] Quick action palette with fuzzy search, grouped actions, keyboard navigation
- [x] Keyboard productivity shortcuts (palette toggle, workspace cycling, index jump, restart)
- [x] In-app settings panel for shortcut configuration with validation
- [x] Collapsible diagnostics/settings cards with persisted expand/collapse state
- [x] Favorites/pinning and favorites-first sorting

### In Progress / Partial
- [ ] Full accessibility pass (screen reader announcements, ARIA live regions, keyboard audit)
- [ ] Reduced-motion mode behavior audit
- [ ] Copy-to-clipboard affordances for technical diagnostics values
- [ ] Explicit inline loading/skeleton states for async-heavy panels

### Next UI/UX Footing
1. Complete accessibility conformance and keyboard/screen-reader audit.
2. Add deterministic loading/error affordances in diagnostics and workspace actions.
3. Add copy actions for host/port/session technical fields.
4. Prepare visual regression baseline for core shell screens.

---

## 1) Product UX Vision
OmniContext should feel like a calm control center for parallel development sessions. The UI must reduce cognitive load while making high-value context immediately visible: session status, agent activity, terminal output intensity, routing health, and key actions.

### Experience Goals
1. **Instant orientation:** User understands active workspace and system health in under 3 seconds.
2. **Low-friction switching:** Session switching feels immediate and predictable.
3. **Progressive detail:** Defaults are simple; diagnostics are available on demand.
4. **Trustworthy automation:** Agent and orchestration actions are visible, inspectable, and reversible.
5. **Aesthetic restraint:** Elegant surfaces, soft rounding, subtle layering, no aggressive colors.

---

## 2) Design Principles (Applied from frontend skill guidance)
These principles translate the referenced frontend design skill into OmniContext-specific rules.

1. **Intentional visual direction**
   - Commit to a refined minimalist style and execute consistently.
   - Every element must justify its presence in terms of user productivity.

2. **Distinctiveness through craft, not noise**
   - Differentiate via spacing precision, hierarchy, motion timing, and layout clarity.
   - Avoid gimmicks, visual clutter, and trend-heavy effects.

3. **High signal density, low cognitive overhead**
   - Show concise status signals (activity, routing, errors, locks) with progressive disclosure.
   - Keep defaults clean; expand only when user asks.

4. **Cohesive token-driven system**
   - All color, radius, spacing, typography, and motion values must come from design tokens.
   - No hard-coded one-off styling in product surfaces.

5. **Accessibility as baseline quality**
   - Keyboard-first operation, predictable focus, readable contrast, and reduced-motion support.

---

## 3) Visual Language

## 3.1 Aesthetic Direction
- **Style:** Quiet, technical, modern, rounded, neutral-first.
- **Mood:** Focused and confident, not playful.
- **Geometry:** 10–14px corner radii on containers, 8–10px on controls.
- **Depth:** Very subtle elevation layers, soft borders, low-contrast separators.

## 3.2 Color Strategy
Use neutral palettes with restrained accent usage.

### Theme Modes
- **Light**
- **Dark**
- **System** (follows OS, auto-switch)

### Color Rules
- Neutral surfaces dominate (background, panels, cards).
- One primary accent color for active/focus states.
- Semantic colors only for explicit states:
  - Success
  - Warning
  - Error
  - Info
- Avoid saturated gradients and high-chroma backgrounds.
- Keep chroma intentionally low to preserve long-session comfort.

### Token Categories (Required)
- `color.bg.base`, `color.bg.panel`, `color.bg.elevated`
- `color.border.default`, `color.border.strong`
- `color.text.primary`, `color.text.secondary`, `color.text.muted`
- `color.accent.primary`, `color.accent.soft`
- `color.state.success|warning|error|info`
- `color.focus.ring`

## 3.3 Typography
- Prioritize readability for long coding sessions.
- Use one sans family for UI and one mono family for technical data.
- Typography scale should be tight and predictable.

### Recommended Roles
- **UI Sans:** labels, navigation, controls
- **Mono:** IDs, hosts, ports, logs, diagnostics

### Text Hierarchy
- H1/H2 for page-level and panel-level anchors only.
- Body and caption for most UI.
- Avoid overusing font weight changes as hierarchy; use spacing/grouping first.

## 3.4 Spacing and Rhythm
- Base spacing unit: 4px.
- Primary layout increments: 8, 12, 16, 24.
- Minimum interactive target: 32px height (desktop).
- Prefer larger vertical breathing room over decorative lines.

## 3.5 Motion
Motion should communicate system state and spatial continuity, not decoration.

### Rules
- Default transitions: 120–180ms.
- Emphasized transitions: 220–260ms.
- Use ease-out for enter, ease-in for exit.
- Disable non-essential motion in reduced-motion mode.

### Approved Motion Moments
- Session tab activation
- Sidebar panel expand/collapse
- Diagnostics drawer reveal
- Small state pulses for active heartbeat indicators

---

## 4) Information Architecture

## 4.1 Primary Regions
1. **Global Sidebar (persistent)**
   - Workspace tabs/list
   - Quick create/open/close controls
   - Status badges and filters
2. **Main Surface (contextual)**
   - IDE view and App view composition
   - Active workspace content
3. **Diagnostics Panel (toggleable)**
   - Activity heartbeat
   - Routing health
   - Agent lock state
   - Last errors and retries

## 4.2 Navigation Model
- Workspace is the primary navigation unit.
- Keep hierarchy shallow:
  - Workspace
  - View mode (IDE/App/Split)
  - Optional diagnostics detail
- Preserve per-workspace view state when switching tabs.

## 4.3 Progressive Disclosure
- Show minimal status by default.
- Expand to details via:
  - Hover tooltips
  - Inline expanders
  - Diagnostics panel

---

## 5) Core UX Flows

## 5.1 Create Workspace
1. User clicks **New Workspace**.
2. Selects project folder.
3. Name defaults to sanitized folder name; user can edit.
4. System validates uniqueness and shows resulting `*.ide`/`*.local` hosts.
5. Workspace starts with visible boot states: initializing → ready.

### UX Requirements
- Inline validation messages (non-blocking until submit).
- Show explicit startup progress and timeout errors.
- Offer retry from error state without losing form input.

## 5.2 Switch Workspace
- Single click/tab change should restore last known view mode instantly.
- Keep inactive workspaces visible with compact status chips.
- Show background activity subtly (not animated aggressively).

## 5.3 Observe Activity and Health
- Status chip includes:
  - Resource tier (Focused / Background Active / Idle)
  - Agent lock indicator
  - Last heartbeat timestamp (on hover or expanded view)
- Routing issues appear in diagnostics with severity and next action.

## 5.4 Key Management (BYOK)
- Clear provider labels and scoped storage messaging.
- Inline save success + encrypted-at-rest confirmation.
- Never render full key after save; mask and allow replace/revoke only.

---

## 6) Component Guidelines

## 6.1 Workspace Tabs
- Rounded pill-like tabs with clear active state.
- Active tab contrast should rely on background and border, not only color.
- Include compact metadata:
  - Name
  - Status dot
  - Optional unread/alert marker

## 6.2 Sidebar List Rows
- Row contains:
  - Session name
  - Route badges (`.ide`, `.local`)
  - Health badge
  - Quick actions (start/stop/restart)
- Actions appear on hover/focus to reduce clutter.

## 6.3 Status Badges
- Use semantic color sparingly.
- Pair color with icon/text (never color alone).
- Keep badge text short and stable.

## 6.4 Diagnostics Panel
- Sectioned cards:
  - Process health
  - Routing table health
  - Agent activity
  - Recent events/errors
- Include copyable technical values (host, port, session ID).

## 6.5 Forms and Inputs
- Labels always visible (no label-only placeholders).
- Validation appears near field, with plain language.
- Destructive actions require clear confirmation wording.

---

## 7) Layout and Responsiveness
Even though desktop-first, support resilient resizing.

### Breakpoint Behavior (Desktop Window Width)
- **Wide:** sidebar + dual-view/split options + diagnostics side panel
- **Medium:** sidebar + single primary view, diagnostics as drawer
- **Narrow desktop:** collapsible sidebar, diagnostics modal/drawer

### Layout Rules
- Never hide critical workspace state.
- Prioritize current workspace controls over secondary metadata.
- Preserve keyboard accessibility in all collapsed modes.

---

## 8) Accessibility and Inclusive UX

## 8.1 Keyboard
- Full keyboard coverage for:
  - Workspace switch
  - Start/stop/restart
  - View mode toggle
  - Diagnostics open/close
- Visible, high-contrast focus ring using tokenized focus color.

## 8.2 Screen Reader
- Semantic roles for tabs, lists, dialogs, and status regions.
- Announce workspace state transitions and errors.
- Use `aria-live` for async status updates (startup, failure, recovery).

## 8.3 Contrast and Motion
- Meet WCAG AA contrast for text and controls.
- Provide reduced-motion option aligned to OS setting.
- Avoid relying on motion or color alone for meaning.

---

## 9) Interaction and Feedback Standards

## 9.1 Latency and Loading
- Always show deterministic loading states:
  - Skeletons for panel content
  - Inline spinner for row/action-level operations
- Display expected timeouts for long-running actions where possible.

## 9.2 Error Handling
- Error messages must include:
  - What failed
  - Impact scope (which workspace)
  - Immediate next actions
- Keep errors actionable and non-technical by default, with expandable technical details.

## 9.3 Confirmation Patterns
- Use toasts for low-risk confirmations.
- Use modal confirmations only for destructive/irreversible actions.
- Avoid interruptive alerts for recoverable transient failures.

---

## 10) Content and Microcopy Guidelines
- Use concise, operational language.
- Prefer verbs in action labels: Start, Stop, Restart, Open, Reveal, Retry.
- Avoid ambiguous terms like “syncing” without context.
- Keep status text consistent across sidebar, tabs, and diagnostics.

### Voice
- Professional, calm, technical.
- No playful or anthropomorphic system messaging.

---

## 11) Theming Implementation Rules

## 11.1 Theme Architecture
- Implement all themes via CSS variables (or token objects).
- Token source of truth must support light/dark/system switching.
- Theme switch should not trigger full-app repaint flicker.

## 11.2 Theme Persistence
- Store explicit user choice (`light`, `dark`, `system`) in app settings.
- If `system`, subscribe to OS theme change and update live.

## 11.3 Forbidden Theme Practices
- No hard-coded ad hoc hex values in components.
- No per-component custom shadows outside token set.
- No high-saturation visual effects in primary workflows.

---

## 12) Productivity-Focused UX Requirements
- Session switch should require at most one click or one shortcut.
- Critical controls must remain within predictable locations.
- Diagnostics should support copy-to-clipboard for technical fields.
- Preserve user context:
  - Last active workspace
  - Last selected view mode
  - Last sidebar expansion state
- Avoid modal-heavy workflows during normal development tasks.

---

## 13) Design QA Checklist (Definition of UI Done)
A feature is not UI-complete unless all checks pass:

1. **Visual Consistency**
   - Uses approved tokens for color, spacing, radius, motion.
2. **Hierarchy Clarity**
   - Primary action and status are obvious within 2 seconds.
3. **Accessibility**
   - Keyboard operable, focus visible, contrast compliant.
4. **State Completeness**
   - Handles empty/loading/success/error/offline/transitional states.
5. **Theme Fidelity**
   - Works in light, dark, and system modes with parity.
6. **Performance**
   - No jank in common transitions or tab switches.
7. **Copy Quality**
   - Labels and errors are concise and actionable.

---

## 14) Implementation Hand-off Notes
- Build a token file before building visual components.
- Implement sidebar, workspace tabs, and diagnostics shell first.
- Validate UX flows using realistic multi-workspace data early.
- Add a lightweight visual regression set once base screens stabilize.

---

## 15) Alignment with Implementation Plan
This guideline is a required companion to the execution roadmap and should be treated as the UI/UX quality baseline for all phases, especially:
- Phase 1 (shell, tabs, controls)
- Phase 2 (routing diagnostics presentation)
- Phase 3 (heartbeat state clarity)
- Phase 4 (BYOK key-management UX)
- Phase 5 (packaged app polish and consistency)
