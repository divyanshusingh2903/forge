import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Cause, Effect, Exit, Layer, Queue } from "effect"
import { Agent } from "@/agent/agent"
import { Browser } from "@/browser"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { MessageID, SessionID } from "@/session/schema"
import {
  BrowserActTool,
  BrowserNavigateTool,
  BrowserReadTool,
  BrowserScreenshotTool,
  type ActMetadata,
  type NavigateMetadata,
  type ReadMetadata,
  type ScreenshotMetadata,
} from "@/tool/browser"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      httpClient,
      Browser.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      FSUtil.node,
      Truncate.node,
      Agent.node,
      InstanceStore.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

type Ask = Omit<PermissionV1.Request, "id" | "sessionID" | "tool">

const makeCtx = <M extends Record<string, unknown>>(sessionID: SessionID, asks?: Ask[]): Tool.Context<M> => ({
  sessionID,
  messageID: MessageID.make("msg_browser_test"),
  callID: "call_browser_test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: (req) =>
    Effect.sync(() => {
      asks?.push(req)
    }),
})

// Stands in for the desktop panel: attaches and answers every command for the session with `reply`.
const fakePanel = (sessionID: SessionID, reply: (command: Browser.Command, tabID?: string) => Omit<Browser.ResultInput, "requestID">) =>
  Effect.gen(function* () {
    const browser = yield* Browser.Service
    const events = yield* EventV2Bridge.Service
    const commands = yield* Queue.unbounded<{ requestID: string; tabID?: string; command: Browser.Command }>()
    const unsub = yield* events.listen((event) =>
      Effect.sync(() => {
        if (event.type !== Browser.Event.Command.type) return
        const data = event.data as { sessionID: SessionID; requestID: string; tabID?: string; command: Browser.Command }
        if (data.sessionID === sessionID) Queue.offerUnsafe(commands, data)
      }),
    )
    yield* Effect.addFinalizer(() => unsub)
    yield* browser.attach(sessionID, "test-panel")
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const next = yield* Queue.take(commands)
          yield* browser.resolve(sessionID, { requestID: next.requestID, ...reply(next.command, next.tabID) })
        }),
      ),
    )
  })

const servePage = Effect.acquireRelease(
  Effect.sync(() =>
    Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          "<!doctype html><html><head><title>Local Test Page</title></head><body><h1>Heading One</h1><p>Paragraph body.</p></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        )
      },
    }),
  ),
  (server) => Effect.sync(() => server.stop(true)),
)

