export * as ForgeModePlugin from "./forge-mode.js"

import { define } from "@opencode/plugin/effect/plugin"
import { ForgeMode } from "@opencode/schema/forge-mode"
import type { Session } from "@opencode/schema/session"
import { Effect } from "effect"

const editActions = new Set(["edit"])

/**
 * Settles permission requests by the session's Forge mode. It runs after configured denies have been applied, so it
 * only turns an `ask` into an `allow`. Subagents follow the mode of the session at the top of their lineage, which
 * the user sets, rather than the copy of its metadata they inherited when they started.
 */
export const Plugin = define({
  id: "forge.mode",
  effect: Effect.fn(function* (ctx) {
    const rootMode = Effect.fn("ForgeModePlugin.rootMode")(function* (sessionID: Session.ID) {
      let session = yield* ctx.session.get({ sessionID })
      while (session.parentID !== undefined) session = yield* ctx.session.get({ sessionID: session.parentID })

      return ForgeMode.read(session.metadata)
    })

    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.gen(function* () {
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
