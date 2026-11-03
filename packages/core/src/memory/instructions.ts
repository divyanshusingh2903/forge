export * as MemoryInstructions from "./instructions.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Instructions } from "../instructions/index.js"
import { Memory } from "../memory.js"
import PROMPT from "./memory.txt"

const Value = Schema.Struct({
  directory: Schema.String,
  subagent: Schema.Boolean,
  index: Schema.Union([
    Schema.Struct({ status: Schema.Literal("missing") }),
    Schema.Struct({ status: Schema.Literal("unreadable") }),
    Schema.Struct({ status: Schema.Literal("ok"), text: Schema.String, truncated: Schema.Boolean }),
  ]),
})
type Value = typeof Value.Type

export interface Interface {
  /** The memory guidance and bounded index; subagents get read-only guidance. */
  readonly load: (subagent: boolean) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MemoryInstructions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    return Service.of({
      load: (subagent) =>
        Effect.succeed(
          Instructions.make({
            key: Instructions.Key.make("forge/memory"),
            codec: Schema.toCodecJson(Value),
            read: Effect.gen(function* () {
              const directory = yield* memory.directory()
              // Turning memory off is an observed absence, so the model is told to stop using it.
              if (!directory) return Instructions.removed
              return { directory, subagent, index: yield* memory.index(directory) }
            }),
            render: {
              initial: render,
              changed: (previous, current) =>
                previous.directory === current.directory && previous.subagent === current.subagent
                  ? ["MEMORY.md has changed. This index supersedes the previous memory index:", index(current)].join("\n")
                  : ["Your memory has changed. This supersedes the previous memory section:", render(current)].join("\n"),
              removed: () =>
                "Local memory is now turned off. Ignore the previous memory index and do not read or write memory notes.",
            },
          }),
        ),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Memory.node] })

function render(value: Value) {
  return [guidance(value), index(value)].join("\n\n")
}

function guidance(value: Value) {
  if (value.subagent)
    return [
      "# Memory",
      "",
      `The user's persistent memory for this repository is at \`${value.directory}\`. Its index is loaded below.`,
      "Memory is read-only for you as a subagent: never create, edit, or delete files there.",
      "Read a topic note with your normal file tools only when it looks relevant to your task.",
    ].join("\n")
  return PROMPT.replaceAll("{{MEMORY_DIR}}", value.directory).replaceAll("{{MAX_LINES}}", String(Memory.MAX_LINES))
}

function index(value: Value) {
  if (value.index.status === "missing") return "<memory_index>\n(empty: MEMORY.md does not exist yet)\n</memory_index>"
  if (value.index.status === "unreadable")
    return [
      "<memory_index>",
      "(MEMORY.md exists but could not be read.)",
      "</memory_index>",
      "Do not create or overwrite MEMORY.md or other memory notes; tell the user memory is unreadable if it matters.",
    ].join("\n")
  return [
    "<memory_index>",
    value.index.text,
    "</memory_index>",
    ...(value.index.truncated
      ? [
          `MEMORY.md exceeds ${Memory.MAX_LINES} lines or ${Memory.MAX_BYTES} bytes, so only the start is shown. Consolidate it by merging or removing entries next time you save a memory.`,
        ]
      : []),
  ].join("\n")
}
