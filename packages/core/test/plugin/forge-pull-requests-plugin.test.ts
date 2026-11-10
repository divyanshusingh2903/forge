import { describe, expect } from "bun:test"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import { Agent } from "@opencode/schema/agent"
import { ForgePullRequests } from "@opencode/schema/forge-pull-requests"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { KV } from "@opencode/core/kv"
import { LinkPreview } from "@opencode/core/link-preview"
import { PluginHost } from "@opencode/core/plugin/host"
import { ForgePullRequestsPlugin } from "@opencode/core/plugin/forge-pull-requests"
import { Service } from "@opencode/core/shell"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Exit, Schema, Scope } from "effect"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const it = testEffect(LayerNode.compile(KV.node))

const context: Tool.Context = {
  sessionID: Session.ID.make("ses_pull_requests"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.create(),
  id: Tool.CallID.make("call_creation"),
  progress: () => Effect.void,
}

const failingCi = {
  status: "ok",
  unit: "checks",
  passed: 20,
  failed: 2,
  pending: 0,
  skipped: 0,
  cancelled: 0,
  total: 22,
  complete: true,
  sha: "aaa111",
  failures: [{ name: "unit (macos)", url: "https://github.com/a/b/actions/runs/1" }],
} as const

const mount = Effect.fnUntraced(function* (preview: LinkPreview.Interface, sessionID = Session.ID.create()) {
  const kv = yield* KV.Service
  const hooks = new Array<(event: ToolHooks["execute.after"]) => Effect.Effect<void>>()
  const tools = new Map<string, Tool.Info>()
  const published = new Array<ForgePullRequests.State>()
  const sent = new Array<{ id?: string; text: string; description?: string; delivery?: string }>()

  yield* ForgePullRequestsPlugin.Plugin.effect(
    host({
      storage: PluginHost.storage(kv, ForgePullRequestsPlugin.Plugin.id),
      rpc: Object.assign(
        () => {
          throw new Error("unused RPC client")
        },
        {
          // SAFETY: the plugin only emits events on the registration; the tests call its tool, not the RPC methods.
          register: () =>
            Effect.succeed({
              events: {
                emit: (_name: string, payload: { state: ForgePullRequests.State }) =>
                  Effect.sync(() => void published.push(payload.state)),
              },
            }) as never,
        },
      ),
      session: {
        hook: () => Effect.succeed({ dispose: Effect.void }),
        // SAFETY: the plugin ignores the admitted message; the test only records what it asked for.
        synthetic: ((input: { id?: string; text: string; description?: string; delivery?: string }) =>
          Effect.sync(() => void sent.push(input))) as never,
      },
      tool: {
        list: () => Effect.succeed(Array.from(tools.values()).map((tool) => ({ ...tool, id: tool.name }))),
        reload: () => Effect.void,
        hook: (name, callback) => {
          // SAFETY: the plugin registers execute.after only, and each invocation below supplies that event's full shape.
          if (name === "execute.after")
            hooks.push(callback as (event: ToolHooks["execute.after"]) => Effect.Effect<void>)
          return Effect.succeed({ dispose: Effect.void })
        },
        transform: (callback) => {
          callback({
            add: (tool) => {
              tools.set(tool.name, tool)
            },
            list: () => [],
            get: () => undefined,
            namespace: () => {},
            update: () => {},
            remove: () => {},
          })
          return Effect.succeed({ dispose: Effect.void })
        },
      },
    }),
  ).pipe(
    Effect.provideService(LinkPreview.Service, preview),
    Effect.provideService(Service, {
      create: () => Effect.die("unused shell.create"),
      list: () => Effect.succeed([]),
      get: () => Effect.die("unused shell.get"),
      wait: () => Effect.die("unused shell.wait"),
      result: () => Effect.die("unused shell.result"),
      timeout: () => Effect.die("unused shell.timeout"),
      output: () => Effect.die("unused shell.output"),
      remove: () => Effect.die("unused shell.remove"),
    }),
  )

  const call = (
    input: { action: "list" | "refresh" | "track" | "untrack" | "auto_fix"; key?: string; url?: string; enabled?: boolean },
    target = sessionID,
  ) => {
    const tool = tools.get("pull_requests")
    if (!tool) return Effect.die("the pull_requests tool was not registered")
    return tool.execute(input, { ...context, sessionID: target })
  }

  return {
    sessionID,
    call,
    published,
    sent,
    created: (tool: string, output: Schema.Json, input: Schema.Json = {}) =>
      Effect.forEach(
        hooks,
        (hook) => hook({ ...context, sessionID, tool, input, status: "completed", result: { output } }),
        { discard: true },
      ),
    list: () =>
      call({ action: "list" }).pipe(
        Effect.map((result) => Schema.decodeUnknownSync(ForgePullRequests.State)(result.output)),
      ),
  }
})

const github = (number: number): ForgePullRequests.Identity => ({
  provider: "github",
  host: "github.com",
  repository: "a/b",
  number,
})

// Gives forked background work a bounded number of turns to finish, returning as soon as the condition holds.
const settle = <E>(done: () => Effect.Effect<boolean, E>, turns = 200) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < turns; turn++) {
      if (yield* done()) return
      yield* Effect.yieldNow
    }
  })

