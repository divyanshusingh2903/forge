import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ServerInstance } from "@opencode-ai/core/server-instance"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionRecovery } from "@/session/recovery"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Database.node,
      ServerInstance.node,
      Session.node,
      SessionProjector.node,
      SessionRecovery.node,
      MessageV2.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)

const seed = Effect.fn("test.seed")(function* (
  dir: string,
  state: SessionV1.ToolState,
  metadata?: Record<string, unknown>,
) {
  const session = yield* Session.Service
  const info = yield* session.create({})
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: info.id,
    agent: "default",
    model: { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-4") },
    time: { created: Date.now() },
  })
  const assistant = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    sessionID: info.id,
    mode: "default",
    agent: "default",
    path: { cwd: dir, root: dir },
    cost: 0,
    tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelV2.ID.make("gpt-4"),
    providerID: ProviderV2.ID.make("openai"),
    parentID: user.id,
    time: { created: Date.now() },
  })
  const part = yield* session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID: info.id,
    type: "tool",
    tool: "bash",
    callID: "call-1",
    state,
    metadata,
  } satisfies SessionV1.ToolPart)
  return { sessionID: info.id, messageID: assistant.id, partID: part.id }
})

const running: SessionV1.ToolState = {
  status: "running",
  input: { command: "bun typecheck" },
  title: "bun typecheck",
  metadata: { output: "partial output" },
  time: { start: 1_000 },
}

const read = Effect.fn("test.read")(function* (sessionID: SessionID, messageID: MessageID) {
  const database = yield* Database.Service
  const message = yield* MessageV2.get({ sessionID, messageID }).pipe(Effect.provideService(Database.Service, database))
  const part = message.parts.find((item): item is SessionV1.ToolPart => item.type === "tool")
  return { info: message.info, part }
})

describe("SessionRecovery", () => {
  it.live(
    "interrupts a running part with no owner and closes its message",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const recovery = yield* SessionRecovery.Service
        const seeded = yield* seed(dir, running)

        expect(yield* recovery.reconcile(seeded.sessionID)).toBe(1)

        const result = yield* read(seeded.sessionID, seeded.messageID)
        expect(result.part?.state.status).toBe("error")
        if (result.part?.state.status !== "error") return
        expect(result.part.state.error).toBe(SessionRecovery.interruptedError)
        expect(result.part.state.metadata).toEqual({ output: "partial output", interrupted: true })
        expect(result.part.state.time.start).toBe(1_000)
        expect(result.part.state.time.end).toBeGreaterThan(1_000)
        expect(result.info.role === "assistant" && result.info.time.completed).toBeGreaterThan(0)
        expect(result.info.role === "assistant" && result.info.finish).toBe("error")
      }),
    ),
  )

  it.live(
    "interrupts a pending part whose owner is not a live server",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const recovery = yield* SessionRecovery.Service
        const seeded = yield* seed(dir, { status: "pending", input: {}, raw: "" }, { owner: { instance: "srv_dead" } })

        expect(yield* recovery.reconcile(seeded.sessionID)).toBe(1)

        const result = yield* read(seeded.sessionID, seeded.messageID)
        expect(result.part?.state.status).toBe("error")
        if (result.part?.state.status !== "error") return
        expect(result.part.state.time.start).toBe(result.part.state.time.end)
        expect(result.part.metadata).toEqual({ owner: { instance: "srv_dead" } })
      }),
    ),
  )

  it.live(
    "leaves parts owned by a live server untouched",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const recovery = yield* SessionRecovery.Service
        const instance = yield* ServerInstance.Service
        const seeded = yield* seed(dir, running, { owner: instance.owner })

        expect(yield* recovery.reconcile(seeded.sessionID)).toBe(0)

        const result = yield* read(seeded.sessionID, seeded.messageID)
        expect(result.part?.state.status).toBe("running")
        expect(result.info.role === "assistant" && result.info.time.completed).toBeUndefined()
      }),
    ),
  )

  it.live(
    "only touches the requested session",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const recovery = yield* SessionRecovery.Service
        const first = yield* seed(dir, running)
        const second = yield* seed(dir, running)

        expect(yield* recovery.reconcile(first.sessionID)).toBe(1)

        const result = yield* read(second.sessionID, second.messageID)
        expect(result.part?.state.status).toBe("running")
      }),
    ),
  )
})
