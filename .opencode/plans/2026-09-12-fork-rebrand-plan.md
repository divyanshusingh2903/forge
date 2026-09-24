# Fork & Rebrand Plan — Provider-Flexible Desktop Coding Agent

Status: draft for review. No code has been touched. Product name is TBD
(candidates discussed: Anyloop, Forge, Relay — placeholder `<PRODUCT>` used
below).

## 0. Ground rules (confirmed with user)

- **New repo, not a git fork.** Selectively copy source from
  `anomalyco/opencode` (MIT) into a fresh repo. Preserve MIT license text
  and add attribution (NOTICE file / README credit) per OpenCode's
  contributing guidelines — do not strip copyright headers from copied
  files.
- **Lightweight**: drop `packages/tui` entirely. Desktop (Electron) is the
  only client. Bring over `packages/core`, `packages/opencode` (server/CLI),
  `packages/app` (shared Solid UI), `packages/desktop`, `packages/sdk`,
  `packages/schema`, and whichever `plugin/*` packages the provider layer
  needs. Drop TUI-only code paths in `agent.ts`/session code once TUI is gone
  (e.g. the `plan_enter` TUI listener referenced in `tui/src/routes/session`
  needs a desktop-side replacement, not a straight copy).
- **Keep Claude/Anthropic as a provider** — just not the default/primary
  onboarding path.
- **Separate branch**, main untouched (applies once work starts in the new
  repo — this plan file itself lives in the existing opencode checkout's
  gitignored `.opencode/plans/`, nothing committed).
- Flag anything needing legal/ToS review instead of implementing silently
  (see §5).

## 1. What actually needs to change (grounded in Step 1 findings)

