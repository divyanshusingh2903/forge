export * as Memory from "./memory.js"

import path from "path"
import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Hash } from "@opencode/util/hash"
import { Config } from "./config.js"
import { Location } from "./location.js"
import { AbsolutePath } from "./schema.js"

export const INDEX_FILE = "MEMORY.md"
export const MAX_LINES = 100
export const MAX_BYTES = 12_800

export type Index =
  | { readonly status: "missing" }
  | { readonly status: "unreadable" }
  | { readonly status: "ok"; readonly text: string; readonly truncated: boolean }

export interface Interface {
  /**
   * This Location's memory directory, keyed by the Git common directory so every worktree of a repository shares it,
   * or by the directory itself outside Git. Undefined when config sets `memory: false`.
   */
  readonly directory: () => Effect.Effect<AbsolutePath | undefined>
  /** Bounded read of the index file. Never creates or modifies anything. */
  readonly index: (directory: AbsolutePath) => Effect.Effect<Index>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service

    const key = yield* Effect.cached(fs.resolve(location.vcs?.store ?? location.directory))

    const directory = Effect.fn("Memory.directory")(function* () {
      if (Config.latest(yield* config.entries(), "memory") === false) return
      const resolved = yield* key
      // `<repo>/.git` reads better as `<repo>` in the folder name; the hash still covers the full key.
      const label = path.basename(resolved) === ".git" ? path.dirname(resolved) : resolved
      const slug = label.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      return AbsolutePath.make(path.join(global.data, "memory", `${slug}-${Hash.sha256(resolved).slice(0, 6)}`))
    })

    const index = Effect.fn("Memory.index")(function* (directory: AbsolutePath) {
      return yield* fs.readFileString(path.join(directory, INDEX_FILE)).pipe(
        Effect.map((text): Index => ({ status: "ok", ...bound(text) })),
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.succeed<Index>({ status: "missing" }),
        ),
        Effect.orElseSucceed((): Index => ({ status: "unreadable" })),
      )
    })

    return Service.of({ directory, index })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, FSUtil.node, Global.node, Location.node],
})

/** Keep whole lines within MAX_LINES and MAX_BYTES; never split a character. */
export function bound(input: string) {
  const lines = (input.endsWith("\n") ? input.slice(0, -1) : input).split("\n")
  const head = lines.slice(0, MAX_LINES).join("\n")
  if (Buffer.byteLength(head) <= MAX_BYTES) return { text: head, truncated: lines.length > MAX_LINES }
  const fitted = fitBytes(head, MAX_BYTES)
  const newline = fitted.lastIndexOf("\n")
  return { text: newline === -1 ? fitted : fitted.slice(0, newline), truncated: true }
}

function fitBytes(text: string, limit: number) {
  const chars = Array.from(text)
  let bytes = 0
  const end = chars.findIndex((char) => (bytes += Buffer.byteLength(char)) > limit)
  return end === -1 ? text : chars.slice(0, end).join("")
}
