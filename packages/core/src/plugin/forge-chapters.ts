export * as ForgeChaptersPlugin from "./forge-chapters.js"

import { define } from "@opencode/plugin/effect/plugin"
import { ForgeChapters } from "@opencode/schema/forge-chapters"
import { Clock, Effect, Option, Schema, Scope, Semaphore, Stream } from "effect"
import { LinkPreview } from "../link-preview.js"

const PREFIX = "session:"
const decodeState = Schema.decodeUnknownOption(ForgeChapters.State)
const empty: ForgeChapters.State = { chapters: [], seen: [] }

export const AFTER_COMPACTION = "After compaction"

type State = ForgeChapters.State
type Chapter = ForgeChapters.Chapter

// Message IDs ascend with creation, so sorting by the turn and then the anchor follows the transcript. A prompt
// that waited in the queue was created before the replies it follows, so it can sort slightly early.
const ordered = (chapters: ReadonlyArray<Chapter>) =>
  chapters.toSorted(
    (a, b) => a.turnMessageID.localeCompare(b.turnMessageID) || a.anchorMessageID.localeCompare(b.anchorMessageID),
  )

/** Starts a chapter at a message the user pinned. A message that already starts one keeps it. */
export function pin(
  state: State,
  input: { messageID: string; turnMessageID: string; role: ForgeChapters.Role; title: string },
  now: number,
): State {
  if (state.chapters.some((chapter) => chapter.anchorMessageID === input.messageID)) return state
  return {
    ...state,
    chapters: ordered([
      ...state.chapters,
      {
        title: ForgeChapters.title(input.title) || "Chapter",
        anchorMessageID: input.messageID,
        turnMessageID: input.turnMessageID,
        role: input.role,
        source: "pin",
        createdAt: now,
      },
    ]),
  }
}

export function rename(state: State, messageID: string, title: string): State {
  const next = ForgeChapters.title(title)
  if (!next || !state.chapters.some((chapter) => chapter.anchorMessageID === messageID && chapter.title !== next))
    return state
  return {
    ...state,
    chapters: state.chapters.map((chapter) =>
      chapter.anchorMessageID === messageID ? { ...chapter, title: next, renamed: true } : chapter,
    ),
  }
}

export function remove(state: State, messageID: string): State {
  if (!state.chapters.some((chapter) => chapter.anchorMessageID === messageID)) return state
  return { ...state, chapters: state.chapters.filter((chapter) => chapter.anchorMessageID !== messageID) }
}

/** A compaction ended: the agent's next message starts a chapter, unless one is already waiting. */
export function compacted(state: State): State {
  if (state.pending) return state
  return { ...state, pending: { source: "compaction", title: AFTER_COMPACTION } }
}

/**
 * The user sent a message. The first issue or pull request it links that the Session has not met asks for a chapter;
 * every one it links counts as met. Without one, a chapter that waits after a compaction takes this message's title.
 */
export function prompted(state: State, input: { messageID: string; text: string }): State {
  const fresh = ForgeChapters.references(input.text).filter((item) => !state.seen.includes(item.key))
  const first = fresh[0]
  if (first)
    return {
      ...state,
      seen: [...state.seen, ...fresh.map((item) => item.key)],
      pending: {
        source: "reference",
        title: first.label,
        reference: first.key,
        turnMessageID: input.messageID,
        waitFor: input.messageID,
      },
    }
  if (state.pending?.source !== "compaction" || state.pending.turnMessageID) return state
  return {
    ...state,
    pending: {
      source: "compaction",
      title: ForgeChapters.title(input.text) || AFTER_COMPACTION,
      turnMessageID: input.messageID,
      waitFor: input.messageID,
    },
  }
}

/** The message a waiting chapter belongs to reached the transcript, so the agent's next message is its anchor. */
export function delivered(state: State, messageID: string): State {
  if (state.pending?.waitFor !== messageID) return state
  return { ...state, pending: { ...state.pending, waitFor: undefined } }
}

/** The message a waiting chapter belongs to was withdrawn before delivery. Its reference may ask again later. */
export function cancelled(state: State, messageID: string): State {
  const pending = state.pending
  if (pending?.waitFor !== messageID) return state
  if (pending.source === "compaction") return { ...state, pending: { source: "compaction", title: AFTER_COMPACTION } }
  return { ...state, seen: state.seen.filter((key) => key !== pending.reference), pending: undefined }
}

/** The agent started a message. A waiting chapter anchors on it: automatic chapters only ever sit on the agent's own. */
export function stepped(state: State, assistantMessageID: string, now: number): State {
  const pending = state.pending
  if (!pending || pending.waitFor) return state
  if (state.chapters.some((chapter) => chapter.anchorMessageID === assistantMessageID))
    return { ...state, pending: undefined }
  return {
    ...state,
    pending: undefined,
    chapters: ordered([
      ...state.chapters,
      {
        title: pending.title,
        anchorMessageID: assistantMessageID,
        // A compaction the agent ran on without a new prompt has no user message of its own to name.
        turnMessageID: pending.turnMessageID ?? assistantMessageID,
        role: "assistant",
        source: pending.source,
        reference: pending.reference,
        createdAt: now,
      },
    ]),
  }
}

