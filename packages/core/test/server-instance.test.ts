import { describe, expect, test } from "bun:test"
import path from "path"
import { eq } from "drizzle-orm"
import { Duration, Effect } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ServerInstance } from "@opencode-ai/core/server-instance"
import { ServerInstanceTable } from "@opencode-ai/core/server-instance/sql"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Database.node, ServerInstance.node])))

const insertPeer = (input: { id: string; boot?: string; heartbeat: number }) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    yield* database.db
      .insert(ServerInstanceTable)
      .values({
        id: input.id,
        boot_id: input.boot,
        pid: 1,
        time_started: input.heartbeat,
        time_heartbeat: input.heartbeat,
      })
      .run()
      .pipe(Effect.orDie)
  })

describe("ServerInstance", () => {
  it.effect("registers itself and treats its own owner as live", () =>
    Effect.gen(function* () {
      const instance = yield* ServerInstance.Service
      const database = yield* Database.Service
      const row = yield* database.db
        .select()
        .from(ServerInstanceTable)
        .where(eq(ServerInstanceTable.id, instance.owner.instance))
        .get()
        .pipe(Effect.orDie)

      expect(row?.pid).toBe(process.pid)
      expect(yield* instance.isLive(instance.owner)).toBe(true)
    }),
  )

  it.effect("treats a peer with a fresh heartbeat as live", () =>
    Effect.gen(function* () {
      const instance = yield* ServerInstance.Service
      yield* TestClock.adjust(Duration.minutes(10))
      yield* insertPeer({
        id: "srv_peer",
        boot: instance.owner.boot,
        heartbeat: Duration.toMillis(Duration.minutes(10)),
      })

      expect(yield* instance.isLive({ instance: "srv_peer", boot: instance.owner.boot })).toBe(true)
    }),
  )

  it.effect("treats a peer with an expired heartbeat as dead", () =>
    Effect.gen(function* () {
      const instance = yield* ServerInstance.Service
      yield* insertPeer({ id: "srv_peer", boot: instance.owner.boot, heartbeat: 0 })
      yield* TestClock.adjust(ServerInstance.expiry)

      expect(yield* instance.isLive({ instance: "srv_peer", boot: instance.owner.boot })).toBe(false)
    }),
  )

  it.effect("treats an unknown owner as dead", () =>
    Effect.gen(function* () {
      const instance = yield* ServerInstance.Service

      expect(yield* instance.isLive({ instance: "srv_missing" })).toBe(false)
    }),
  )

  it.effect("treats an owner from a previous boot as dead without waiting for expiry", () =>
    Effect.gen(function* () {
      const instance = yield* ServerInstance.Service
      if (!instance.owner.boot) return
      yield* insertPeer({ id: "srv_peer", boot: "previous-boot", heartbeat: 0 })

      expect(yield* instance.isLive({ instance: "srv_peer", boot: "previous-boot" })).toBe(false)
    }),
  )

  test("removes its row when the layer shuts down", async () => {
    await using tmp = await tmpdir()
    const database = Database.layerFromPath(path.join(tmp.path, "instance.sqlite"))
    const owner = await Effect.gen(function* () {
      const instance = yield* ServerInstance.Service
      return instance.owner
    }).pipe(
      Effect.provide(AppNodeBuilder.build(ServerInstance.node, [[Database.node, database]])),
      Effect.scoped,
      Effect.runPromise,
    )
    const row = await Effect.gen(function* () {
      const { db } = yield* Database.Service
      return yield* db
        .select()
        .from(ServerInstanceTable)
        .where(eq(ServerInstanceTable.id, owner.instance))
        .get()
        .pipe(Effect.orDie)
    }).pipe(Effect.provide(database), Effect.scoped, Effect.runPromise)

    expect(row).toBeUndefined()
  })
})
