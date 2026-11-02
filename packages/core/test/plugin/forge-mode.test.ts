import { describe, expect } from "bun:test"
import { Effect } from "effect"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import { ForgeMode } from "@opencode/schema/forge-mode"
import { ForgeModePlugin } from "@opencode/core/plugin/forge-mode"
import { Session } from "@opencode/core/session"
import { it } from "../lib/effect"
import { host } from "./host"

const root = Session.ID.make("ses_forge_mode_root")
const child = Session.ID.make("ses_forge_mode_child")

/** Runs the plugin with a root session in `mode` and a subagent that inherited `childMode`, returning its hook. */
const run = Effect.fnUntraced(function* (mode: ForgeMode.Mode | undefined, childMode?: ForgeMode.Mode) {
  let evaluate: ((input: PermissionEvaluation) => Effect.Effect<void>) | undefined
  const info = (id: Session.ID) =>
    // SAFETY: the plugin reads only the parent and metadata of a Session.
    ({
      id,
      parentID: id === child ? root : undefined,
      metadata: (id === child ? childMode : mode) ? { [ForgeMode.key]: id === child ? childMode! : mode! } : undefined,
    }) as unknown as Session.Info
  yield* ForgeModePlugin.Plugin.effect(
    host({
      session: { get: (input) => Effect.sync(() => info(input.sessionID)) },
      permission: {
        hook: (name, callback) => {
          if (name === "evaluate") evaluate = callback
          return Effect.succeed({ dispose: Effect.void })
        },
        list: () => Effect.die("unused permission.list"),
        get: () => Effect.die("unused permission.get"),
        reply: () => Effect.die("unused permission.reply"),
        assert: () => Effect.die("unused permission.assert"),
      },
    }),
  )
  if (!evaluate) return yield* Effect.die("forge mode plugin did not register an evaluate hook")
  const hook = evaluate

  return (action: string, effect: PermissionEvaluation["effect"] = "ask", sessionID = root) =>
    Effect.gen(function* () {
      const event: PermissionEvaluation = { sessionID, action, resources: ["*"], effect }
      yield* hook(event)

      return event.effect
    })
})

describe("ForgeModePlugin", () => {
  it.effect("manual and unset modes leave asks alone", () =>
    Effect.gen(function* () {
      expect(yield* (yield* run(undefined))("edit")).toBe("ask")
      expect(yield* (yield* run("manual"))("edit")).toBe("ask")
    }),
  )

  it.effect("edits mode allows only file edits", () =>
    Effect.gen(function* () {
      const evaluate = yield* run("edits")
      expect(yield* evaluate("edit")).toBe("allow")
      expect(yield* evaluate("shell")).toBe("ask")
    }),
  )

  it.effect("auto mode allows every ask but never a deny", () =>
    Effect.gen(function* () {
      const evaluate = yield* run("auto")
      expect(yield* evaluate("shell")).toBe("allow")
      expect(yield* evaluate("external_directory")).toBe("allow")
      expect(yield* evaluate("edit", "deny")).toBe("deny")
    }),
  )

  it.effect("subagents follow the root session's current mode", () =>
    Effect.gen(function* () {
      expect(yield* (yield* run("auto", "manual"))("shell", "ask", child)).toBe("allow")
      expect(yield* (yield* run("manual", "auto"))("shell", "ask", child)).toBe("ask")
    }),
  )
})
