import { SessionBrowser } from "@opencode-ai/schema/session-browser"
import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Browser } from "@/browser"
import { isImageAttachment } from "@/util/media"
import NAVIGATE_DESCRIPTION from "./browser-navigate.txt"
import READ_DESCRIPTION from "./browser-read.txt"
import { Tool } from "./tool"
import { convertHTMLToMarkdown, DEFAULT_TIMEOUT, extractTextFromHTML, fetchUrlResponse, MAX_TIMEOUT } from "./webfetch"

const Timeout = Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_TIMEOUT / 1000))
  .pipe(Schema.optional)
  .annotate({ description: `Optional timeout in seconds (max ${MAX_TIMEOUT / 1000}, default ${DEFAULT_TIMEOUT / 1000})` })

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
    description: "The format to return the page content in (markdown, text, or html). Defaults to markdown.",
    default: "markdown",
  }).pipe(Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
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