/** A revert removed the messages from `to` on, and the chapters that started in them. */
export function reverted(state: State, to: string): State {
  const chapters = state.chapters.filter((chapter) => chapter.anchorMessageID < to && chapter.turnMessageID < to)
  const pending = state.pending?.turnMessageID && state.pending.turnMessageID >= to ? undefined : state.pending
  if (chapters.length === state.chapters.length && pending === state.pending) return state
  return { ...state, chapters, pending }
}

/** A lookup named a reference: its chapter, waiting or started, takes the real title unless the user renamed it. */
export function named(state: State, reference: string, title: string): State {
  const next = ForgeChapters.title(title)
  if (!next) return state
  const pending =
    state.pending?.reference === reference && state.pending.title !== next ? { ...state.pending, title: next } : state.pending
  const stale = (chapter: Chapter) => chapter.reference === reference && !chapter.renamed && chapter.title !== next
  if (pending === state.pending && !state.chapters.some(stale)) return state
  return {
    ...state,
    pending,
    chapters: state.chapters.map((chapter) => (stale(chapter) ? { ...chapter, title: next } : chapter)),
  }
}

export const Plugin = define({
  id: "forge.chapters",
  effect: Effect.fn(function* (ctx) {
    const previews = yield* LinkPreview.Service
    const scope = yield* Scope.Scope
    // Storage has no compare-and-set. Every read-modify-write of a session's state goes through this, so a pin and a
    // session event cannot overwrite each other.
    const lock = yield* Semaphore.make(1)

    const read = Effect.fn("ForgeChapters.read")(function* (sessionID: string) {
      return Option.getOrElse(decodeState(yield* ctx.storage.get(PREFIX + sessionID)), () => empty)
    })

    // The RPC's handlers use `update`, which publishes through the RPC, so the publisher is wired once it is registered.
    const publisher = { emit: (_sessionID: string, _state: State): Effect.Effect<void> => Effect.void }

    // Applies `change` to the session's state under the lock, and stores and publishes the result when it differs.
    const update = (sessionID: string, change: (state: State) => State) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* read(sessionID)
          const next = change(current)
          if (next === current) return current
          yield* next.chapters.length === 0 && next.seen.length === 0 && !next.pending
            ? ctx.storage.remove(PREFIX + sessionID)
            : ctx.storage.set(PREFIX + sessionID, Schema.encodeSync(ForgeChapters.State)(next))
          yield* publisher.emit(sessionID, next)
          return next
        }),
      )

    const rpc = yield* ctx.rpc
      .register(ForgeChapters.Definition, {
        list: (input) => read(input.sessionID),
        pin: (input) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            return yield* update(input.sessionID, (state) => pin(state, input, now))
          }),
        rename: (input) => update(input.sessionID, (state) => rename(state, input.messageID, input.title)),
        remove: (input) => update(input.sessionID, (state) => remove(state, input.messageID)),
      })
      .pipe(Effect.orDie)
    publisher.emit = (sessionID, state) =>
      rpc.events
        .emit("changed", { sessionID, state })
        .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to publish chapter changes", { cause })))

    // Titles a reference chapter from its issue or pull request. A failed lookup leaves the `owner/repo#12` label.
    const name = Effect.fn("ForgeChapters.name")(function* (sessionID: string, text: string, before: State) {
      const pending = (yield* read(sessionID)).pending
      const key = pending?.reference
      if (!key || before.pending?.reference === key) return
      const found = ForgeChapters.references(text).find((item) => item.key === key)
      if (!found) return
      const result = yield* previews.resolve(found.preview)
      if (result.outcome !== "ok" || !result.title) return
      const title = `#${found.preview.number} ${result.title}`
      yield* update(sessionID, (state) => named(state, key, title))
    })

    yield* ctx.event
      .subscribe({
        types: [
          "session.compaction.ended",
          "session.inbox.enqueued",
          "session.inbox.delivered",
          "session.inbox.cancelled",
          "session.step.started",
          "session.revert.committed",
          "session.deleted",
        ],
      })
      .pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const sessionID = event.data.sessionID
            if (event.type === "session.deleted") return yield* ctx.storage.remove(PREFIX + sessionID)
            if (event.type === "session.compaction.ended") return yield* update(sessionID, compacted)
            if (event.type === "session.inbox.delivered")
              return yield* update(sessionID, (state) => delivered(state, event.data.inboxID))
            if (event.type === "session.inbox.cancelled")
              return yield* update(sessionID, (state) => cancelled(state, event.data.inboxID))
            if (event.type === "session.revert.committed")
              return yield* update(sessionID, (state) => reverted(state, event.data.to))
            if (event.type === "session.step.started") {
              const now = yield* Clock.currentTimeMillis
              return yield* update(sessionID, (state) => stepped(state, event.data.assistantMessageID, now))
            }
            // Only what the user typed asks for a chapter: synthetic prompts are Forge's own.
            if (event.data.item.type !== "user") return
            const text = event.data.item.payload.text
            const before = yield* read(sessionID)
            yield* update(sessionID, (state) => prompted(state, { messageID: event.data.inboxID, text }))
            yield* name(sessionID, text, before).pipe(Effect.ignore, Effect.forkIn(scope))
          }).pipe(Effect.catchCause((cause) => Effect.logWarning("failed to update chapters", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
  }),
})
