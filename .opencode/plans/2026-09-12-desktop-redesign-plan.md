# Forge Desktop Redesign Plan

Status: draft for review. No component/style edits made yet. This covers
the "look and feel like Claude Code" redesign of `packages/app` (the
Solid.js UI shared by desktop and, previously, TUI — now desktop-only).

## Confirmed baseline

- Repo bootstrapped at `/home/divyanshu-singh/Divyanshu/forge`, installs
  cleanly (`bun install`, 2321 packages), `packages/app` runs standalone
  via `bun run dev` (plain Vite dev server, port 3000) and renders a real
  shell: sidebar (Projects / Add project / Settings / Help), session
  search, empty state. Verified in-browser via the Browser pane.
- Full Electron shell (`packages/desktop`) wasn't launchable in this
  sandbox (no display server) — `packages/app` standalone is the
  practical dev/preview loop for this work; Electron itself needs no
  changes for a visual redesign, it just hosts the same renderer.
- Provider/model connection code is explicitly out of scope — untouched
  per your instruction.

## Design reference

The clearest spec for "Claude Code's look" available to me is the actual
Claude Code desktop app UI visible in this conversation's screenshots —
sidebar with pinned/recent items grouped by project, a message stream
with tool-call cards inline, permission/todo docks anchored above the
composer, minimal chrome, generous whitespace, monospace used only for
code/paths. I'll use that as ground truth rather than approximating from
memory or genericizing.

## Where the leverage is (architecture found)

- **`packages/ui`** — the shared design-system package. `src/styles/colors.css`
  defines a full Radix-style gray/accent scale (light + dark, using
  `light-dark()`), `src/styles/theme.css` defines spacing/radius/shadow/
  typography tokens, consumed via `@import "@opencode-ai/ui/styles/tailwind"`
  in `packages/app/src/index.css`. **This is the single highest-leverage
  file set** — retinting/resizing tokens here cascades through every
  component that uses them, versus hunting down hardcoded colors
  component-by-component.
- **`packages/session-ui`** — a second shared package, session-specific
  components (imported as `@opencode-ai/session-ui/styles` in the same
  `index.css`). Needs the same token-level pass.
- **`packages/app/src/pages/layout/`** — sidebar shell (`sidebar-shell.tsx`,
  `sidebar-project.tsx`, `sidebar-workspace.tsx`, `sidebar-items.tsx`).
  This is the first thing a user sees and the thing everything else nests
  inside — correct sequencing starts here.
- **`packages/app/src/pages/session/`** — the message/chat view, file tabs,
  timeline. Largest surface area.
- **`packages/app/src/pages/session/composer/`** — the docks you
  specifically called out earlier: `session-permission-dock.tsx`,
  `session-todo-dock.tsx`, `session-question-dock.tsx`,
  `session-followup-dock.tsx`, `session-revert-dock.tsx`. These already
  have the right *behavior* (confirmed in Step 1 orientation) — this pass
  is purely visual.
- **`packages/app/src/components/`** — 84 files, dialogs
  (`dialog-*.tsx`) and shared primitives. Some already have `-v2`
  siblings (e.g. `dialog-select-model-unpaid-v2.tsx` next to the v1);
  these aren't a parallel redesign in flight, just incremental
  per-component versioning — the restyle should consolidate to one
  version per component, not add a third.

## Sequencing

1. **Token pass** (`packages/ui/src/styles/colors.css`, `theme.css`,
   equivalent in `packages/session-ui`) — palette, spacing scale, radius,
   shadows, font stack. Gets the whole app most of the way there in one
   concentrated change, and every later step benefits from it being right
   first.
2. **Shell/sidebar** (`pages/layout/*`) — layout, density, grouping,
   iconography to match the reference.
3. **Session/chat view** (`pages/session/*`, `pages/session/timeline/*`) —
   message stream, tool-call rendering, file tabs.
4. **Composer docks** (`pages/session/composer/*`) — permission/todo/
   question/followup/revert docks. Visual only, behavior untouched.
5. **Dialogs & remaining components** (`components/dialog-*.tsx` and the
   rest of the 84-file `components/` directory) — settings, model
   picker, provider connect, command palette. Consolidate `-v2` pairs
   along the way rather than leaving both.
6. **Plan/diff views** — not yet located precisely; needs a follow-up
   look at how `plan.ts`'s file-write flow renders in the UI (likely
   `file-tree-v2.tsx` / review-panel components) before scoping this
   step in detail.

Each step is verifiable against the running `bun run dev` server in the
Browser pane before moving to the next — I'll check in at the end of
steps 1 and 2 specifically, since a wrong call there compounds downstream.

## Explicitly not touching

- Provider/model connection code (`plugin/provider/*`, `provider/*`) —
  per your instruction, copied as-is, no rebrand.
- Agent definitions, permission logic, todo persistence — already
  matches spec (from earlier orientation), this plan is visual only.
- `packages/opencode`'s embedded TUI code (`src/cli/tui/*`) — separate,
  deferred cleanup (see bootstrap commit `67504f5`), unrelated to the
  visual redesign.

## Housekeeping noticed during bootstrap (not part of this plan, flagging for later)

The full copy pulled in several packages that look like OpenCode's own
hosted-SaaS infrastructure, unrelated to a personal desktop coding
agent: `console`, `stats`, `slack`, `web`, `enterprise`, `identity`,
`containers`, `function`, `storybook`, `docs`, `http-recorder`,
`httpapi-codegen`. None of these are on the desktop app's dependency
path. Worth a separate trim pass once the redesign is stable — didn't
touch them now since you asked for "copy everything" this round and
trimming is a distinct, reviewable change.

## Open items for you to confirm

1. OK to proceed sequentially through steps 1-5 and check in after the
   token pass + sidebar (steps 1-2), or do you want a checkpoint after
   every step?
2. Any specific Claude Code surfaces you want prioritized or are fine
   with me inferring from the screenshots already in this conversation?
3. Should `-v2`/`v1` component pairs be resolved by deleting the loser
   as part of this pass, or left alone and flagged separately?
