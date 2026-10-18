import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ServerInstance } from "@opencode-ai/core/server-instance"
import { PartTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { isRecord } from "@/util/record"
import { Session } from "./session"
import { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"

export const interruptedError = "Tool execution interrupted (server restarted)"

export interface Interface {
  /**
   * Finishes `pending`/`running` tool parts whose owning server is no longer alive, plus their assistant messages.
   * Only stored state is repaired; tool and provider work is never retried.
   */
  readonly reconcile: (sessionID?: SessionID) => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRecovery") {}

const isOwner = Schema.is(ServerInstance.Owner)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const session = yield* Session.Service
    const instance = yield* ServerInstance.Service

    const reconcile = Effect.fn("SessionRecovery.reconcile")(function* (sessionID?: SessionID) {
      const rows = yield* database.db
        .select()
        .from(PartTable)
        .where(
          and(
            sessionID ? eq(PartTable.session_id, sessionID) : undefined,
            sql`json_extract(${PartTable.data}, '$.type') = 'tool'`,
            sql`json_extract(${PartTable.data}, '$.state.status') IN ('pending', 'running')`,
          ),
        )
        .all()
        .pipe(Effect.orDie)
      const open = rows
        .map((row) => ({ ...row.data, id: row.id, sessionID: row.session_id, messageID: row.message_id }))
        .filter((part): part is SessionV1.ToolPart => part.type === "tool")
      const stale = (yield* Effect.forEach(open, (part) =>
        Effect.map(isStale(part), (value) => (value ? [part] : [])),
      )).flat()
      if (stale.length === 0) return 0

      const end = Date.now()
      yield* Effect.forEach(stale, (part) => session.updatePart(interrupt(part, end)), { discard: true })
      yield* Effect.forEach(
        new Map(stale.map((part) => [part.messageID, part.sessionID])),
        ([messageID, messageSessionID]) =>
          MessageV2.get({ sessionID: messageSessionID, messageID }).pipe(
            Effect.flatMap((message) => {
              if (message.info.role !== "assistant" || message.info.time.completed) return Effect.void
              return session.updateMessage({
                ...message.info,
                time: { ...message.info.time, completed: end },
                finish: message.info.finish ?? "error",
              })
            }),
            Effect.catchTag("NotFoundError", () => Effect.void),
            Effect.provideService(Database.Service, database),
          ),
        { discard: true },
      )
      yield* Effect.logInfo("reconciled interrupted tool parts", { count: stale.length, sessionID })
      return stale.length
    })

    // Parts written before owners were stamped have no owner and are always treated as stale.
    const isStale = (part: SessionV1.ToolPart) => {
      const owner = part.metadata?.owner
      if (!isOwner(owner)) return Effect.succeed(true)
      return Effect.map(instance.isLive(owner), (live) => !live)
    }

    return Service.of({ reconcile })
  }),
)

function interrupt(part: SessionV1.ToolPart, end: number): SessionV1.ToolPart {
  const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : {}
  return {
    ...part,
    state: {
      status: "error",
      input: part.state.input,
      error: interruptedError,
      metadata: { ...metadata, interrupted: true },
      time: { start: "time" in part.state ? part.state.time.start : end, end },
    },
  }
}

/** Runs once when the runtime starts, then again after peer heartbeats expire to catch a fast restart. */
const startupLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const recovery = yield* Service
    const run = recovery
      .reconcile()
      .pipe(Effect.catchCause((cause) => Effect.logWarning("tool part reconciliation failed", { cause })))
    yield* run.pipe(Effect.andThen(Effect.sleep(ServerInstance.expiry)), Effect.andThen(run), Effect.forkScoped)
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Database.node, Session.node, ServerInstance.node, MessageV2.node],
})

export const startupNode = LayerNode.make({
  name: "session-recovery-startup",
  layer: Layer.merge(layer, startupLayer.pipe(Layer.provide(layer))),
  deps: [Database.node, Session.node, ServerInstance.node, MessageV2.node],
})

export * as SessionRecovery from "./recovery"
