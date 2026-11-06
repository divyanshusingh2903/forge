export * as ForgeModePlugin from "./forge-mode.js"

import { define } from "@opencode/plugin/effect/plugin"
import { ForgeMode } from "@opencode/schema/forge-mode"
import type { Session } from "@opencode/schema/session"
import { Effect } from "effect"
import { Permission } from "../permission.js"

const editActions = new Set(["edit"])

// Upstream agents allow every action. Forge asks before shell commands and file edits, as v1 did, so Manual has
// something to ask about and the other modes relax it. MCP defaults are applied at evaluation because their
// action names are discovered dynamically, rather than belonging to a fixed list of built-in actions.
const askActions = ["shell", "edit"]

/**
 * Settles permission requests by the session's Forge mode. It runs after configured denies have been applied, so it
 * makes shell commands, file edits, and MCP calls ask by default. Explicit rules and saved approvals still win.
 * Subagents follow the mode of the session at the top of their lineage, which
 * the user sets, rather than the copy of its metadata they inherited when they started.
 */
export const Plugin = define({
  id: "forge.mode",
  effect: Effect.fn(function* (ctx) {
    // The asks follow each agent's base allow-all rule, so the agent's own rules and config, which come later, still
    // override them. An agent without that rule chose its permissions outright and is left alone.
    yield* ctx.agent.transform((editor) =>
      editor.list().forEach((agent) => {
        const base = agent.permissions.findIndex(
          (rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow",
        )

        if (base === -1) return

        agent.permissions.splice(
          base + 1,
          0,
          ...askActions.map((action) => ({ action, resource: "*", effect: "ask" as const })),
        )
      }),
    )

    const rootMode = Effect.fn("ForgeModePlugin.rootMode")(function* (sessionID: Session.ID) {
      let session = yield* ctx.session.get({ sessionID })
      while (session.parentID !== undefined) session = yield* ctx.session.get({ sessionID: session.parentID })

      return ForgeMode.read(session.metadata)
    })

    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.gen(function* () {
        const rules = event.rules
        if (event.effect === "allow" && event.metadata?.mcp && rules) {
          const base = rules.findIndex(
            (rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow",
          )

          // Ignore only the agent's base allow-all. Later config, session rules, and saved approvals retain
          // their normal precedence; with no later matching rule, MCP calls default to asking.
          if (
            base !== -1 &&
            event.resources.some(
              (resource) => Permission.evaluate(event.action, resource, rules.slice(base + 1)).effect === "ask",
            )
          )
            event.effect = "ask"
        }

        if (event.effect !== "ask") return
        const mode = yield* rootMode(event.sessionID)
        if (mode === "auto" || (mode === "edits" && editActions.has(event.action))) event.effect = "allow"
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to read the session's Forge mode", { sessionID: event.sessionID, cause }),
        ),
      ),
    )
  }),
})
