// Minimal TUI config for the --mini UI. The full terminal UI was removed;
// --mini only needs keybinds, leader timeout, and diff style, read from the
// same tui.json files so existing user keybinds keep working.
export * as MiniConfig from "./config"

import path from "path"
import { mergeDeep, unique } from "remeda"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Context, Effect, Layer } from "effect"
import { Schema } from "effect"
import { createBindingLookup } from "@opentui/keymap/extras"
import { ConfigParse } from "@/config/parse"
import * as ConfigPaths from "@/config/paths"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CurrentWorkingDirectory } from "../../config/cwd"
import { ConfigVariable } from "@/config/variable"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { MiniKeybind } from "./keybind"

export const LeaderTimeoutDefault = 2000
export const LeaderTimeout = Schema.Int.check(Schema.isGreaterThan(0))
export const DiffStyle = Schema.Literals(["auto", "stacked"])
export type DiffStyle = Schema.Schema.Type<typeof DiffStyle>

export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  keybinds: Schema.optional(MiniKeybind.KeybindOverrides),
  leader_timeout: Schema.optional(LeaderTimeout),
  diff_style: Schema.optional(DiffStyle),
})
export type Info = Schema.Schema.Type<typeof Info>

export type Resolved = {
  keybinds: MiniKeybind.BindingLookupView
  leader_timeout: number
  diff_style: DiffStyle
}

export function resolve(input: Info): Resolved {
  const keybinds: MiniKeybind.KeybindOverrides = { ...input.keybinds }
  if (process.platform !== "win32") {
    keybinds.terminal_suspend = "none"
    if (keybinds.input_undo === undefined) {
      const inputUndo = MiniKeybind.defaultValue("input_undo")
      keybinds.input_undo = ["ctrl+z", ...(typeof inputUndo === "string" ? inputUndo.split(",") : [])]
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(",")
    }
  }

  return {
    keybinds: createBindingLookup(MiniKeybind.toBindingConfig(MiniKeybind.parse(keybinds)), {
      commandMap: MiniKeybind.CommandMap,
      bindingDefaults: MiniKeybind.bindingDefaults(),
    }),
    leader_timeout: input.leader_timeout ?? LeaderTimeoutDefault,
    diff_style: input.diff_style ?? "auto",
  }
}

function normalize(raw: Record<string, unknown>) {
  const data = { ...raw }
  if (!("tui" in data)) return data
  if (typeof data.tui !== "object" || data.tui === null || Array.isArray(data.tui)) {
    delete data.tui
    return data
  }
  const tui = data.tui
  delete data.tui
  return { ...tui, ...data }
}

function dropUnknownKeybinds(input: Record<string, unknown>) {
  if (typeof input.keybinds !== "object" || input.keybinds === null || Array.isArray(input.keybinds)) return input
  const invalid = MiniKeybind.unknownKeys(input.keybinds)
  if (!invalid.length) return input
  return {
    ...input,
    keybinds: Object.fromEntries(Object.entries(input.keybinds).filter(([key]) => !invalid.includes(key))),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

const loadState = Effect.fn("MiniConfig.loadState")(function* (ctx: { directory: string }) {
  const afs = yield* FSUtil.Service

  const load = (text: string, configFilepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute({ text, type: "path", path: configFilepath, missing: "empty" }),
      )
      const data = ConfigParse.jsonc(expanded, configFilepath)
      if (!isRecord(data)) return {} as Info
      return ConfigParse.schema(Info, dropUnknownKeybinds(normalize(data)), configFilepath)
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("skipping invalid tui config", {
          path: configFilepath,
          reason: FormatError(Cause.squash(cause)) ?? FormatUnknownError(Cause.squash(cause)),
        }).pipe(Effect.as({} as Info)),
      ),
    )

  const loadFile = (filepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      const text = yield* afs.readFileStringSafe(filepath).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to read tui config", {
            path: filepath,
            reason: FormatError(Cause.squash(cause)) ?? FormatUnknownError(Cause.squash(cause)),
          }).pipe(Effect.as(undefined)),
        ),
      )
      if (!text) return {} as Info
      return yield* load(text, filepath)
    })

  let result: Info = {}

  // 1. Global tui config (lowest precedence).
  for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
    result = mergeDeep(result, yield* loadFile(file))
  }

  // 2. Explicit OPENCODE_TUI_CONFIG override, if set.
  if (Flag.OPENCODE_TUI_CONFIG) {
    result = mergeDeep(result, yield* loadFile(Flag.OPENCODE_TUI_CONFIG))
  }

  // 3. Project tui files, applied root-first so the closest file wins.
  if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
    for (const file of yield* ConfigPaths.files("tui", ctx.directory)) {
      result = mergeDeep(result, yield* loadFile(file))
    }
  }

  // 4. `.opencode` directories (and OPENCODE_CONFIG_DIR) walking up the tree.
  const directories = yield* ConfigPaths.directories(ctx.directory)
  const dirs = unique(directories).filter((dir) => dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR)
  for (const dir of dirs) {
    for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
      result = mergeDeep(result, yield* loadFile(file))
    }
  }

  return resolve(result)
})

export interface Interface {
  readonly get: () => Effect.Effect<Resolved>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MiniConfig") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const directory = yield* CurrentWorkingDirectory
    const data = yield* loadState({ directory })
    const get = Effect.fn("MiniConfig.get")(() => Effect.succeed(data))
    return Service.of({ get })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node] })

const { runPromise } = makeRuntime(Service, AppNodeBuilder.build(node))

export async function get() {
  return runPromise((svc) => svc.get())
}