describe("tool.browser_read", () => {
  it.instance("falls back to a server fetch of the active tab when no panel is attached", () =>
    Effect.gen(function* () {
      const server = yield* servePage
      const browser = yield* Browser.Service
      const url = `http://127.0.0.1:${server.port}/docs`
      const asks: Ask[] = []
      const sessionID = SessionID.make("ses_tool_browser_fetch")
      const ctx = makeCtx<ReadMetadata>(sessionID, asks)
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url, title: "Docs" }] })
      const tool = yield* (yield* BrowserReadTool).init()

      const markdown = yield* tool.execute({ format: "markdown" }, ctx)
      expect(markdown.metadata.source).toBe("fetched")
      expect(markdown.metadata.url).toBe(url)
      expect(markdown.output).toContain("source: fetched by server (session browser not attached)")
      expect(markdown.output).toContain("# Heading One")
      expect(asks[0]?.permission).toBe("browser")
      expect(asks[0]?.patterns).toEqual([url])
      expect(asks[0]?.always).toEqual([`http://127.0.0.1:${server.port}/*`])

      const text = yield* tool.execute({ format: "text" }, ctx)
      expect(text.output).toContain("Heading One")
      expect(text.output).not.toContain("<h1>")

      const html = yield* tool.execute({ format: "html" }, ctx)
      expect(html.output).toContain("<h1>Heading One</h1>")

      // A server fetch must not change the panel's tab state.
      expect((yield* browser.get(sessionID)).tabs).toEqual([{ tabID: "tab-1", url, title: "Docs" }])
    }),
  )

  it.instance("reads a tab live from the attached panel", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_live")
      const ctx = makeCtx<ReadMetadata>(sessionID)
      yield* browser.setState(sessionID, {
        activeTabID: "tab-other",
        tabs: [
          { tabID: "tab-work", url: "https://staging.example.com/checkout", title: "Checkout" },
          { tabID: "tab-other", url: "https://example.org/random" },
        ],
      })
      yield* fakePanel(sessionID, (command, tabID) => ({
        ok: true,
        tabID,
        url: "https://staging.example.com/checkout",
        title: "Checkout",
        ...(command.type === "read" && command.format === "text"
          ? { text: "Checkout Step 2" }
          : { html: "<main><h2>Checkout Step 2</h2></main>" }),
      }))
      const tool = yield* (yield* BrowserReadTool).init()

      const result = yield* tool.execute({ tabID: "tab-work", format: "markdown" }, ctx)
      expect(result.metadata).toMatchObject({
        url: "https://staging.example.com/checkout",
        title: "Checkout",
        tabID: "tab-work",
        format: "markdown",
        source: "live",
      })
      expect(result.output).toContain("source: live")
      expect(result.output).toContain("## Checkout Step 2")

      const text = yield* tool.execute({ tabID: "tab-work", format: "text" }, ctx)
      expect(text.output).toContain("Checkout Step 2")
    }),
  )

  it.instance("reads interactive elements live from the attached panel", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_interactive")
      const ctx = makeCtx<ReadMetadata>(sessionID)
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "https://example.com/form" }] })
      const formats: string[] = []
      yield* fakePanel(sessionID, (command, tabID) => {
        if (command.type === "read") formats.push(command.format)
        return { ok: true, tabID, url: "https://example.com/form", title: "Form", text: '[e1] button "Submit"' }
      })
      const tool = yield* (yield* BrowserReadTool).init()

      const result = yield* tool.execute({ format: "interactive" }, ctx)
      expect(formats).toEqual(["interactive"])
      expect(result.metadata).toMatchObject({ format: "interactive", source: "live", tabID: "tab-1" })
      expect(result.output).toContain("source: live")
      expect(result.output).toContain('[e1] button "Submit"')
    }),
  )

  it.instance("counts the elements of an interactive read and leaves other formats without a count", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_interactive_count")
      const ctx = makeCtx<ReadMetadata>(sessionID)
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "https://example.com/form" }] })
      yield* fakePanel(sessionID, (command, tabID) => ({
        ok: true,
        tabID,
        url: "https://example.com/form",
        text: command.type === "read" && command.format === "interactive" ? '[e1] button "Submit"\n[e2] link "Docs"' : "# Form",
        ...(command.type === "read" && command.format === "interactive"
          ? {
              elements: [
                { ref: "e1", role: "button", name: "Submit" },
                { ref: "e2", role: "link", name: "Docs" },
              ],
            }
          : {}),
      }))
      const tool = yield* (yield* BrowserReadTool).init()

      const interactive = yield* tool.execute({ format: "interactive" }, ctx)
      expect(interactive.metadata.elements).toBe(2)

      const markdown = yield* tool.execute({ format: "markdown" }, ctx)
      expect(markdown.metadata).not.toHaveProperty("elements")
    }),
  )

  it.instance("fails an interactive read without falling back to a server fetch", () =>
    Effect.gen(function* () {
      const server = yield* servePage
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_interactive_detached")
      const ctx = makeCtx<ReadMetadata>(sessionID)
      yield* browser.setState(sessionID, {
        activeTabID: "tab-1",
        tabs: [{ tabID: "tab-1", url: `http://127.0.0.1:${server.port}/` }],
      })
      const tool = yield* (yield* BrowserReadTool).init()

      const exit = yield* Effect.exit(tool.execute({ format: "interactive" }, ctx))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("Interactive reads need the desktop Browser panel")
    }),
  )

  it.instance("reports a failed interactive read instead of falling back", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_interactive_failed")
      const ctx = makeCtx<ReadMetadata>(sessionID)
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "https://example.com" }] })
      yield* fakePanel(sessionID, () => ({ ok: false, error: "Accessibility.getFullAXTree failed: boom" }))
      const tool = yield* (yield* BrowserReadTool).init()

      const exit = yield* Effect.exit(tool.execute({ format: "interactive" }, ctx))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("Interactive read failed")
    }),
  )

  it.instance("fails clearly when no page is open or the tab is unknown", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_empty")
      const ctx = makeCtx<ReadMetadata>(sessionID)
      const tool = yield* (yield* BrowserReadTool).init()

      expect(Exit.isFailure(yield* Effect.exit(tool.execute({ format: "markdown" }, ctx)))).toBe(true)

      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "https://example.com" }] })
      expect(Exit.isFailure(yield* Effect.exit(tool.execute({ tabID: "missing", format: "markdown" }, ctx)))).toBe(true)
    }),
  )
})

describe("tool.browser_navigate", () => {
  it.instance("navigates through the panel and reports the tab without page content", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const asks: Ask[] = []
      const sessionID = SessionID.make("ses_tool_browser_navigate")
      const ctx = makeCtx<NavigateMetadata>(sessionID, asks)
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "https://example.org/" }] })
      const sent: Browser.Command[] = []
      yield* fakePanel(sessionID, (command) => {
        sent.push(command)
        return { ok: true, tabID: "tab-2", url: "http://localhost:3000/app", title: "Dev App" }
      })
      const tool = yield* (yield* BrowserNavigateTool).init()

      const result = yield* tool.execute({ action: "goto", url: "http://localhost:3000/app", newTab: true }, ctx)
      expect(sent).toEqual([{ type: "navigate", action: "goto", url: "http://localhost:3000/app", newTab: true }])
      expect(result.metadata).toMatchObject({ action: "goto", url: "http://localhost:3000/app", title: "Dev App", tabID: "tab-2" })
      expect(result.output).toContain("Tab: tab-2")
      expect(result.output).toContain("[tab-1] https://example.org/")
      expect(asks[0]?.patterns).toEqual(["http://localhost:3000/app"])
      expect(asks[0]?.always).toEqual(["http://localhost:3000/*"])
    }),
  )

  it.instance("rejects goto without a url and history actions without an open page", () =>
    Effect.gen(function* () {
      const sessionID = SessionID.make("ses_tool_browser_navigate_invalid")
      const ctx = makeCtx<NavigateMetadata>(sessionID)
      const tool = yield* (yield* BrowserNavigateTool).init()

      expect(Exit.isFailure(yield* Effect.exit(tool.execute({ action: "goto" }, ctx)))).toBe(true)
      expect(Exit.isFailure(yield* Effect.exit(tool.execute({ action: "back" }, ctx)))).toBe(true)
      expect(Exit.isFailure(yield* Effect.exit(tool.execute({ action: "goto", url: "file:///etc/passwd" }, ctx)))).toBe(true)
    }),
  )
})

describe("tool.browser_screenshot", () => {
  it.instance("captures a tab screenshot from the panel and returns an image attachment", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const asks: Ask[] = []
      const sessionID = SessionID.make("ses_tool_browser_screenshot")
      const ctx = makeCtx<ScreenshotMetadata>(sessionID, asks)
      yield* browser.setState(sessionID, {
        activeTabID: "tab-1",
        tabs: [{ tabID: "tab-1", url: "http://localhost:3000/dashboard", title: "Dashboard" }],
      })
      const sent: Browser.Command[] = []
      yield* fakePanel(sessionID, (command, tabID) => {
        sent.push(command)
        return {
          ok: true,
          tabID,
          url: "http://localhost:3000/dashboard",
          title: "Dashboard",
          image: "AAAA",
          mime: "image/jpeg",
        }
      })
      const tool = yield* (yield* BrowserScreenshotTool).init()

      const result = yield* tool.execute({}, ctx)
      expect(sent).toEqual([{ type: "screenshot" }])
      expect(result.metadata).toMatchObject({
        url: "http://localhost:3000/dashboard",
        title: "Dashboard",
        tabID: "tab-1",
      })
      expect(result.output).toContain("URL: http://localhost:3000/dashboard")
      expect(result.output).toContain("Title: Dashboard")
      expect(result.output).toContain("Tab: tab-1")
      expect(result.attachments).toEqual([
        {
          type: "file",
          mime: "image/jpeg",
          url: "data:image/jpeg;base64,AAAA",
        },
      ])
      expect(asks[0]?.permission).toBe("browser")
      expect(asks[0]?.patterns).toEqual(["http://localhost:3000/dashboard"])
      expect(asks[0]?.always).toEqual(["http://localhost:3000/*"])
    }),
  )

  it.instance("captures one element when given a ref", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_screenshot_ref")
      const ctx = makeCtx<ScreenshotMetadata>(sessionID)
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "http://localhost:3000/" }] })
      const sent: Browser.Command[] = []
      yield* fakePanel(sessionID, (command, tabID) => {
        sent.push(command)
        return { ok: true, tabID, url: "http://localhost:3000/", image: "AAAA", mime: "image/jpeg" }
      })
      const tool = yield* (yield* BrowserScreenshotTool).init()

      const result = yield* tool.execute({ ref: "e3" }, ctx)
      expect(sent).toEqual([{ type: "screenshot", ref: "e3" }])
      expect(result.output).toContain("Element: e3")
      expect(result.metadata).toMatchObject({ ref: "e3" })
      expect(result.attachments).toHaveLength(1)
    }),
  )

  it.instance("names the element it captured when the ref came from an interactive read", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_screenshot_labels")
      const url = "http://localhost:3000/form"
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url }] })
      yield* browser.setElements(sessionID, "tab-1", [{ ref: "e1", role: "button", name: "Submit order" }])
      yield* fakePanel(sessionID, (_command, tabID) => ({ ok: true, tabID, url, image: "AAAA", mime: "image/jpeg" }))
      const tool = yield* (yield* BrowserScreenshotTool).init()
      const ctx = makeCtx<ScreenshotMetadata>(sessionID)

      const known = yield* tool.execute({ ref: "e1" }, ctx)
      expect(known.output).toContain('Element: e1 (button "Submit order")')
      expect(known.metadata).toMatchObject({ ref: "e1", role: "button", name: "Submit order" })

      const unknown = yield* tool.execute({ ref: "e9" }, ctx)
      expect(unknown.output).toContain("Element: e9")
      expect(unknown.output).not.toContain("Element: e9 (")
      expect(unknown.metadata.role).toBeUndefined()
      expect(unknown.metadata.name).toBeUndefined()
    }),
  )

  it.instance("captures the full page and passes on the panel's truncation note", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_screenshot_full")
      const ctx = makeCtx<ScreenshotMetadata>(sessionID)
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "http://localhost:3000/" }] })
      const sent: Browser.Command[] = []
      yield* fakePanel(sessionID, (command, tabID) => {
        sent.push(command)
        return {
          ok: true,
          tabID,
          url: "http://localhost:3000/",
          image: "AAAA",
          mime: "image/jpeg",
          text: "Captured the top 4000px of a 9500px page",
        }
      })
      const tool = yield* (yield* BrowserScreenshotTool).init()

      const result = yield* tool.execute({ fullPage: true }, ctx)
      expect(sent).toEqual([{ type: "screenshot", fullPage: true }])
      expect(result.output).toContain("Full page")
      expect(result.output).toContain("Captured the top 4000px of a 9500px page")
      expect(result.metadata).toMatchObject({ fullPage: true })
    }),
  )

  it.instance("rejects ref together with fullPage before asking permission or contacting the panel", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const asks: Ask[] = []
      const sessionID = SessionID.make("ses_tool_browser_screenshot_both")
      const ctx = makeCtx<ScreenshotMetadata>(sessionID, asks)
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "http://localhost:3000/" }] })
      const sent: Browser.Command[] = []
      yield* fakePanel(sessionID, (command, tabID) => {
        sent.push(command)
        return { ok: true, tabID, image: "AAAA" }
      })
      const tool = yield* (yield* BrowserScreenshotTool).init()

      const exit = yield* Effect.exit(tool.execute({ ref: "e1", fullPage: true }, ctx))
      expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("ref or fullPage, not both")
      expect(asks).toHaveLength(0)
      expect(sent).toHaveLength(0)
    }),
  )

  it.instance("fails clearly when no page is open or no panel is attached", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_screenshot_fail")
      const ctx = makeCtx<ScreenshotMetadata>(sessionID)
      const tool = yield* (yield* BrowserScreenshotTool).init()

      expect(Exit.isFailure(yield* Effect.exit(tool.execute({}, ctx)))).toBe(true)

      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "https://example.com" }] })
      expect(Exit.isFailure(yield* Effect.exit(tool.execute({ tabID: "missing" }, ctx)))).toBe(true)
      expect(Exit.isFailure(yield* Effect.exit(tool.execute({ timeout: 0.05 }, ctx)))).toBe(true)
    }),
  )
})

