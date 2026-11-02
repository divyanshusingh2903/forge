import { expect } from "bun:test"
import { ForgeMcpPlugin } from "@opencode/core/plugin/forge-mcp"
import type { Mcp } from "@opencode/schema/mcp"
import { Effect, type Types } from "effect"
import { it } from "../lib/effect"
import { host } from "./host"

it.effect("adds the built-in MCP servers disabled and leaves configured ones alone", () =>
  Effect.gen(function* () {
    const configured: Types.DeepMutable<Mcp.ServerConfig> = { type: "remote", url: "https://github.example/mcp" }
    const servers: Record<string, Types.DeepMutable<Mcp.ServerConfig>> = { github: configured }
    const base = host()

    yield* ForgeMcpPlugin.Plugin.effect(
      host({
        mcp: {
          ...base.mcp,
          transform: (transform) =>
            Effect.sync(() => {
              transform({
                list: () => Object.entries(servers),
                get: (name) => servers[name],
                set: (name, server) => {
                  servers[name] = structuredClone(server) as Types.DeepMutable<Mcp.ServerConfig>
                },
                update: () => {
                  throw new Error("unused")
                },
                remove: () => {
                  throw new Error("unused")
                },
              })
              return { dispose: Effect.void }
            }),
        },
      }),
    )

    expect(Object.keys(servers).toSorted()).toEqual(["github", "gitlab", "jira", "linear", "notion", "sentry"])
    expect(servers.github).toBe(configured)
    expect(servers.sentry).toEqual({ type: "remote", url: "https://mcp.sentry.dev/mcp", disabled: true })
  }),
)
