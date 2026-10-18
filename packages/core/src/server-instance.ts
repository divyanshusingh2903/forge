export * as ServerInstance from "./server-instance"

import { readFile } from "node:fs/promises"
import { eq, lt } from "drizzle-orm"
import { Clock, Context, Duration, Effect, Layer, Schedule, Schema } from "effect"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { Identifier } from "./id/id"
import { ServerInstanceTable } from "./server-instance/sql"

/** Stamped on records whose lifetime is tied to the server process that created them. */
export const Owner = Schema.Struct({
  instance: Schema.String,
  boot: Schema.optional(Schema.String),
}).annotate({ identifier: "ServerInstance.Owner" })
export type Owner = typeof Owner.Type

export const heartbeat = Duration.seconds(15)
export const expiry = Duration.seconds(60)

// Generated once per OS process so every runtime that builds this layer shares one identity.
const id = Identifier.ascending("server")

export interface Interface {
  readonly owner: Owner
  readonly isLive: (owner: Owner) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ServerInstance") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const boot = yield* readBootID
    const started = yield* Clock.currentTimeMillis

    const beat = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      // Upsert so the row comes back if another runtime in this process removed it on shutdown.
      yield* db
        .insert(ServerInstanceTable)
        .values({ id, boot_id: boot, pid: process.pid, time_started: started, time_heartbeat: now })
        .onConflictDoUpdate({ target: ServerInstanceTable.id, set: { time_heartbeat: now } })
        .run()
      yield* db
        .delete(ServerInstanceTable)
        .where(lt(ServerInstanceTable.time_heartbeat, now - Duration.toMillis(expiry)))
        .run()
    }).pipe(Effect.orDie)

    yield* beat
    yield* beat.pipe(Effect.repeat(Schedule.spaced(heartbeat)), Effect.ignore, Effect.forkScoped)
    yield* Effect.addFinalizer(() =>
      db.delete(ServerInstanceTable).where(eq(ServerInstanceTable.id, id)).run().pipe(Effect.ignore),
    )

    const owner: Owner = boot ? { instance: id, boot } : { instance: id }

    const isLive = Effect.fn("ServerInstance.isLive")(function* (input: Owner) {
      if (input.instance === id) return true
      // A different boot ID means the machine rebooted, so the owner cannot still be running.
      if (boot && input.boot && input.boot !== boot) return false
      const row = yield* db
        .select()
        .from(ServerInstanceTable)
        .where(eq(ServerInstanceTable.id, input.instance))
        .get()
        .pipe(Effect.orDie)
      if (!row) return false
      if (boot && row.boot_id && row.boot_id !== boot) return false
      return (yield* Clock.currentTimeMillis) - row.time_heartbeat < Duration.toMillis(expiry)
    })

    return Service.of({ owner, isLive })
  }),
)

const readBootID =
  process.platform === "linux"
    ? Effect.tryPromise(() => readFile("/proc/sys/kernel/random/boot_id", "utf8")).pipe(
        Effect.map((text) => text.trim() || undefined),
        Effect.orElseSucceed(() => undefined),
      )
    : Effect.succeed(undefined)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
