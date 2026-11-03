export * as BrowserDisplay from "./display.js"

import { Option, Schema } from "effect"
import type { Browser } from "./rpc.js"

// Snapshot lines read `@e12 [button] "Save" checked=false`; the name is JSON-quoted.
const ELEMENT = /^\s*@(\S+) \[([^\]]*)\] ("(?:[^"\\]|\\.)*")/gm

// Refs are unique across a session's tabs and pages, so one map per session names any ref the agent can use.
// Old pages' refs are never valid again, so the map only needs to outlive a few snapshots.
const MAX_LABELS = 5_000

const decodeName = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.String))

/** Element names by ref, as `role "name"`, from the snapshots and finds a session has read. */
export type Labels = Map<string, string>

/** What a browser call's Code Mode row shows. */
export type Display = Record<string, string | number | boolean>

/** The elements a browser call touched, the page it ended on, and what a read returned. */
export function describe(
  action: Browser.Action,
  output: unknown,
  labels: Labels,
  saved: ReadonlyArray<{ readonly mime: string; readonly path: string }> = [],
): Display {
  const display: Display = {}
  // A ref from a user's browser comment is written `@e12`.
  const name = (ref: string) => labels.get(ref.replace(/^@/, ""))

  if (action.type === "snapshot" || action.type === "find") {
    const snapshot = Option.getOrUndefined(decodeSnapshot(output))

    display.elements = remember(labels, snapshot?.content)

    if (action.type === "find") display.matches = snapshot?.content ? snapshot.content.split("\n").length : 0

    if (snapshot?.truncated) display.truncated = true
  }

  if (action.type === "drag") {
    display.from = name(action.from) ?? action.from
    display.to = name(action.to) ?? action.to
  }

  if (action.type === "fill_form")
    display.fields = action.fields.map((field) => name(field.ref) ?? field.ref).join(", ")

  const label = "ref" in action && action.ref ? name(action.ref) : undefined

  if (label) display.target = label

  const page = Option.getOrUndefined(decodePage(output))

  if (page && ["navigate", "back", "forward", "reload", "tabs.open"].includes(action.type)) {
    display.url = page.url

    if (page.title) display.title = page.title
  }

  // The app reads tool results without their image data, so a screenshot names the copy the server saved.
  const image = saved.find((file) => file.mime.startsWith("image/"))

  if (action.type === "screenshot" && image) display.image = image.path

  return display
}

/** Reads the elements a snapshot listed into `labels` and returns how many it listed. */
function remember(labels: Labels, content: string | undefined) {
  if (!content) return 0

  const elements = Array.from(content.matchAll(ELEMENT))

  if (labels.size + elements.length > MAX_LABELS) labels.clear()

  elements.forEach((element) => {
    const name = Option.getOrElse(decodeName(element[3]), () => "").trim()

    labels.set(element[1], name ? `${element[2]} "${name}"` : element[2])
  })

  return elements.length
}

const decodeSnapshot = Schema.decodeUnknownOption(Schema.Struct({ content: Schema.String, truncated: Schema.Boolean }))

const decodePage = Schema.decodeUnknownOption(Schema.Struct({ url: Schema.String, title: Schema.String }))
