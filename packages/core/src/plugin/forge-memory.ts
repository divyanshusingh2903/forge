export * as ForgeMemoryPlugin from "./forge-memory.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Memory } from "../memory.js"

/**
 * Lets agents reach the repository's memory folder, which lives outside the checkout, without an external directory
 * prompt for every note. Subagents may read memory but never write it, so parallel subagents cannot race on the index.
 * `memory: false` drops both rules; existing notes stay on disk.
 */
export const Plugin = define({
  id: "forge.memory",
  effect: Effect.fn(function* (ctx) {
    const memory = yield* Memory.Service
    const loaded = { directory: yield* memory.directory() }
    const reload = memory.directory().pipe(
      Effect.tap((directory) => Effect.sync(() => (loaded.directory = directory))),
      Effect.andThen(ctx.agent.reload()),
    )
    yield* ctx.event
      .subscribe({ types: ["config.updated"] })
      .pipe(Stream.runForEach(() => reload), Effect.forkScoped({ startImmediately: true }))

    yield* ctx.agent.transform((editor) => {
      if (!loaded.directory) return
      // Paths outside the Location are checked by their absolute, slash-separated form.
      const notes = `${loaded.directory.replaceAll("\\", "/")}/*`
      for (const item of editor.list()) {
        editor.update(item.id, (agent) => {
          agent.permissions.push({ action: "external_directory", resource: notes, effect: "allow" })
          if (agent.mode === "subagent") agent.permissions.push({ action: "edit", resource: notes, effect: "deny" })
        })
      }
    })
  }),
})
