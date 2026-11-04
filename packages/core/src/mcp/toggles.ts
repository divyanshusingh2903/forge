export * as McpToggles from "./toggles.js"

import { Context, Effect, Layer, PubSub, Stream } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KV } from "../kv.js"

export interface Change {
  readonly server: string
  readonly enabled: boolean
}

export interface Interface {
  /** The user's last on/off choice for a server, or undefined when they never toggled it. */
  readonly get: (server: string) => Effect.Effect<boolean | undefined>
  readonly set: (server: string, enabled: boolean) => Effect.Effect<void>
  /** Every choice saved from now on, in any Location of this process. */
  readonly changes: Stream.Stream<Change>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpToggles") {}

// Keyed by server name alone, so turning a server on in one project turns it on in every project that has one of
// that name, and the choice survives restarts.
const key = (server: string) => `mcp.enabled:${server}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const changes = yield* PubSub.unbounded<Change>()
    return Service.of({
      get: Effect.fn("McpToggles.get")(function* (server) {
        const value = yield* kv.get(key(server))
        return typeof value === "boolean" ? value : undefined
      }),
      set: Effect.fn("McpToggles.set")(function* (server, enabled) {
        yield* kv.set(key(server), enabled)
        yield* PubSub.publish(changes, { server, enabled })
      }),
      changes: Stream.fromPubSub(changes),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })
