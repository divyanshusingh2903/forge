import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Effect, Exit, Layer, Queue } from "effect"
import { Agent } from "@/agent/agent"
import { Browser } from "@/browser"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { MessageID, SessionID } from "@/session/schema"
import { BrowserNavigateTool, BrowserReadTool, type NavigateMetadata, type ReadMetadata } from "@/tool/browser"
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
