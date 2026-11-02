export * as SessionBrowser from "./session-browser"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { SessionID } from "./session-id"

export const Tab = Schema.Struct({
  tabID: Schema.String,
  url: Schema.String,
  title: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionBrowserTab" })
export type Tab = Schema.Schema.Type<typeof Tab>

export const Info = Schema.Struct({
  attached: Schema.Boolean,
  activeTabID: Schema.optional(Schema.String),
  tabs: Schema.Array(Tab),
}).annotate({ identifier: "SessionBrowserInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export const StateInput = Schema.Struct({
  activeTabID: Schema.optional(Schema.String),
  tabs: Schema.Array(Tab),
}).annotate({ identifier: "SessionBrowserStateInput" })
export type StateInput = Schema.Schema.Type<typeof StateInput>

export const AttachInput = Schema.Struct({
  clientID: Schema.String,
  attached: Schema.Boolean,
}).annotate({ identifier: "SessionBrowserAttachInput" })
export type AttachInput = Schema.Schema.Type<typeof AttachInput>

export const ReadFormat = Schema.Literals(["markdown", "text", "html", "interactive"])
export type ReadFormat = Schema.Schema.Type<typeof ReadFormat>

export const NavigateAction = Schema.Literals(["goto", "back", "forward", "reload"])
export type NavigateAction = Schema.Schema.Type<typeof NavigateAction>

export const NavigateCommand = Schema.Struct({
  type: Schema.Literal("navigate"),
  action: NavigateAction,
  url: Schema.optional(Schema.String),
  newTab: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "SessionBrowserNavigateCommand" })

export const ReadCommand = Schema.Struct({
  type: Schema.Literal("read"),
  format: ReadFormat,
}).annotate({ identifier: "SessionBrowserReadCommand" })

export const ScreenshotCommand = Schema.Struct({
  type: Schema.Literal("screenshot"),
  ref: Schema.optional(Schema.String),
  fullPage: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "SessionBrowserScreenshotCommand" })

export const ActAction = Schema.Literals(["click", "type", "fill", "select", "press", "scroll", "hover"])
export type ActAction = Schema.Schema.Type<typeof ActAction>

export const ScrollDirection = Schema.Literals(["up", "down", "left", "right"])
export type ScrollDirection = Schema.Schema.Type<typeof ScrollDirection>

export const ActCommand = Schema.Struct({
  type: Schema.Literal("act"),
  action: ActAction,
  ref: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  direction: Schema.optional(ScrollDirection),
}).annotate({ identifier: "SessionBrowserActCommand" })

export const Command = Schema.Union([NavigateCommand, ReadCommand, ScreenshotCommand, ActCommand]).annotate({
  identifier: "SessionBrowserCommand",
})
export type Command = Schema.Schema.Type<typeof Command>

export const InteractiveElement = Schema.Struct({
  ref: Schema.String,
  role: Schema.String,
  name: Schema.String,
}).annotate({ identifier: "SessionBrowserInteractiveElement" })
export type InteractiveElement = Schema.Schema.Type<typeof InteractiveElement>

// One flat result shape for every command keeps the reply route simple; `html`/`text` are only set by reads
// (and `text` by actions and screenshots that report a detail), `image`/`mime` are only set by screenshots,
// and `elements` is only set by interactive reads.
export const ResultInput = Schema.Struct({
  requestID: Schema.String,
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
  tabID: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  html: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  image: Schema.optional(Schema.String),
  mime: Schema.optional(Schema.String),
  elements: Schema.optional(Schema.Array(InteractiveElement)),
}).annotate({ identifier: "SessionBrowserResultInput" })
export type ResultInput = Schema.Schema.Type<typeof ResultInput>

export const CommandEvent = define({
  type: "session.browser.command",
  schema: {
    sessionID: SessionID,
    requestID: Schema.String,
    tabID: Schema.optional(Schema.String),
    timeoutMs: Schema.Number,
    command: Command,
  },
})

export const Event = {
  Command: CommandEvent,
  Definitions: inventory(CommandEvent),
}
