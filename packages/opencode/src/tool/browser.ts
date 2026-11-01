import { SessionBrowser } from "@opencode-ai/schema/session-browser"
import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Browser } from "@/browser"
import { isImageAttachment } from "@/util/media"
import ACT_DESCRIPTION from "./browser-act.txt"
import NAVIGATE_DESCRIPTION from "./browser-navigate.txt"
import READ_DESCRIPTION from "./browser-read.txt"
import SCREENSHOT_DESCRIPTION from "./browser-screenshot.txt"
import { Tool } from "./tool"
import { convertHTMLToMarkdown, DEFAULT_TIMEOUT, extractTextFromHTML, fetchUrlResponse, MAX_TIMEOUT } from "./webfetch"

const Timeout = Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_TIMEOUT / 1000))
  .pipe(Schema.optional)
  .annotate({ description: `Optional timeout in seconds (max ${MAX_TIMEOUT / 1000}, default ${DEFAULT_TIMEOUT / 1000})` })

const MAX_ACT_TEXT = 10_000

const TabID = Schema.optional(Schema.String).annotate({
  description: "Optional ID of the browser tab to target (from the open tabs list).",
})

export const NavigateParameters = Schema.Struct({
  action: SessionBrowser.NavigateAction.annotate({
    description: "goto (requires url), back, forward, or reload. Defaults to goto.",
    default: "goto",
  }).pipe(Schema.withDecodingDefault(Effect.succeed("goto" as const))),
  url: Schema.optional(Schema.String).annotate({ description: "HTTP/HTTPS URL to load. Required for goto." }),
  tabID: TabID,
  newTab: Schema.optional(Schema.Boolean).annotate({ description: "Open the URL in a new tab (goto only)." }),
  timeout: Timeout,
})

export const ReadParameters = Schema.Struct({
  tabID: TabID,
  format: SessionBrowser.ReadFormat.annotate({
    description:
      "The format to return the page content in: markdown, text, html, or interactive (a list of actionable elements with refs like [e12]). Defaults to markdown.",
    default: "markdown",
  }).pipe(Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Timeout,
})

export const ScreenshotParameters = Schema.Struct({
  tabID: TabID,
  timeout: Timeout,
})

export const ActParameters = Schema.Struct({
  action: SessionBrowser.ActAction.annotate({
    description:
      "click, hover, type (append text), fill (replace the field's text), select (choose a <select> option), press (a key or chord), or scroll.",
  }),
  ref: Schema.optional(Schema.String.check(Schema.isPattern(/^e\d{1,5}$/))).annotate({
    description: 'Element ref from browser_read with format "interactive", e.g. e12. Required for click, hover, fill and select.',
  }),
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(MAX_ACT_TEXT))).annotate({
    description: "Text to insert. Required for type.",
  }),
  value: Schema.optional(Schema.String.check(Schema.isMaxLength(MAX_ACT_TEXT))).annotate({
    description: "New field text for fill (empty clears it), or the option value or label for select.",
  }),
  key: Schema.optional(Schema.String.check(Schema.isMaxLength(32))).annotate({
    description: "Key or chord for press, e.g. Enter, Tab, Escape, ArrowDown, Control+a. Required for press.",
  }),
  direction: Schema.optional(SessionBrowser.ScrollDirection).annotate({
    description: "up, down, left or right. Required for scroll; scrolls about 80% of the viewport.",
  }),
  tabID: TabID,
  timeout: Timeout,
})

export type NavigateMetadata = {
  action: SessionBrowser.NavigateAction
  url: string
  title?: string
  tabID?: string
}

export type ReadMetadata = {
  url: string
  title?: string
  tabID?: string
  format: SessionBrowser.ReadFormat
  source: "live" | "fetched"
}

export type ActMetadata = {
  action: SessionBrowser.ActAction
  ref?: string
  url: string
  title?: string
  tabID?: string
  navigated: boolean
}

export type ScreenshotMetadata = {
  url: string
  title?: string
  tabID?: string
}

