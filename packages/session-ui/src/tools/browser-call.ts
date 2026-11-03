import type { PermissionRequest } from "@opencode/client/promise"
import type { UiI18n } from "@opencode/ui/context/i18n"
import { Option, Schema } from "effect"
import type { ExecuteToolCall } from "../message/current-tool-state"

const Fields = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  ref: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  key: Schema.optionalKey(Schema.String),
  script: Schema.optionalKey(Schema.String),
  condition: Schema.optionalKey(Schema.String),
  action: Schema.optionalKey(Schema.String),
  button: Schema.optionalKey(Schema.String),
  count: Schema.optionalKey(Schema.Number),
  values: Schema.optionalKey(Schema.Array(Schema.String)),
  checked: Schema.optionalKey(Schema.Boolean),
  fullPage: Schema.optionalKey(Schema.Boolean),
  deltaX: Schema.optionalKey(Schema.Number),
  deltaY: Schema.optionalKey(Schema.Number),
  target: Schema.optionalKey(Schema.String),
  from: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.String),
  fields: Schema.optionalKey(Schema.String),
  elements: Schema.optionalKey(Schema.Number),
  matches: Schema.optionalKey(Schema.Number),
  truncated: Schema.optionalKey(Schema.Boolean),
  image: Schema.optionalKey(Schema.String),
  page: Schema.optionalKey(Schema.String),
  tabs: Schema.optionalKey(Schema.Number),
  frames: Schema.optionalKey(Schema.Number),
  messages: Schema.optionalKey(Schema.Number),
  requests: Schema.optionalKey(Schema.Number),
  files: Schema.optionalKey(Schema.Number),
  request: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  paths: Schema.optionalKey(Schema.Array(Schema.String)),
})

const decodeFields = Schema.decodeUnknownOption(Fields)

