import { describe, expect } from "bun:test"
import { ForgeChapters } from "@opencode/schema/forge-chapters"
import { KV } from "@opencode/core/kv"
import { LinkPreview } from "@opencode/core/link-preview"
import { PluginHost } from "@opencode/core/plugin/host"
import { ForgeChaptersPlugin } from "@opencode/core/plugin/forge-chapters"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Queue, Stream } from "effect"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const it = testEffect(LayerNode.compile(KV.node))

type Handlers = {
  list: (input: { sessionID: string }) => Effect.Effect<ForgeChapters.State>
  pin: (input: {
    sessionID: string
    messageID: string
    turnMessageID: string
    role: ForgeChapters.Role
    title: string
  }) => Effect.Effect<ForgeChapters.State>
  rename: (input: { sessionID: string; messageID: string; title: string }) => Effect.Effect<ForgeChapters.State>
  remove: (input: { sessionID: string; messageID: string }) => Effect.Effect<ForgeChapters.State>
}

const sessionID = "ses_chapters"
const issue = "https://github.com/a/b/issues/7"

const mount = Effect.fnUntraced(function* (preview: LinkPreview.Interface) {
  const kv = yield* KV.Service
  const events = yield* Queue.unbounded<{ type: string; data: Record<string, unknown> }>()
  const published = new Array<ForgeChapters.State>()
  const registered: { handlers?: Handlers } = {}

  yield* ForgeChaptersPlugin.Plugin.effect(
    host({
      storage: PluginHost.storage(kv, ForgeChaptersPlugin.Plugin.id),
      // SAFETY: the plugin subscribes once, and the tests offer events in the shapes it reads.
      event: { subscribe: () => Stream.fromQueue(events) as never },
      rpc: Object.assign(
        () => {
          throw new Error("unused RPC client")
        },
        {
          // SAFETY: the plugin registers ForgeChapters.Definition, whose handlers have the Handlers shape.
          register: (_definition: unknown, handlers: Handlers) => {
            registered.handlers = handlers
            return Effect.succeed({
              events: {
                emit: (_name: string, payload: { state: ForgeChapters.State }) =>
                  Effect.sync(() => void published.push(payload.state)),
              },
            })
          },
        } as never,
      ),
    }),
  ).pipe(Effect.provideService(LinkPreview.Service, preview))

  const handlers = registered.handlers
  if (!handlers) return yield* Effect.die("the chapters RPC was not registered")

  // Offers one event and gives the plugin's forked work a bounded number of turns to store what it means.
  const send = (type: string, data: Record<string, unknown>, done: (state: ForgeChapters.State) => boolean) =>
    Effect.gen(function* () {
      yield* Queue.offer(events, { type, data: { sessionID, ...data } })
      for (let turn = 0; turn < 200; turn++) {
        if (done(yield* handlers.list({ sessionID }))) return
        yield* Effect.yieldNow
      }
    })

  return {
    handlers,
    published,
    send,
    prompt: (messageID: string, text: string, done: (state: ForgeChapters.State) => boolean) =>
      send("session.inbox.enqueued", { inboxID: messageID, item: { type: "user", payload: { text } } }, done),
    list: () => handlers.list({ sessionID }),
  }
})

const unavailable: LinkPreview.Interface = { resolve: () => Effect.succeed({ outcome: "unavailable" }) }

