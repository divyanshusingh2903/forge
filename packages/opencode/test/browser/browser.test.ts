import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Queue } from "effect"
import { Browser } from "@/browser"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Browser.node,
      Session.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
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

type CommandEvent = { sessionID: SessionID; requestID: string; tabID?: string; timeoutMs: number; command: Browser.Command }

const listenCommands = Effect.gen(function* () {
  const events = yield* EventV2Bridge.Service
  const queue = yield* Queue.unbounded<CommandEvent>()
  const unsub = yield* events.listen((event) =>
    Effect.sync(() => {
      if (event.type === Browser.Event.Command.type) Queue.offerUnsafe(queue, event.data as CommandEvent)
    }),
  )
  yield* Effect.addFinalizer(() => unsub)
  return queue
})

const failureMessage = (exit: Exit.Exit<unknown, Browser.CommandError>) =>
  Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit))?.message : undefined

describe("Browser.Service", () => {
  it.instance("command publishes the command and fails when no panel attaches in time", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const commands = yield* listenCommands
      const sessionID = SessionID.make("ses_browser_no_panel")

      const exit = yield* Effect.exit(
        browser.command(sessionID, { type: "navigate", action: "goto", url: "https://example.com" }, { timeoutMs: 50 }),
      )
      expect(failureMessage(exit)).toContain("browser panel is not open")

      const event = yield* Queue.take(commands)
      expect(event.sessionID).toBe(sessionID)
      expect(event.command).toEqual({ type: "navigate", action: "goto", url: "https://example.com" })
      expect(event.timeoutMs).toBe(100)
      expect(event.requestID.length).toBeGreaterThan(0)
    }),
  )

  it.instance("command resolves only on a result echoing its requestID", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const commands = yield* listenCommands
      const sessionID = SessionID.make("ses_browser_waiter")
      yield* browser.attach(sessionID, "client-a")

      const fiber = yield* Effect.forkChild(
        browser.command(sessionID, { type: "read", format: "html" }, { tabID: "tab-1", timeoutMs: 5000 }),
      )
      const event = yield* Queue.take(commands)
      expect(event.tabID).toBe("tab-1")

      yield* browser.resolve(sessionID, { requestID: "req_other", ok: true, html: "<p>wrong</p>" })
      expect(Option.isNone(yield* Fiber.join(fiber).pipe(Effect.timeoutOption("20 millis")))).toBe(true)

      yield* browser.resolve(sessionID, {
        requestID: event.requestID,
        ok: true,
        tabID: "tab-1",
        url: "https://example.com/final",
        html: "<p>right</p>",
      })
      const result = yield* Fiber.join(fiber)
      expect(result.url).toBe("https://example.com/final")
      expect(result.html).toBe("<p>right</p>")
    }),
  )

  it.instance("command waits for a panel that attaches after the command is sent", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const commands = yield* listenCommands
      const sessionID = SessionID.make("ses_browser_late_attach")

      const fiber = yield* Effect.forkChild(
        browser.command(sessionID, { type: "navigate", action: "reload" }, { timeoutMs: 5000 }),
      )
      const event = yield* Queue.take(commands)
      yield* browser.attach(sessionID, "client-a")
      yield* browser.resolve(sessionID, { requestID: event.requestID, ok: true, url: "https://example.com" })
      expect((yield* Fiber.join(fiber)).url).toBe("https://example.com")
    }),
  )

  it.instance("command surfaces panel errors and times out without a reply", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const commands = yield* listenCommands
      const sessionID = SessionID.make("ses_browser_errors")
      yield* browser.attach(sessionID, "client-a")

      const fiber = yield* Effect.forkChild(
        Effect.exit(browser.command(sessionID, { type: "navigate", action: "back" }, { timeoutMs: 5000 })),
      )
      const event = yield* Queue.take(commands)
      yield* browser.resolve(sessionID, { requestID: event.requestID, ok: false, error: "Cannot go back" })
      expect(failureMessage(yield* Fiber.join(fiber))).toBe("Cannot go back")

      const timedOut = yield* Effect.exit(
        browser.command(sessionID, { type: "read", format: "text" }, { timeoutMs: 30 }),
      )
      expect(failureMessage(timedOut)).toContain("did not respond within 30ms")
    }),
  )

  it.instance("leases are tracked per client", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_browser_leases")

      yield* browser.attach(sessionID, "window-a")
      yield* browser.attach(sessionID, "window-b")
      expect((yield* browser.detach(sessionID, "window-a")).attached).toBe(true)
      expect((yield* browser.detach(sessionID, "window-b")).attached).toBe(false)
    }),
  )

  it.instance("resolve rejects page content over 5MB", () =>
    Effect.gen(function* () {
      const browser = yield* Browser.Service
      const sessionID = SessionID.make("ses_browser_oversize")
      const exit = yield* Effect.exit(
        browser.resolve(sessionID, { requestID: "req", ok: true, html: "x".repeat(Browser.MAX_CONTENT_BYTES + 1) }),
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.instance("tab state never touches the session and is dropped when the session is deleted", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const browser = yield* Browser.Service

      const created = yield* session.create({})
      const before = yield* session.get(created.id)
      yield* Effect.sleep("20 millis")

      const info = yield* browser.setState(created.id, {
        activeTabID: "tab-dev",
        tabs: [
          { tabID: "tab-dev", url: "http://localhost:3000/", title: "Dev" },
          { tabID: "tab-docs", url: "https://example.com/docs" },
        ],
      })
      expect(info.activeTabID).toBe("tab-dev")
      expect(info.tabs.length).toBe(2)

      const after = yield* session.get(created.id)
      expect(after.time.updated).toBe(before.time.updated)
      expect(after.metadata).toEqual(before.metadata)

      yield* session.remove(created.id)
      expect((yield* browser.get(created.id)).tabs).toEqual([])
    }),
  )
})
