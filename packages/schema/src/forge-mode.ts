export * as ForgeMode from "./forge-mode.js"

import { Schema } from "effect"
import type { SessionMetadata } from "./session-metadata.js"

/**
 * How much a session's tools may do without asking, kept in the session's metadata under `key`.
 * `manual` asks as the rules say, `edits` also allows file edits, and `auto` allows everything the rules would ask
 * about. Configured denies always win, so no mode reaches past them.
 */
export const Mode = Schema.Literals(["manual", "edits", "auto"]).annotate({ identifier: "ForgeMode.Mode" })
export type Mode = typeof Mode.Type

export const key = "forge.mode"

const decode = Schema.decodeUnknownOption(Mode)

export function read(metadata: SessionMetadata | undefined): Mode | undefined {
  const value = decode(metadata?.[key])

  return value._tag === "Some" ? value.value : undefined
}