describe("forge.chapters plugin", () => {
  it.effect("the user pins, renames and removes chapters on user and agent messages", () =>
    Effect.gen(function* () {
      const plugin = yield* mount(unavailable)

      yield* plugin.handlers.pin({ sessionID, messageID: "msg_2", turnMessageID: "msg_1", role: "assistant", title: "Reply" })
      yield* plugin.handlers.pin({ sessionID, messageID: "msg_1", turnMessageID: "msg_1", role: "user", title: "Ask" })
      expect((yield* plugin.list()).chapters.map((chapter) => [chapter.anchorMessageID, chapter.role])).toEqual([
        ["msg_1", "user"],
        ["msg_2", "assistant"],
      ])

      yield* plugin.handlers.rename({ sessionID, messageID: "msg_1", title: "Question" })
      const removed = yield* plugin.handlers.remove({ sessionID, messageID: "msg_2" })
      expect(removed.chapters.map((chapter) => chapter.title)).toEqual(["Question"])
      // Every write reached clients.
      expect(plugin.published).toHaveLength(4)
      expect(plugin.published.at(-1)).toEqual(removed)
    }),
  )

  it.effect("a new issue starts one chapter on the agent's message and takes the issue's title", () =>
    Effect.gen(function* () {
      const plugin = yield* mount({
        resolve: (input) => Effect.succeed({ outcome: "ok", title: `Title of ${input.number}` }),
      })

      yield* plugin.prompt("msg_1", `Please fix ${issue}`, (state) => state.pending?.title === "#7 Title of 7")
      expect((yield* plugin.list()).chapters).toEqual([])
      yield* plugin.send("session.inbox.delivered", { inboxID: "msg_1" }, (state) => !state.pending?.waitFor)
      yield* plugin.send("session.step.started", { assistantMessageID: "msg_2" }, (state) => state.chapters.length === 1)
      yield* plugin.send("session.step.started", { assistantMessageID: "msg_3" }, () => false)
      // The same issue again is not a new one.
      yield* plugin.prompt("msg_4", `More on ${issue}`, () => false)
      yield* plugin.send("session.step.started", { assistantMessageID: "msg_5" }, () => false)

      expect((yield* plugin.list()).chapters).toMatchObject([
        { title: "#7 Title of 7", anchorMessageID: "msg_2", turnMessageID: "msg_1", role: "assistant", source: "reference" },
      ])
    }),
  )

  it.effect("a compaction starts a chapter on the agent's next message, and synthetic prompts start none", () =>
    Effect.gen(function* () {
      const plugin = yield* mount(unavailable)

      yield* plugin.send(
        "session.inbox.enqueued",
        { inboxID: "msg_0", item: { type: "synthetic", payload: { text: issue } } },
        () => false,
      )
      yield* plugin.send("session.step.started", { assistantMessageID: "msg_1" }, () => false)
      expect(yield* plugin.list()).toEqual({ chapters: [], seen: [] })

      yield* plugin.send("session.compaction.ended", {}, (state) => state.pending !== undefined)
      yield* plugin.prompt("msg_2", "Now the docs", (state) => state.pending?.waitFor === "msg_2")
      yield* plugin.send("session.inbox.delivered", { inboxID: "msg_2" }, (state) => !state.pending?.waitFor)
      yield* plugin.send("session.step.started", { assistantMessageID: "msg_3" }, (state) => state.chapters.length === 1)

      expect((yield* plugin.list()).chapters).toMatchObject([
        { title: "Now the docs", anchorMessageID: "msg_3", turnMessageID: "msg_2", role: "assistant", source: "compaction" },
      ])
    }),
  )

  it.effect("a cancelled prompt, a revert and a deleted session take their chapters with them", () =>
    Effect.gen(function* () {
      const plugin = yield* mount(unavailable)

      yield* plugin.prompt("msg_1", issue, (state) => state.pending !== undefined)
      yield* plugin.send("session.inbox.cancelled", { inboxID: "msg_1" }, (state) => state.pending === undefined)
      yield* plugin.send("session.step.started", { assistantMessageID: "msg_2" }, () => false)
      expect(yield* plugin.list()).toEqual({ chapters: [], seen: [] })

      yield* plugin.handlers.pin({ sessionID, messageID: "msg_3", turnMessageID: "msg_3", role: "user", title: "Keep" })
      yield* plugin.handlers.pin({ sessionID, messageID: "msg_6", turnMessageID: "msg_5", role: "assistant", title: "Drop" })
      yield* plugin.send("session.revert.committed", { to: "msg_5" }, (state) => state.chapters.length === 1)
      expect((yield* plugin.list()).chapters.map((chapter) => chapter.title)).toEqual(["Keep"])

      yield* plugin.send("session.deleted", {}, (state) => state.chapters.length === 0)
      expect(yield* plugin.list()).toEqual({ chapters: [], seen: [] })
    }),
  )
})