describe("tool.browser_act", () => {
  it.instance("sends the action to the panel under the browser_act permission", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const asks: Ask[] = []
      const sessionID = SessionID.make("ses_tool_browser_act")
      const ctx = makeCtx<ActMetadata>(sessionID, asks)
      yield* browser.setState(sessionID, {
        activeTabID: "tab-1",
        tabs: [{ tabID: "tab-1", url: "http://localhost:3000/form", title: "Form" }],
      })
      const sent: Browser.Command[] = []
      yield* fakePanel(sessionID, (command, tabID) => {
        sent.push(command)
        return { ok: true, tabID, url: "http://localhost:3000/form", title: "Form" }
      })
      const tool = yield* (yield* BrowserActTool).init()

      const result = yield* tool.execute({ action: "click", ref: "e3" }, ctx)
      expect(sent).toEqual([{ type: "act", action: "click", ref: "e3" }])
      expect(result.output).toContain("Action: click e3")
      expect(result.output).toContain("URL: http://localhost:3000/form")
      expect(result.output).not.toContain("Page changed")
      expect(result.metadata).toMatchObject({ action: "click", ref: "e3", tabID: "tab-1", navigated: false })
      expect(asks[0]?.permission).toBe("browser_act")
      expect(asks[0]?.patterns).toEqual(["http://localhost:3000/form"])
      expect(asks[0]?.always).toEqual(["http://localhost:3000/*"])
    }),
  )

  it.instance("flags that refs are stale when the action changed the page", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_act_navigated")
      const ctx = makeCtx<ActMetadata>(sessionID)
      yield* browser.setState(sessionID, {
        activeTabID: "tab-1",
        tabs: [{ tabID: "tab-1", url: "http://localhost:3000/form" }],
      })
      yield* fakePanel(sessionID, (_command, tabID) => ({ ok: true, tabID, url: "http://localhost:3000/done", text: "Selected \"Large\"" }))
      const tool = yield* (yield* BrowserActTool).init()

      const result = yield* tool.execute({ action: "select", ref: "e2", value: "Large" }, ctx)
      expect(result.metadata).toMatchObject({ url: "http://localhost:3000/done", navigated: true })
      expect(result.output).toContain('Selected "Large"')
      expect(result.output).toContain("Page changed from http://localhost:3000/form to http://localhost:3000/done")
      expect(result.output).toContain('browser_read with format "interactive"')
    }),
  )

  it.instance("rejects incomplete actions before asking permission or contacting the panel", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const asks: Ask[] = []
      const sessionID = SessionID.make("ses_tool_browser_act_invalid")
      const ctx = makeCtx<ActMetadata>(sessionID, asks)
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "http://localhost:3000/" }] })
      const sent: Browser.Command[] = []
      yield* fakePanel(sessionID, (command, tabID) => {
        sent.push(command)
        return { ok: true, tabID }
      })
      const tool = yield* (yield* BrowserActTool).init()

      const cases = [
        [{ action: "click" }, "ref"],
        [{ action: "hover" }, "ref"],
        [{ action: "fill", ref: "e1" }, "value"],
        [{ action: "fill", value: "x" }, "ref"],
        [{ action: "select", ref: "e1" }, "value"],
        [{ action: "type" }, "text"],
        [{ action: "press" }, "key"],
        [{ action: "scroll" }, "direction"],
      ] as const
      for (const [params, missing] of cases) {
        const exit = yield* Effect.exit(tool.execute(params, ctx))
        expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain(`requires "${missing}"`)
      }
      // An empty value is a valid fill: it clears the field.
      yield* tool.execute({ action: "fill", ref: "e1", value: "" }, ctx)

      expect(sent).toEqual([{ type: "act", action: "fill", ref: "e1", value: "" }])
      expect(asks).toHaveLength(1)
    }),
  )

  it.instance("reports a panel failure as a browser action error", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_act_failed")
      const ctx = makeCtx<ActMetadata>(sessionID)
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "https://example.com" }] })
      yield* fakePanel(sessionID, () => ({
        ok: false,
        error: 'Ref "e9" is not on the current page. Run browser_read with format "interactive" to get fresh refs.',
      }))
      const tool = yield* (yield* BrowserActTool).init()

      const exit = yield* Effect.exit(tool.execute({ action: "click", ref: "e9" }, ctx))
      expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("Browser action failed: Ref \"e9\" is not on the current page")
    }),
  )

  it.instance("fails clearly when no page is open or the tab is unknown", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_act_empty")
      const ctx = makeCtx<ActMetadata>(sessionID)
      const tool = yield* (yield* BrowserActTool).init()

      expect(Exit.isFailure(yield* Effect.exit(tool.execute({ action: "click", ref: "e1" }, ctx)))).toBe(true)

      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "https://example.com" }] })
      expect(Exit.isFailure(yield* Effect.exit(tool.execute({ action: "click", ref: "e1", tabID: "missing" }, ctx)))).toBe(true)
    }),
  )

  it.instance("describes the element and input from the last interactive read", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const asks: Ask[] = []
      const sessionID = SessionID.make("ses_tool_browser_act_labels")
      const url = "http://localhost:3000/form"
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url, title: "Form" }] })
      yield* fakePanel(sessionID, (command, tabID) =>
        command.type === "read"
          ? {
              ok: true,
              tabID,
              url,
              text: '[e1] button "Submit order"\n[e2] textbox "Customer name:"',
              elements: [
                { ref: "e1", role: "button", name: "Submit order" },
                { ref: "e2", role: "textbox", name: "Customer name:" },
              ],
            }
          : { ok: true, tabID, url },
      )
      yield* (yield* (yield* BrowserReadTool).init()).execute({ format: "interactive" }, makeCtx<ReadMetadata>(sessionID))
      const tool = yield* (yield* BrowserActTool).init()
      const ctx = makeCtx<ActMetadata>(sessionID, asks)

      const fill = yield* tool.execute({ action: "fill", ref: "e2", value: "Test User" }, ctx)
      // The approval prompt is built before the panel is contacted, so it must already carry the label.
      expect(asks[0]?.metadata).toMatchObject({ action: "fill", ref: "e2", role: "textbox", name: "Customer name:", input: "Test User" })
      expect(fill.title).toBe('fill textbox "Customer name:"')
      expect(fill.metadata).toMatchObject({ role: "textbox", name: "Customer name:", input: "Test User", navigated: false })
      expect(fill.output).toContain('Action: fill e2 (textbox "Customer name:")')

      const click = yield* tool.execute({ action: "click", ref: "e1" }, ctx)
      expect(click.title).toBe('click button "Submit order"')
      expect(click.metadata.input).toBeUndefined()
    }),
  )

  it.instance("falls back to the ref when it has no label and shortens long input", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_act_unlabelled")
      const url = "http://localhost:3000/form"
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url }] })
      yield* fakePanel(sessionID, (_command, tabID) => ({ ok: true, tabID, url }))
      const tool = yield* (yield* BrowserActTool).init()

      const result = yield* tool.execute({ action: "type", ref: "e7", text: "x".repeat(500) }, makeCtx<ActMetadata>(sessionID))
      expect(result.title).toBe("type e7")
      expect(result.metadata.role).toBeUndefined()
      expect(result.metadata.input).toBe(`${"x".repeat(120)}…`)
    }),
  )

  it.instance("forgets labels when the tab's page changes", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_tool_browser_act_labels_reset")
      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "http://localhost:3000/a" }] })
      yield* browser.setElements(sessionID, "tab-1", [{ ref: "e1", role: "button", name: "Go" }])
      expect(yield* browser.element(sessionID, "tab-1", "e1")).toEqual({ role: "button", name: "Go" })

      // A title or active-tab update on the same page keeps them.
      yield* browser.setState(sessionID, {
        activeTabID: "tab-1",
        tabs: [{ tabID: "tab-1", url: "http://localhost:3000/a", title: "A" }],
      })
      expect(yield* browser.element(sessionID, "tab-1", "e1")).toEqual({ role: "button", name: "Go" })

      yield* browser.setState(sessionID, { activeTabID: "tab-1", tabs: [{ tabID: "tab-1", url: "http://localhost:3000/b" }] })
      expect(yield* browser.element(sessionID, "tab-1", "e1")).toBeUndefined()
    }),
  )
})