export const BrowserNavigateTool = Tool.define(
  "browser_navigate",
  Effect.gen(function* () {
    const browser = yield* Browser.Service

    return {
      description: NAVIGATE_DESCRIPTION,
      parameters: NavigateParameters,
      execute: (params: Schema.Schema.Type<typeof NavigateParameters>, ctx: Tool.Context<NavigateMetadata>) =>
        Effect.gen(function* () {
          if (params.action === "goto" && !params.url) throw new Error("url is required for goto")
          const info = yield* browser.get(ctx.sessionID)
          const tab = findTab(info, params.tabID)
          const target = params.action === "goto" ? params.url : tab?.url
          if (!target) throw new Error(`No page is open in the session browser to ${params.action}.${tabsHint(info)}`)
          const origin = requireHttpOrigin(target)

          yield* ctx.ask({
            permission: "browser",
            patterns: [target],
            always: [`${origin}/*`],
            metadata: { action: params.action, url: target, tabID: params.tabID },
          })

          const result = yield* browser
            .command(
              ctx.sessionID,
              {
                type: "navigate",
                action: params.action,
                ...(params.action === "goto" ? { url: target, newTab: params.newTab } : {}),
              },
              { tabID: params.tabID ?? (params.action === "goto" ? undefined : tab?.tabID), timeoutMs: timeoutMs(params.timeout) },
            )
            .pipe(Effect.mapError((error) => new Error(error.message)))

          const url = result.url ?? target
          const tabs = (yield* browser.get(ctx.sessionID)).tabs.map((item) =>
            item.tabID === result.tabID ? { ...item, url, title: result.title } : item,
          )
          return {
            title: result.title || url,
            output: [
              `URL: ${url}`,
              ...(result.title ? [`Title: ${result.title}`] : []),
              ...(result.tabID ? [`Tab: ${result.tabID}`] : []),
              ...tabLines(tabs, result.tabID),
            ].join("\n"),
            metadata: { action: params.action, url, title: result.title, tabID: result.tabID },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const BrowserReadTool = Tool.define(
  "browser_read",
  Effect.gen(function* () {
    const httpOk = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const browser = yield* Browser.Service

    return {
      description: READ_DESCRIPTION,
      parameters: ReadParameters,
      execute: (params: Schema.Schema.Type<typeof ReadParameters>, ctx: Tool.Context<ReadMetadata>) =>
        Effect.gen(function* () {
          const info = yield* browser.get(ctx.sessionID)
          const tab = findTab(info, params.tabID)
          if (!tab) {
            throw new Error(
              params.tabID
                ? `Browser tab "${params.tabID}" was not found.${tabsHint(info)}`
                : "No page is open in the session browser. Use browser_navigate to load a page first.",
            )
          }
          const origin = requireHttpOrigin(tab.url)

          yield* ctx.ask({
            permission: "browser",
            patterns: [tab.url],
            always: [`${origin}/*`],
            metadata: { url: tab.url, tabID: tab.tabID, format: params.format },
          })

          const timeout = timeoutMs(params.timeout)

          // Refs live in the panel, so there is no server-side fetch fallback for this format.
          if (params.format === "interactive") {
            if (!info.attached) throw new Error("Interactive reads need the desktop Browser panel to be open.")
            const result = yield* browser
              .command(ctx.sessionID, { type: "read", format: "interactive" }, { tabID: tab.tabID, timeoutMs: timeout })
              .pipe(Effect.mapError((error) => new Error(`Interactive read failed: ${error.message}`)))
            return readOutput({
              url: result.url ?? tab.url,
              title: result.title ?? tab.title,
              tabID: tab.tabID,
              format: params.format,
              source: "live",
              sourceLabel: "live",
              body: result.text ?? "",
            })
          }

          const live = info.attached
            ? yield* browser
                .command(ctx.sessionID, { type: "read", format: params.format }, { tabID: tab.tabID, timeoutMs: timeout })
                .pipe(Effect.result)
            : undefined

          if (live?._tag === "Success") {
            const result = live.success
            const url = result.url ?? tab.url
            return readOutput({
              url,
              title: result.title,
              tabID: tab.tabID,
              format: params.format,
              source: "live",
              sourceLabel: "live",
              body: params.format === "markdown" ? convertHTMLToMarkdown(result.html ?? "") : ((params.format === "html" ? result.html : result.text) ?? ""),
            })
          }

          const fetched = yield* fetchUrlResponse(httpOk, tab.url, params.format, timeout)
          if (isImageAttachment(fetched.mime)) throw new Error(`${tab.url} is an image, not a page; use webfetch to view it`)
          const content = new TextDecoder().decode(fetched.arrayBuffer)
          const isHtml = fetched.contentType.includes("text/html")
          return readOutput({
            url: tab.url,
            title: tab.title,
            tabID: tab.tabID,
            format: params.format,
            source: "fetched",
            sourceLabel: `fetched by server (${live ? `live read failed: ${live.failure.message}` : "session browser not attached"})`,
            body: !isHtml || params.format === "html" ? content : params.format === "markdown" ? convertHTMLToMarkdown(content) : extractTextFromHTML(content),
          })
        }).pipe(Effect.orDie),
    }
  }),
)

export const BrowserScreenshotTool = Tool.define(
  "browser_screenshot",
  Effect.gen(function* () {
    const browser = yield* Browser.Service

    return {
      description: SCREENSHOT_DESCRIPTION,
      parameters: ScreenshotParameters,
      execute: (params: Schema.Schema.Type<typeof ScreenshotParameters>, ctx: Tool.Context<ScreenshotMetadata>) =>
        Effect.gen(function* () {
          const info = yield* browser.get(ctx.sessionID)
          const tab = findTab(info, params.tabID)
          if (!tab) {
            throw new Error(
              params.tabID
                ? `Browser tab "${params.tabID}" was not found.${tabsHint(info)}`
                : "No page is open in the session browser. Use browser_navigate to load a page first.",
            )
          }
          const origin = requireHttpOrigin(tab.url)

          yield* ctx.ask({
            permission: "browser",
            patterns: [tab.url],
            always: [`${origin}/*`],
            metadata: { url: tab.url, tabID: tab.tabID },
          })

          const result = yield* browser
            .command(ctx.sessionID, { type: "screenshot" }, { tabID: tab.tabID, timeoutMs: timeoutMs(params.timeout) })
            .pipe(Effect.mapError((error) => new Error(error.message)))

          if (!result.image) throw new Error("Browser screenshot did not return an image")
          const url = result.url ?? tab.url
          const title = result.title ?? tab.title
          const tabID = result.tabID ?? tab.tabID
          const mime = result.mime ?? "image/jpeg"
          return {
            title: title || url,
            output: [
              `URL: ${url}`,
              ...(title ? [`Title: ${title}`] : []),
              ...(tabID ? [`Tab: ${tabID}`] : []),
            ].join("\n"),
            metadata: { url, title, tabID },
            attachments: [
              {
                type: "file" as const,
                mime,
                url: `data:${mime};base64,${result.image}`,
              },
            ],
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const BrowserActTool = Tool.define(
  "browser_act",
  Effect.gen(function* () {
    const browser = yield* Browser.Service

    return {
      description: ACT_DESCRIPTION,
      parameters: ActParameters,
      execute: (params: Schema.Schema.Type<typeof ActParameters>, ctx: Tool.Context<ActMetadata>) =>
        Effect.gen(function* () {
          requireActInput(params)
          const info = yield* browser.get(ctx.sessionID)
          const tab = findTab(info, params.tabID)
          if (!tab) {
            throw new Error(
              params.tabID
                ? `Browser tab "${params.tabID}" was not found.${tabsHint(info)}`
                : "No page is open in the session browser. Use browser_navigate to load a page first.",
            )
          }
          const origin = requireHttpOrigin(tab.url)

          yield* ctx.ask({
            permission: "browser_act",
            patterns: [tab.url],
            always: [`${origin}/*`],
            metadata: { url: tab.url, tabID: tab.tabID, action: params.action, ref: params.ref },
          })

          const result = yield* browser
            .command(
              ctx.sessionID,
              {
                type: "act",
                action: params.action,
                ...(params.ref === undefined ? {} : { ref: params.ref }),
                ...(params.text === undefined ? {} : { text: params.text }),
                ...(params.value === undefined ? {} : { value: params.value }),
                ...(params.key === undefined ? {} : { key: params.key }),
                ...(params.direction === undefined ? {} : { direction: params.direction }),
              },
              { tabID: tab.tabID, timeoutMs: timeoutMs(params.timeout) },
            )
            .pipe(Effect.mapError((error) => new Error(`Browser action failed: ${error.message}`)))

          const url = result.url ?? tab.url
          const title = result.title ?? tab.title
          const tabID = result.tabID ?? tab.tabID
          const navigated = url !== tab.url
          return {
            title: `${params.action}${params.ref ? ` ${params.ref}` : ""}`,
            output: [
              `Action: ${params.action}${params.ref ? ` ${params.ref}` : ""}`,
              `URL: ${url}`,
              ...(title ? [`Title: ${title}`] : []),
              ...(tabID ? [`Tab: ${tabID}`] : []),
              ...(result.text ? [result.text] : []),
              ...(navigated
                ? [
                    `Page changed from ${tab.url} to ${url}. Earlier refs are no longer valid; run browser_read with format "interactive" for fresh refs.`,
                  ]
                : []),
            ].join("\n"),
            metadata: { action: params.action, ref: params.ref, url, title, tabID, navigated },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// Each action needs different inputs; failing here keeps a malformed call from reaching the permission prompt.
function requireActInput(params: Schema.Schema.Type<typeof ActParameters>) {
  const missing =
    params.action === "type"
      ? params.text === undefined && "text"
      : params.action === "press"
        ? !params.key && "key"
        : params.action === "scroll"
          ? !params.direction && "direction"
          : params.action === "fill" || params.action === "select"
            ? (!params.ref && "ref") || (params.value === undefined && "value")
            : !params.ref && "ref"
  if (missing) throw new Error(`browser_act ${params.action} requires "${missing}"`)
}

function readOutput(input: ReadMetadata & { sourceLabel: string; body: string }) {
  return {
    title: input.title || input.url,
    output: [
      `URL: ${input.url}`,
      ...(input.title ? [`Title: ${input.title}`] : []),
      ...(input.tabID ? [`Tab: ${input.tabID}`] : []),
      `source: ${input.sourceLabel}`,
      "",
      input.body,
    ].join("\n"),
    metadata: {
      url: input.url,
      title: input.title,
      tabID: input.tabID,
      format: input.format,
      source: input.source,
    } satisfies ReadMetadata,
  }
}

function findTab(info: Browser.Info, tabID: string | undefined) {
  return info.tabs.find((tab) => tab.tabID === (tabID ?? info.activeTabID))
}

function requireHttpOrigin(url: string) {
  const parsed = URL.parse(url)
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new Error("URL must start with http:// or https://")
  }
  return parsed.origin
}

function timeoutMs(seconds: number | undefined) {
  return Math.min((seconds ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)
}

function tabLines(tabs: ReadonlyArray<Browser.Tab>, activeTabID: string | undefined) {
  if (tabs.length === 0) return []
  return [
    "Open tabs:",
    ...tabs.map(
      (tab) =>
        `- [${tab.tabID}] ${tab.title ? `${tab.title} — ` : ""}${tab.url}${tab.tabID === activeTabID ? " (active)" : ""}`,
    ),
  ]
}

function tabsHint(info: Browser.Info) {
  return info.tabs.length > 0 ? `\n${tabLines(info.tabs, info.activeTabID).join("\n")}` : ""
}