const decode = (output: unknown) => Schema.decodeUnknownSync(ForgePullRequests.State)(output)

describe("forge.pull-requests plugin", () => {
  it.effect("tracks creations on both providers once, across a restart, and ignores mentions", () =>
    Effect.gen(function* () {
      const firstScope = yield* Scope.make()
      const first = yield* mount({ resolve: () => Effect.succeed({ outcome: "ok", state: "open" }) }).pipe(
        Effect.provideService(Scope.Scope, firstScope),
      )

      yield* first.created("github_create_pull_request", { html_url: "https://github.com/a/b/pull/1" })
      // The same pull request again, spelled with different case, is the same one.
      yield* first.created("github_create_pull_request", { html_url: "https://github.com/A/B/pull/1" })
      yield* first.created(
        "shell",
        { exit: 0, output: "https://gitlab.com/a/b/-/merge_requests/1\n" },
        { command: "glab mr create --title change --description change" },
      )
      // None of these is a creation.
      yield* first.created("github_get_pull_request", { html_url: "https://github.com/a/b/pull/2" })
      yield* first.created(
        "shell",
        { exit: 0, output: "https://github.com/a/b/pull/3\n" },
        { command: "echo https://github.com/a/b/pull/3" },
      )
      yield* first.created(
        "shell",
        { exit: 1, output: "https://github.com/a/b/pull/4\n" },
        { command: "gh pr create --title change" },
      )

      expect((yield* first.list()).items).toHaveLength(2)
      yield* Scope.close(firstScope, Exit.void)

      const restarted = yield* mount({ resolve: () => Effect.succeed({ outcome: "ok", state: "merged" }) }, first.sessionID)
      const state = yield* restarted.list()
      expect(state.items.map((item) => [item.identity.provider, item.identity.number, item.source])).toEqual([
        ["github", 1, "created"],
        ["gitlab", 1, "created"],
      ])

      // Another session tracks nothing.
      const other = yield* restarted.call({ action: "list" }, Session.ID.make("ses_other"))
      expect(decode(other.output).items).toHaveLength(0)
    }),
  )

  it.effect("tracks a pull request on request, rejects other links, and untracks", () =>
    Effect.gen(function* () {
      const plugin = yield* mount({ resolve: () => Effect.succeed({ outcome: "ok", state: "open", title: "Change" }) })

      const tracked = yield* plugin.call({ action: "track", url: "https://github.com/a/b/pull/7/files" })
      expect(decode(tracked.output).items.map((item) => [item.identity.number, item.source])).toEqual([[7, "requested"]])

      const unsupported = yield* plugin.call({ action: "track", url: "https://github.com/a/b/issues/7" }).pipe(Effect.flip)
      expect(unsupported.message).toContain("pull request")
      expect((yield* plugin.list()).items).toHaveLength(1)

      const key = ForgePullRequests.key(github(7))
      const removed = yield* plugin.call({ action: "untrack", key })
      expect(decode(removed.output).items).toHaveLength(0)
      expect(plugin.published.at(-1)?.items).toHaveLength(0)
    }),
  )

  it.effect("keeps the last good status when a refresh fails, and leaves a rate-limited host alone", () =>
    Effect.gen(function* () {
      const calls = new Array<number>()
      const plugin = yield* mount({
        resolve: (input) =>
          Effect.sync(() => {
            calls.push(input.number ?? 0)
            // The first lookup of the first pull request succeeds; every later one is rate-limited.
            return calls.length === 1
              ? { outcome: "ok", state: "draft", title: "Change" }
              : { outcome: "unavailable", reason: "rate-limit" }
          }),
      })

      yield* plugin.created("github_create_pull_request", { html_url: "https://github.com/a/b/pull/1" })
      // Creation looks the item up in the background. Wait for that before the rate-limited refresh.
      yield* settle(() => plugin.list().pipe(Effect.map((state) => state.items[0]?.status !== undefined)))
      const key = ForgePullRequests.key(github(1))

      const limited = decode((yield* plugin.call({ action: "refresh", key })).output).items[0]

      // The failed refresh keeps the draft status next to the reason, and is never shown as fresh.
      expect(limited?.failure).toBe("unavailable")
      expect(limited?.reason).toBe("rate-limit")
      expect(limited?.status?.state).toBe("draft")

      // A second item on the same host is not looked up while the host is rate-limited, in the background or on request.
      yield* plugin.created("github_create_pull_request", { html_url: "https://github.com/a/b/pull/2" })
      yield* settle(() => Effect.succeed(false), 20)
      yield* plugin.call({ action: "refresh", key: ForgePullRequests.key(github(2)) })
      expect(calls).toHaveLength(2)
      expect((yield* plugin.list()).items[1]?.status).toBeUndefined()
    }),
  )

  it.effect("does not arm auto-fix on a merged or missing pull request, and disarms one that merges", () =>
    Effect.gen(function* () {
      const results = new Map<number, LinkPreview.Result>([
        [1, { outcome: "ok", state: "merged" }],
        [2, { outcome: "not-found" }],
        [3, { outcome: "ok", state: "open", ci: failingCi }],
      ])
      const plugin = yield* mount({ resolve: (input) => Effect.succeed(results.get(input.number ?? 0) ?? { outcome: "unavailable" }) })

      for (const number of [1, 2, 3]) {
        yield* plugin.call({ action: "track", url: `https://github.com/a/b/pull/${number}` })
        yield* settle(() =>
          plugin.list().pipe(Effect.map((state) => state.items.find((item) => item.identity.number === number)?.checkedAt !== undefined || number === 2)),
        )
        yield* plugin.call({ action: "refresh", key: ForgePullRequests.key(github(number)) })
      }

      for (const number of [1, 2]) {
        const error = yield* plugin
          .call({ action: "auto_fix", key: ForgePullRequests.key(github(number)), enabled: true })
          .pipe(Effect.flip)
        expect(error.message).toContain("only available for open pull requests")
      }
      expect(plugin.sent).toHaveLength(0)

      // An open one can be armed, and disarms itself once it merges.
      const open = ForgePullRequests.key(github(3))
      yield* plugin.call({ action: "auto_fix", key: open, enabled: true })
      results.set(3, { outcome: "ok", state: "merged" })
      yield* plugin.call({ action: "refresh", key: open })
      expect((yield* plugin.list()).items.find((item) => item.identity.number === 3)?.autoFix.enabled).toBe(false)
    }),
  )

  it.effect("asks for one fix per failed revision, only when armed, and never twice for the same one", () =>
    Effect.gen(function* () {
      const plugin = yield* mount({
        resolve: () => Effect.succeed({ outcome: "ok", state: "open", head: "fix-it", ci: failingCi }),
      })
      yield* plugin.call({ action: "track", url: "https://github.com/a/b/pull/9" })
      const key = ForgePullRequests.key(github(9))

      // Not armed: a failed run is only shown.
      yield* plugin.call({ action: "refresh", key })
      expect(plugin.sent).toHaveLength(0)

      yield* plugin.call({ action: "auto_fix", key, enabled: true })
      yield* plugin.call({ action: "refresh", key })
      yield* plugin.call({ action: "refresh", key })

      expect(plugin.sent).toHaveLength(1)
      expect(plugin.sent[0]).toMatchObject({
        delivery: "queue",
        description: "Auto-fixing CI on a/b#9",
      })
      expect(plugin.sent[0]?.id?.startsWith("msg_")).toBe(true)
      expect(plugin.sent[0]?.text).toContain("unit (macos)")
      expect((yield* plugin.list()).items[0]?.autoFix).toMatchObject({
        enabled: true,
        state: "fixing",
        attempts: 1,
        handledSha: "aaa111",
      })
    }),
  )
})