const decodePermission = Schema.decodeUnknownOption(
  Schema.Struct({
    input: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    display: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
)

const none: typeof Fields.Type = {}

/**
 * Describes a Code Mode browser call in words: the element it touched, by role and name when the server knew it, the
 * text it typed, the page it reached, the tab it worked on, or what a snapshot, screenshot or listing read. Undefined
 * for other tools, and for browser calls the server described nothing about, which keep their argument list.
 */
export function browserCallSummary(call: ExecuteToolCall, i18n: Pick<UiI18n, "t" | "plural">) {
  if (!call.tool.startsWith("browser.")) return undefined

  // The display is what the server learned running the call; the input is what the script asked for.
  const input = Option.getOrElse(decodeFields(call.input ?? {}), () => none)
  const display = Option.getOrElse(decodeFields(call.display ?? {}), () => none)
  const target = display.target ?? input.ref
  const parts = summary(call.tool.slice("browser.".length), input, display, target, i18n)

  return parts.filter((part): part is string => !!part).join(" · ") || undefined
}

/**
 * Describes a browser permission request for its approval card, as its timeline row will: the operation is the
 * request's resource, and its metadata carries the call's input and what the server already knew about its targets.
 */
export function browserPermissionSummary(
  operation: string,
  metadata: PermissionRequest["metadata"],
  i18n: Pick<UiI18n, "t" | "plural">,
) {
  const request = Option.getOrUndefined(decodePermission(metadata ?? {}))

  return browserCallSummary(
    { tool: `browser.${operation}`, status: "running", input: request?.input, display: request?.display },
    i18n,
  )
}

/** The server-local path of the image a browser screenshot saved, when the server reported one. */
export function browserCallImage(call: ExecuteToolCall) {
  if (call.tool !== "browser.screenshot" || call.status !== "completed") return undefined

  return Option.getOrUndefined(decodeFields(call.display ?? {}))?.image
}

function summary(
  operation: string,
  input: typeof Fields.Type,
  display: typeof Fields.Type,
  target: string | undefined,
  i18n: Pick<UiI18n, "t" | "plural">,
): Array<string | undefined> {
  switch (operation) {
    case "tabs.list":
      return [count(display.tabs, "ui.tool.browser.tabs", i18n)]
    case "tabs.open":
    case "navigate":
    case "back":
    case "forward":
    case "reload":
      return [display.url ?? input.url]
    case "click":
      return [target, clickKind(input, i18n)]
    case "hover":
      return [target]
    case "fill":
      return [target, quote(input.text)]
    case "select":
      return [target, quote(input.values?.join(", "))]
    case "check":
      return [target, i18n.t(input.checked ? "ui.tool.browser.checked" : "ui.tool.browser.unchecked")]
    case "press":
      return [input.key, target]
    case "scroll":
      return [scrollDirection(input, i18n)]
    case "drag":
      return [display.from && display.to ? `${display.from} → ${display.to}` : undefined]
    case "fill_form":
      return [display.fields]
    case "find":
      return [quote(input.text), count(display.matches, "ui.tool.browser.matches", i18n), truncated(display, i18n)]
    case "snapshot":
      return [target, count(display.elements, "ui.tool.browser.elements", i18n), truncated(display, i18n)]
    case "screenshot":
      return [target ?? i18n.t(input.fullPage ? "ui.tool.browser.fullPage" : "ui.tool.browser.viewport")]
    case "wait":
      return [input.condition, quote(input.text)]
    case "evaluate":
      return [target, input.script?.split("\n", 1)[0]?.slice(0, 120)]
    case "dialog":
      return [input.action, display.page]
    case "preview":
      return [input.path]
    case "frames":
      return [display.page, count(display.frames, "ui.tool.browser.frames", i18n)]
    case "console":
      return [display.page, count(display.messages, "ui.tool.browser.messages", i18n)]
    case "network.list":
      return [display.page, count(display.requests, "ui.tool.browser.requests", i18n)]
    case "network.get":
      return [display.request ?? display.page]
    case "files.list":
      return [display.page, count(display.files, "ui.tool.browser.files", i18n)]
    case "files.upload":
    case "files.drop":
      return [target, input.paths?.map((path) => path.split(/[\\/]/).pop()).join(", ")]
    default:
      // Tab calls such as focus, close, stop and the performance captures name the tab they worked on.
      return [display.page]
  }
}

function quote(value: string | undefined) {
  if (value === undefined) return undefined

  const line = value.replace(/\s+/g, " ")

  return `"${line.length > 120 ? `${line.slice(0, 120)}…` : line}"`
}

function count(
  value: number | undefined,
  key:
    | "ui.tool.browser.elements"
    | "ui.tool.browser.matches"
    | "ui.tool.browser.tabs"
    | "ui.tool.browser.frames"
    | "ui.tool.browser.messages"
    | "ui.tool.browser.requests"
    | "ui.tool.browser.files",
  i18n: Pick<UiI18n, "plural">,
) {
  return value === undefined ? undefined : i18n.plural(key, value)
}

function truncated(display: typeof Fields.Type, i18n: Pick<UiI18n, "t">) {
  return display.truncated ? i18n.t("ui.tool.browser.truncated") : undefined
}

function clickKind(input: typeof Fields.Type, i18n: Pick<UiI18n, "t">) {
  if (input.count === 2) return i18n.t("ui.tool.browser.click.double")

  if (input.button === "right") return i18n.t("ui.tool.browser.click.right")

  if (input.button === "middle") return i18n.t("ui.tool.browser.click.middle")

  return undefined
}

function scrollDirection(input: typeof Fields.Type, i18n: Pick<UiI18n, "t">) {
  const x = input.deltaX ?? 0
  const y = input.deltaY ?? 0

  if (Math.abs(x) > Math.abs(y)) return i18n.t(x < 0 ? "ui.tool.browser.scroll.left" : "ui.tool.browser.scroll.right")

  return i18n.t(y < 0 ? "ui.tool.browser.scroll.up" : "ui.tool.browser.scroll.down")
}
