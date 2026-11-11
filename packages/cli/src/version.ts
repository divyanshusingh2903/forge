import { Option, Schema } from "effect"

declare const OPENCODE_VERSION: string
declare const OPENCODE_CHANNEL: string
declare const OPENCODE_ARTIFACT: string
declare const FORGE_BUILD: string
declare const OPENCODE_RELEASE_HIGHLIGHTS: string

const version = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
const channel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
const artifact = typeof OPENCODE_ARTIFACT === "string" ? OPENCODE_ARTIFACT : "cli"
// A Forge release names its build (`<opencode>-v<forge>`) so the desktop can tell its own server from an
// older Forge release's, which reports the same OpenCode version. Other builds have none.
const build = typeof FORGE_BUILD === "string" ? FORGE_BUILD : undefined
// Stable release builds embed the release notes' Highlights; every other build has none.
const highlights =
  typeof OPENCODE_RELEASE_HIGHLIGHTS === "string"
    ? Option.getOrElse(
        Schema.decodeUnknownOption(
          Schema.fromJsonString(Schema.Array(Schema.Struct({ title: Schema.String, body: Schema.String }))),
        )(OPENCODE_RELEASE_HIGHLIGHTS),
        () => [],
      )
    : []

export {
  version as OPENCODE_VERSION,
  channel as OPENCODE_CHANNEL,
  artifact as OPENCODE_ARTIFACT,
  build as FORGE_BUILD,
  highlights as OPENCODE_HIGHLIGHTS,
}
export const OPENCODE_LOCAL = channel === "local"
