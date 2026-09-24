# Session-scoped terminal + cursor blink fix

## Summary
Split terminal tabs from workspace/project scope to isolated per-session scope (kill on archive/delete), and fix cursor that keeps blinking when focus is in chat/review. Pure-client partitioning, no backend PTY schema change.

## Context / Findings
- Terminal UI is `ghostty-web` in `packages/app/src/components/terminal.tsx` (`cursorBlink:true` at construction, focus/blur gating only via textarea).
- Store is `packages/app/src/context/terminal.tsx`: `getWorkspaceTerminalCacheKey(dir,scope)` + `Persist.serverWorkspace(scope,dir,"terminal")`, explicit comment "tabs persist while switching sessions". `LocalPTY` has no sessionID.
- Backend `packages/core/src/pty.ts` `Pty.Service` is `Location`-scoped, no sessionID; protocol `packages/protocol/src/groups/pty.ts` uses `LocationQuery`.
- `packages/app/src/pages/session.tsx` deliberately keys `SessionPage` on `scope+directory` only to preserve PTYs; `layout.tabs/view(sessionKey)` already per-session, only PTY list is shared.
- Panels: `terminal-panel-v2.tsx` correctly gates focus via `focusRequested`, legacy `terminal-panel.tsx:86-118` refocuses ungated on every open/active change + rAF+timers. `cancelFocus()` clears flag but never blurs DOM. `helpers.ts:focusTerminalById` synthesizes pointerdown fallback that steals focus.
- E2E `e2e/regression/terminal-tab-switch.spec.ts` pins workspace persistence and will invert.

## Approach
Keep backend untouched. Key frontend cache + persist by `(scope,dir,sessionID)`, trim outgoing session on switch, remount or switch memo on session change, fan out destroy on archive/delete tabs paths. For blink: default `cursorBlink:false`, blur on unmount/hide/tab-switch, gate V1 like V2, remove synthetic pointerdown, add CSS `:focus-within` fallback.

## Files affected
- `packages/app/src/context/terminal.tsx` — session cache key, persist target, trimAll inversion, destroy/clear per-session, LRU guard
- `packages/app/src/pages/session.tsx` — include sessionID in page key (or document no-remount alt), update stale comments
- `packages/app/src/pages/session/terminal-panel-v2.tsx`, `terminal-panel.tsx`, `handoff.ts` — handoff key `sessionKey()`, V1 focus gate
- `packages/app/src/components/terminal.tsx` — `cursorBlink:false` default, focusout handling, blur on cleanup, fix mount race
- `packages/app/src/pages/session/helpers.ts` — remove synthetic pointerdown fallback
- `packages/app/src/context/tabs.tsx` (`removeSessions`/`removeSessionTab` only, never `removeTab`), `pages/session/session-archive.ts`, `pages/home-session-archive.ts`, `pages/layout.tsx` — kill session terminals on archive/delete/reset only
- `packages/app/src/context/terminal.test.ts`, `e2e/regression/terminal-tab-switch.spec.ts` — update + rewrite contract

## Step-by-step implementation
1. `context/terminal.tsx`: replace `WORKSPACE_KEY`/`getWorkspaceTerminalCacheKey` with `getSessionTerminalCacheKey(dir,sessionID,scope)`; persist via `Persist.serverSession(...,sessionID,"terminal",legacy=[workspace key])`; rename `createWorkspaceTerminalSession/loadWorkspace` to session variants; invert switch effect to `trimAll` outgoing session only.
2. `context/terminal.tsx`: add `destroySessionTerminals({dir,sessionID,scope,sdk})` (clear cache, remove persisted + legacy keys, best-effort `pty.remove` with v1/v2 guard); keep `clearWorkspaceTerminals` as loop shim; raise `MAX_TERMINAL_SESSIONS` 20->60 and skip evicting active session.
3. `pages/session.tsx`: change `TargetSessionPage` key to include `params.id`; update comments. Alt if timeline jank: keep key, rely on terminal memo switch + reset panel `recovered` map on `sessionKey()` change — benchmark per `packages/app/AGENTS.md`.
4. Panels/handoff: switch `set/getTerminalHandoff` from `workspaceKey()` to `sessionKey()` in both panels.
5. Cleanup wiring (archive/delete only, never tab-close): call `destroySessionTerminals` from `session-archive.ts` + home archive after `notifySessionTabsRemoved`, and from `tabs.removeSessions` (archive-only, fed solely by `notifySessionTabsRemoved`) + `tabs.removeSessionTab` (not-found close only). Do NOT touch `tabs.removeTab`/`closeTab` — `closeTab` pushes onto the closed stack for `reopenClosedTab()` and the session stays alive in history/sidebar, so destroying there would wipe a running dev server + scrollback on plain declutter. `event-reducer.ts` unchanged.
6. Blink fix `components/terminal.tsx`: `cursorBlink:false` at construction; add container `focusout` -> blur + `cursorBlink=false`; single sync `focusTerminal`, add `blurTerminal()`; capture active element after `loadGhostty()`, only focus when `document.hasFocus()`; call `blurTerminal()` in `onCleanup`.
7. Blink fix panels: replace V1 ungated `focus()+rAF+120/240ms` block with V2 `focusRequested` gate; make `cancelFocus()` also blur `#terminal-panel textarea`; remove synthetic pointerdown in `focusTerminalById` (return false if not ready).
8. CSS fallback: `[data-component="terminal"]:not(:focus-within) .xterm-cursor-layer{opacity:0}` after verifying ghostty-web selector.
9. Migration: first session to load claims legacy `workspace:terminal` via existing `migrateLegacy`, strip buffers so stale `ptyID` hits `gone()->clone()` recovery; `__nosession__`/draft never migrates.

## Risks / edge cases
- One-way migration: `workspace:terminal` deleted on claim; rollback not automatic (local UI state only).
- Two sessions briefly sharing backend `ptyID` after migration -> both attach; second `pty.remove` 404 tolerated, `gone()->clone()` recreates.
- Rapid session switch: old WS closes on unmount, at most one open; trimmed buffers persist, no leak.
- Session moved across directories: terminals stay with old `(dir,session)` key, new dir starts empty (intended, cwd-bound).
- Missing dir in archive cleanup: skip `pty.remove`, still clear cache+persisted.
- Tab close / `reopenClosedTab`: terminals survive `closeTab`/`removeTab` by design; only archive/delete kills (see step 5).
- V1 gate change: opening terminal no longer auto-focuses unless `new({focus:true})` — intended.

## Testing strategy
- Unit (from `packages/app`, never root): session keys differ per session same dir; legacy migrates once; `removeSessions`/archive calls destroy, `closeTab`/`removeTab` does NOT; `focusTerminalById` no textarea -> false no pointerdown; terminal mount default blink false, focus->true blur->false.
- E2E rewrite `terminal-tab-switch.spec.ts`: probe in A, switch B shows empty/different PTY (2 connections), back to A restores probe no 3rd connection. New `terminal-session-cleanup.spec.ts`: archive A kills its PTY + persisted key, B untouched. New `terminal-cursor-focus.spec.ts`: terminal focused -> click composer -> activeElement is composer, cursor hidden; close -> nothing focused in `#terminal-panel`.
- Manual: backend `bun run ./src/index.ts serve --port 4096` (from `packages/opencode`) + `bun dev -- --port 4444` (from `packages/app`), open `http://localhost:4444`: two sessions same worktree distinct terminals, reload preserves, archive kills; click chat/review stops blink, `+` still focuses.
- `bun typecheck` from `packages/app`.
