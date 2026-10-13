export * as VcsWatch from "./vcs-watch"

import { Effect, Queue } from "effect"

// Shared repositories must not treat another worktree's index/HEAD as local changes.
export function metadata(file: string, sharedOnly = false) {
  const value = file.replaceAll("\\", "/")
  if (value.endsWith(".lock")) return false
  if (/^(refs(?:\/|$)|packed-refs$|config$|info\/exclude$|logs\/refs\/stash$)/.test(value)) return true
  if (sharedOnly) return false
  return /^(HEAD$|index$|sharedindex\.|config\.worktree$|(?:MERGE|REBASE|ORIG|CHERRY_PICK|REVERT|FETCH)_HEAD$|MERGE_(?:MSG|MODE)$|AUTO_MERGE$|rebase-(?:merge|apply)(?:\/|$)|sequencer(?:\/|$))/.test(
    value,
  )
}

// One worker per Location: wait for a quiet interval, but flush after at most one second.
export const coalesce = Effect.fn("VcsWatch.coalesce")(function* <E, R>(publish: () => Effect.Effect<void, E, R>) {
  const queue = yield* Queue.sliding<void>(1)
  const quiet = (remaining: number): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Effect.sleep(200)
      const pending = yield* Queue.takeBetween(queue, 0, 1)
      if (pending.length && remaining > 1) yield* quiet(remaining - 1)
    })
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        yield* Queue.take(queue)
        yield* quiet(5)
        yield* publish()
      }),
    ),
  )
  return () => Queue.offerUnsafe(queue, undefined)
})
