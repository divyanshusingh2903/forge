import { describe, expect } from "bun:test"
import { Effect, Types } from "effect"
import { Agent } from "@opencode/core/agent"
import { Memory } from "@opencode/core/memory"
import { ForgeMemoryPlugin } from "@opencode/core/plugin/forge-memory"
import { AbsolutePath } from "@opencode/core/schema"
import { it } from "../lib/effect"
import { host } from "./host"

const build = Agent.ID.make("build")
const explore = Agent.ID.make("explore")
const notes = AbsolutePath.make("/data/memory/repo-abc123")

/** Runs the plugin over a primary and a subagent, returning the rules each one gained. */
const run = Effect.fnUntraced(function* (directory: AbsolutePath | undefined) {
  const agents = new Map<Agent.ID, Types.DeepMutable<Agent.Info>>([
    [build, { ...Agent.Info.default(build), mode: "primary", permissions: [] }],
    [explore, { ...Agent.Info.default(explore), mode: "subagent", permissions: [] }],
  ])
  yield* ForgeMemoryPlugin.Plugin.effect(
    host({
      agent: {
        get: () => Effect.die("unused agent.get"),
        list: () => Effect.die("unused agent.list"),
        reload: () => Effect.void,
        transform: (callback) => {
          callback({
            list: () => Array.from(agents.values()),
            get: (id) => agents.get(Agent.ID.make(id)),
            default: () => {},
            update: (id, update) => {
              const agent = agents.get(Agent.ID.make(id))
              if (agent) update(agent)
            },
            remove: () => {},
          })
          return Effect.succeed({ dispose: Effect.void })
        },
      },
    }),
  ).pipe(
    Effect.provideService(
      Memory.Service,
      Memory.Service.of({
        directory: () => Effect.succeed(directory),
        index: () => Effect.die("unused memory.index"),
      }),
    ),
  )
  return { build: agents.get(build)!.permissions, explore: agents.get(explore)!.permissions }
})

describe("ForgeMemoryPlugin", () => {
  it.effect("lets every agent reach memory and keeps subagents read-only", () =>
    Effect.gen(function* () {
      const rules = yield* run(notes)
      const external = { action: "external_directory", resource: `${notes}/*`, effect: "allow" } as const

      expect(rules.build).toEqual([external])
      expect(rules.explore).toEqual([external, { action: "edit", resource: `${notes}/*`, effect: "deny" }])
    }),
  )

  it.effect("adds no rules when memory is off", () =>
    Effect.gen(function* () {
      expect(yield* run(undefined)).toEqual({ build: [], explore: [] })
    }),
  )
})
