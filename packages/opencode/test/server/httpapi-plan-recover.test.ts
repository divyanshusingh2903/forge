import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { Config } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { Workspace } from "../../src/control-plane/workspace"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Database } from "@opencode-ai/core/database/database"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstanceEffect, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)
const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true, disableLogger: true },
)
const httpApiLayer = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer))

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

function request(path: string, init?: RequestInit) {
  const url = new URL(path, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

function json<T>(response: HttpClientResponse.HttpClientResponse) {
  if (response.status !== 200) return response.text.pipe(Effect.flatMap((text) => Effect.die(new Error(text))))
  return response.json.pipe(Effect.map((value) => value as T))
}

function requestJson<T>(path: string, init?: RequestInit) {
  return request(path, init).pipe(Effect.flatMap(json<T>))
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
  await resetDatabase()
})

describe("plan recover HttpApi", () => {
  it.instance(
    "fails a stale running present_plan and is idempotent",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* Session.use.create({ title: "plan-recover" })

        const user = yield* Session.use.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "plan",
          model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
          time: { created: Date.now() },
        })
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "plan something",
        })

        const assistant = yield* Session.use.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          parentID: user.id,
          sessionID: session.id,
          mode: "plan",
          agent: "plan",
          cost: 0,
          path: { cwd: "/tmp", root: "/tmp" },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelV2.ID.make("test"),
          providerID: ProviderV2.ID.make("test"),
          time: { created: Date.now() },
        })
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: assistant.id,
          type: "tool",
          tool: "present_plan",
          callID: "call_orphan",
          state: { status: "running", input: {}, time: { start: Date.now() } },
        })

        const first = yield* requestJson<{ path: string; exists: boolean; recovered: boolean }>(
          pathFor(SessionPaths.planRecover, { sessionID: session.id }),
          { method: "POST", headers, body: JSON.stringify({}) },
        )
        expect(first.recovered).toBe(true)
        expect(first.exists).toBe(false)
        expect(typeof first.path).toBe("string")

        const messages = yield* Session.use.messages({ sessionID: session.id }).pipe(
          provideInstanceEffect(test.directory),
          Effect.orDie,
        )
        const parts = messages.flatMap((msg) => msg.parts)
        const tool = parts.find(
          (part): part is SessionV1.ToolPart => part.type === "tool" && part.tool === "present_plan",
        )
        expect(tool?.state.status).toBe("error")
        if (tool?.state.status === "error") {
          expect(tool.state.error).toBe("Tool execution interrupted")
          expect(tool.state.metadata?.interrupted).toBe(true)
        }

        const second = yield* requestJson<{ path: string; exists: boolean; recovered: boolean }>(
          pathFor(SessionPaths.planRecover, { sessionID: session.id }),
          { method: "POST", headers, body: JSON.stringify({}) },
        )
        expect(second.recovered).toBe(false)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "action=continue forks a resume prompt without erroring, and stays idempotent on an already-interrupted part",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* Session.use.create({ title: "plan-recover-continue" })

        const user = yield* Session.use.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "plan",
          model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
          time: { created: Date.now() },
        })
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "plan something",
        })

        const assistant = yield* Session.use.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          parentID: user.id,
          sessionID: session.id,
          mode: "plan",
          agent: "plan",
          cost: 0,
          path: { cwd: "/tmp", root: "/tmp" },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelV2.ID.make("test"),
          providerID: ProviderV2.ID.make("test"),
          time: { created: Date.now() },
        })
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: assistant.id,
          type: "tool",
          tool: "present_plan",
          callID: "call_continue",
          state: { status: "running", input: {}, time: { start: Date.now() } },
        })

        // First call: the part is still "running" -- continue should mark it
        // interrupted (recovered) AND resume, without the endpoint itself
        // erroring even though there's no LLM configured in this test layer
        // to actually answer the forked follow-up (that failure is caught and
        // only logged/published as a Session.Event.Error, not surfaced here).
        const first = yield* requestJson<{ path: string; exists: boolean; recovered: boolean; resumed: boolean }>(
          pathFor(SessionPaths.planRecover, { sessionID: session.id }),
          { method: "POST", headers, body: JSON.stringify({ action: "continue" }) },
        )
        expect(first.recovered).toBe(true)
        expect(first.resumed).toBe(true)

        const messages = yield* Session.use.messages({ sessionID: session.id }).pipe(
          provideInstanceEffect(test.directory),
          Effect.orDie,
        )
        const parts = messages.flatMap((msg) => msg.parts)
        const tool = parts.find(
          (part): part is SessionV1.ToolPart => part.type === "tool" && part.tool === "present_plan",
        )
        expect(tool?.state.status).toBe("error")

        // Second call: the part is already error+interrupted -- continue
        // should still resume (not a no-op) but must not re-mark it.
        const second = yield* requestJson<{ path: string; exists: boolean; recovered: boolean; resumed: boolean }>(
          pathFor(SessionPaths.planRecover, { sessionID: session.id }),
          { method: "POST", headers, body: JSON.stringify({ action: "continue" }) },
        )
        expect(second.recovered).toBe(false)
        expect(second.resumed).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "finds an existing plan file even when no plan-cycle anchor is found in history",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* Session.use.create({ title: "plan-recover-no-anchor" })

        // Message history exists (just not one planCycleAnchor recognizes as a plan-mode
        // stretch) -- a session with zero messages can never have generated its own plan
        // file, so the handler now short-circuits that case without touching the
        // filesystem; this test is specifically about the anchor-missing-but-history-exists
        // case, so it needs at least one ordinary message.
        const user = yield* Session.use.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "build",
          model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
          time: { created: Date.now() },
        })
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "do something unrelated to planning",
        })

        const dir = `${test.directory}/.opencode/plans`
        yield* Effect.promise(() => import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true })))
        const file = `${dir}/${Date.now() + 60_000}-${session.slug}.md`
        yield* Effect.promise(() => Bun.write(file, "# Plan\n\nSome plan content."))

        const info = yield* requestJson<{ path: string; exists: boolean }>(
          pathFor(SessionPaths.plan, { sessionID: session.id }),
          { headers },
        )
        expect(info.exists).toBe(true)
        expect(info.path).toBe(file)

        const recovered = yield* requestJson<{ path: string; exists: boolean; recovered: boolean; resumed: boolean }>(
          pathFor(SessionPaths.planRecover, { sessionID: session.id }),
          { method: "POST", headers, body: JSON.stringify({}) },
        )
        expect(recovered.exists).toBe(true)
        expect(recovered.path).toBe(file)
        expect(recovered.recovered).toBe(false)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "reports no plan for a brand-new session with zero messages, without a directory scan",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        // No messages at all -- this is the hot path every new session hits on its very
        // first load. A session with no messages can never have generated its own plan
        // file, so this must resolve instantly without touching the filesystem, unlike
        // the anchor-missing-but-history-exists case above.
        const session = yield* Session.use.create({ title: "plan-recover-brand-new" })

        const info = yield* requestJson<{ path: string; exists: boolean }>(
          pathFor(SessionPaths.plan, { sessionID: session.id }),
          { headers },
        )
        expect(info.exists).toBe(false)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "returns 404 for unknown sessions",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const missing = SessionID.descending()
        const response = yield* request(pathFor(SessionPaths.planRecover, { sessionID: missing }), {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        })
        expect(response.status).toBe(404)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