| Area | Current state | Change needed |
|---|---|---|
| Agent definitions (`agent/agent.ts`) | 7 native agents, generic prompts, no Claude branding | Rename `<PRODUCT>`-specific bits only; agent logic itself is provider-agnostic already — **no structural change needed** |
| Model-based system prompt (`session/system.ts:27-50`) | Picks `PROMPT_ANTHROPIC` when model ID contains `"claude"`, else GPT/Gemini/etc. variants | Keep the branching (it's legitimately useful — different models respond better to different prompt styles) but neutralize the copy in `anthropic.txt` ("best coding agent on the planet" is fine generically) and make sure `PROMPT_DEFAULT` is the fallback for unknown/local models, not an Anthropic-flavored one |
| AGENTS.md / CLAUDE.md loading (`session/instruction.ts`) | Reads `AGENTS.md` primary, `CLAUDE.md` secondary (toggleable via `disableClaudeCodePrompt`) | Drop the `CLAUDE.md` compat path; `AGENTS.md` only, flag renamed appropriately |
| Provider onboarding (`cli/cmd/providers.ts:371-378`) | Anthropic priority 4 in a fixed sort order | Reorder so OpenAI/ChatGPT auth and OpenAI-compatible custom endpoints are first-class in the onboarding flow; Anthropic stays in the list, no longer favored |
| Default model priority (`provider/provider.ts:2047`) | `["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]` | This is already provider-neutral (GPT is first) — likely needs no change, just verify against whatever default OpenAI model you want to lead with |
| Plan mode: `plan_enter` | Permission plumbing + TUI listener exist; **no tool implementation** (stub) | Implement the actual `plan_enter` tool (mirrors `PlanExitTool` in `tool/plan.ts`) so entering plan mode is an explicit, agent-triggerable action, not just a CLI `--agent plan` flag |
| Plan mode: accept/auto-run distinction | `plan_exit` is binary yes/no (switch to build or don't); `--yolo`/`--dangerously-skip-permissions` is a global bypass flag; app has an unused `autoApprove` setting | Build the three-way choice you want: **step-through** (current default — ask per risky action), **auto-run** (wire the dormant `autoApprove` setting to actually skip the permission-ask UI for the rest of the session/task), **reject/revise** (already works via `plan_exit` "no" + follow-up chat) |
| Todo tool | Already SQLite-persisted, live-pushed to desktop UI via `todo.updated` event | No change needed — matches spec as-is |
| Subagent system (`task` tool) | Already supports named `subagent_type`, isolated child sessions, custom types via `.opencode/agent/*.md` | No structural change; optional polish: real summarization on task return instead of raw last-message passthrough |
| Desktop UI look/feel | Solid.js app in `packages/app`, own visual identity | Restyle pass: sidebar, message layout, permission dock, todo dock, plan/diff views, color + typography — toward Claude-Code-like density and interaction patterns. This is a design/CSS-and-component pass, not an architecture change |
| Browser-use tool | Doesn't exist | New tool, same shape as `webfetch`/`shell` (Playwright or CDP-driven), added to `build`/`explore` agent permission sets, gated behind explicit permission like any mutating tool |

## 2. Sequencing

1. **Repo bootstrap** — new repo, copy `core`/`opencode`/`app`/`desktop`/`sdk`/`schema`, strip TUI references, get it building and passing existing tests before any behavioral change. This is the highest-risk step (see §4) and should be its own milestone before touching product behavior.
2. **Rebrand pass** — strings/branding/docs, `AGENTS.md`-only context loading, provider onboarding reorder. Low architectural risk, mostly search-and-replace plus onboarding flow edits.
3. **Plan-mode UX** — implement `plan_enter`, wire `autoApprove` into the permission-ask flow for the three-way accept model. Medium risk — touches permission-evaluation code paths used everywhere.
4. **Desktop UI restyle** — visual/component pass on `packages/app`. Independent of 2-3, can run in parallel. Low architectural risk, high time cost (design iteration).
5. **Browser-use tool** — additive, do last since it depends on nothing else and nothing else depends on it.

## 3. File-by-file diff estimate (rough)

- Repo bootstrap / package trimming: touches every `package.json`/workspace config, ~10-15 files, mostly deletions (TUI package) and path fixups.
- Rebrand: `session/system.ts`, `session/instruction.ts`, `cli/cmd/providers.ts`, prompt `.txt` files (~5), README/docs (~10-20 files), plus any hardcoded product-name strings in `packages/app` (search-and-replace, could touch 30+ files trivially).
- Plan mode: new `tool/plan-enter.ts` (~50-80 lines, mirrors existing `plan.ts`), changes to `permission/index.ts` or `evaluate.ts` for the auto-run bypass scope, `packages/app` settings wiring (~3-5 files) plus the permission-dock component (~1-2 files).
- Desktop restyle: primarily `packages/app/src/pages/**`, `components/**`, theme/CSS — size depends entirely on how far the redesign goes; could be 20 files or 100+.
- Browser tool: 1 new tool file + registry entry + permission config entry + agent allowlist edits (~3-4 files).

## 4. Risk areas

- **Bootstrap risk**: OpenCode's packages have internal cross-imports (`app` depends on `sdk`, `desktop` spawns `opencode` server as a sidecar, `core` is depended on by both). Dropping TUI is clean (no back-references found), but verify no shared code lives *inside* `packages/tui` that `app`/`desktop` also need — Step 1 found TUI as its own client, not a shared dependency, but this should be re-verified during bootstrap, not assumed.
- **Tests tied to agent prompts**: any snapshot/golden tests asserting exact prompt text (`PROMPT_ANTHROPIC`, etc.) will break on rebrand copy changes — expect to update fixtures, not logic.
- **Permission-evaluation changes are high blast-radius**: `permission/evaluate.ts` and `assert`/`ask` are called from `session/tools.ts`, `prompt.ts`, and `llm.ts` — the auto-run wiring for plan mode must not accidentally weaken the default step-through path for non-plan sessions. Needs explicit test coverage before merge.
- **CLAUDE.md removal** could break existing users' muscle memory if this fork is ever meant to be drop-in compatible with OpenCode configs — low risk here since this is a personal fork, but worth a one-line migration note in docs.

## 5. Needs legal/ToS review before implementing

- **Unofficial ChatGPT-Plus subscription auth** (as opposed to standard OpenAI API key auth) — if the plan is to authenticate against consumer ChatGPT sessions rather than the metered API, this likely violates OpenAI's ToS around automated/unofficial API access. Flagging this explicitly per your instruction — **do not implement without your sign-off**, and recommend defaulting to standard OpenAI API-key auth (which OpenCode's `OpenAICompatiblePlugin` already supports cleanly) unless you've separately confirmed the ChatGPT-session route is acceptable for your use.
- Nothing else in this plan touches auth methods outside standard API-key/OAuth flows already supported by OpenCode's plugin auth interface.

## 6. Timeline (rough, part-time solo, unchanged order of magnitude from earlier estimate)

| Phase | Time |
|---|---|
| Repo bootstrap + trim | 3-5 days |
| Rebrand + provider reorder | 1 week |
| Plan-mode UX (plan_enter + auto-run) | 1-1.5 weeks |
| Desktop UI restyle | 1.5-3 weeks (depends on design ambition) |
| Browser-use tool | 3-5 days |
| Stabilization/testing | 1 week |

**Total: ~5-8 weeks**, restyle scope being the biggest timeline lever.

## Open items for you to confirm before implementation starts

1. Final product name.
2. Repo bootstrap approach: copy everything then delete TUI, or cherry-pick files package-by-package? (Recommend copy-then-delete — safer, avoids missing a needed shared file.)
3. Desktop restyle: full redesign or targeted (sidebar + permission/plan/todo docks only)? Affects timeline the most.
4. Confirm: standard OpenAI API-key auth only for now, ChatGPT-session auth deferred pending ToS review (per §5)?
