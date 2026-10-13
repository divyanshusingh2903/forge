import { expect, test } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { TestClock } from "effect/testing"
import { VcsWatch } from "@opencode-ai/core/filesystem/vcs-watch"
import { testEffect } from "../lib/effect"

test("classifies Git metadata and excludes worktree-private state from shared observation", () => {
  for (const file of [
    "HEAD",
    "index",
    "refs/heads/main",
    "packed-refs",
    "MERGE_HEAD",
    "rebase-merge/head-name",
    "logs/refs/stash",
    "config",
  ])
    expect(VcsWatch.metadata(file)).toBe(true)
  for (const file of ["index.lock", "refs/heads/main.lock", "objects/ab/cd", "logs/HEAD", "worktrees/other/index"])
    expect(VcsWatch.metadata(file)).toBe(false)
  expect(VcsWatch.metadata("index", true)).toBe(false)
  expect(VcsWatch.metadata("refs/heads/main", true)).toBe(true)
})

const it = testEffect(Layer.empty)
it.effect("coalesces bursts and publishes again for subsequent activity", () =>
  Effect.gen(function* () {
    const count = yield* Ref.make(0)
    const notify = yield* VcsWatch.coalesce(() => Ref.update(count, (value) => value + 1))
    notify()
    notify()
    yield* TestClock.adjust(1000)
    expect(yield* Ref.get(count)).toBe(1)
    notify()
    yield* TestClock.adjust(1000)
    expect(yield* Ref.get(count)).toBe(2)
  }),
)

it.effect("disposal cancels a pending invalidation", () =>
  Effect.gen(function* () {
    const count = yield* Ref.make(0)
    yield* Effect.scoped(
      Effect.gen(function* () {
        const notify = yield* VcsWatch.coalesce(() => Ref.update(count, (value) => value + 1))
        notify()
        yield* TestClock.adjust(100)
      }),
    )
    yield* TestClock.adjust(1000)
    expect(yield* Ref.get(count)).toBe(0)
  }),
)
