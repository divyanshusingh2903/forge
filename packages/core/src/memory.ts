export * as Memory from "./memory"

import path from "path"
import { Context, Effect, Layer } from "effect"
import { AbsolutePath } from "./schema"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { Global } from "./global"
import { makeGlobalNode } from "./effect/app-node"
import { Hash } from "./util/hash"

export const INDEX_FILE = "MEMORY.md"
export const MAX_LINES = 100
export const MAX_BYTES = 12_800

export type Index =
  | { readonly status: "missing" }
  | { readonly status: "unreadable" }
  | { readonly status: "ok"; readonly text: string; readonly truncated: boolean }

export interface Interface {
  /** Memory directory for a location: keyed by the Git common directory, or the directory itself outside Git. */
  readonly directory: (input: AbsolutePath) => Effect.Effect<AbsolutePath>
  /** Bounded read of the index file. Never creates or modifies anything. */
  readonly index: (directory: AbsolutePath) => Effect.Effect<Index>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const global = yield* Global.Service

    const directory = Effect.fn("Memory.directory")(function* (input: AbsolutePath) {
      const repo = yield* git.repo.discover(input)
      const key = yield* fs.resolve(repo?.commonDirectory ?? input)
      // `<repo>/.git` reads better as `<repo>` in the folder name; the hash still covers the full key.
      const label = path.basename(key) === ".git" ? path.dirname(key) : key
      const slug = label.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      return AbsolutePath.make(path.join(global.data, "memory", `${slug}-${Hash.sha256(key).slice(0, 6)}`))
    })

    const index = Effect.fn("Memory.index")(function* (directory: AbsolutePath) {
      return yield* fs.readFileString(path.join(directory, INDEX_FILE)).pipe(
        Effect.map((text): Index => ({ status: "ok", ...bound(text) })),
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed<Index>({ status: "missing" })),
        Effect.catch(() => Effect.succeed<Index>({ status: "unreadable" })),
      )
    })

    return Service.of({ directory, index })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [FSUtil.node, Git.node, Global.node],
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
