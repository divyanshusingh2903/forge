import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionBrowser } from "@opencode-ai/schema/session-browser"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Context, Deferred, Duration, Effect, Layer, Schema } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionID } from "@/session/schema"

export const LEASE_TTL_MS = 30_000
export const ATTACH_GRACE_MS = 10_000
export const MAX_CONTENT_BYTES = 5 * 1024 * 1024

export const Tab = SessionBrowser.Tab
export type Tab = SessionBrowser.Tab

export const Info = SessionBrowser.Info
export type Info = SessionBrowser.Info

export const StateInput = SessionBrowser.StateInput
export type StateInput = SessionBrowser.StateInput

export const AttachInput = SessionBrowser.AttachInput
export type AttachInput = SessionBrowser.AttachInput

export const ResultInput = SessionBrowser.ResultInput
export type ResultInput = SessionBrowser.ResultInput

export type Command = SessionBrowser.Command

export const Event = SessionBrowser.Event

export class PayloadTooLargeError extends Schema.TaggedErrorClass<PayloadTooLargeError>()(
  "BrowserPayloadTooLargeError",
  { message: Schema.String },
) {}

export class CommandError extends Schema.TaggedErrorClass<CommandError>()("BrowserCommandError", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly setState: (sessionID: SessionID, input: StateInput) => Effect.Effect<Info>
  readonly attach: (sessionID: SessionID, clientID: string) => Effect.Effect<Info>
  readonly detach: (sessionID: SessionID, clientID: string) => Effect.Effect<Info>
  readonly resolve: (sessionID: SessionID, input: ResultInput) => Effect.Effect<void, PayloadTooLargeError>
  /**
   * Sends a command to the session's browser panel and waits for its result. When no panel is attached it
   * waits up to `ATTACH_GRACE_MS` for one to attach (the app opens the panel on the command event) before failing.
   */
  readonly command: (
    sessionID: SessionID,
    command: Command,
    options: { readonly tabID?: string; readonly timeoutMs: number },
  ) => Effect.Effect<ResultInput, CommandError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Browser") {}

type Entry = {
  tabs: ReadonlyArray<Tab>
  activeTabID?: string
  leases: Map<string, number>
  attachSignal: Deferred.Deferred<void>
  waiters: Map<string, Deferred.Deferred<ResultInput>>
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    // Only tab metadata lives here; page content is pulled from the panel per command and never stored.
    const sessions = new Map<SessionID, Entry>()

    const entry = Effect.fnUntraced(function* (sessionID: SessionID) {
      const existing = sessions.get(sessionID)
      if (existing) return existing
      const created: Entry = {
        tabs: [],
        leases: new Map(),
        attachSignal: yield* Deferred.make<void>(),
        waiters: new Map(),
      }
      sessions.set(sessionID, created)
      return created
    })

    const unsubscribe = yield* events.listen((event) =>
      Effect.sync(() => {
        if (event.type !== SessionV1.Event.Deleted.type) return
        sessions.delete((event.data as { sessionID: SessionID }).sessionID)
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)

    const get = Effect.fn("Browser.get")(function* (sessionID: SessionID) {
      return toInfo(sessions.get(sessionID))
    })

    const setState = Effect.fn("Browser.setState")(function* (sessionID: SessionID, input: StateInput) {
      const current = yield* entry(sessionID)
      current.tabs = input.tabs
      current.activeTabID = input.activeTabID
      return toInfo(current)
    })

    const attach = Effect.fn("Browser.attach")(function* (sessionID: SessionID, clientID: string) {
      const current = yield* entry(sessionID)
      current.leases.set(clientID, Date.now() + LEASE_TTL_MS)
      yield* Deferred.succeed(current.attachSignal, undefined)
      current.attachSignal = yield* Deferred.make<void>()
      return toInfo(current)
    })

    const detach = Effect.fn("Browser.detach")(function* (sessionID: SessionID, clientID: string) {
      const current = sessions.get(sessionID)
      current?.leases.delete(clientID)
      return toInfo(current)
    })

    const resolve = Effect.fn("Browser.resolve")(function* (sessionID: SessionID, input: ResultInput) {
      if (byteLength(input.html) > MAX_CONTENT_BYTES || byteLength(input.text) > MAX_CONTENT_BYTES) {
        return yield* new PayloadTooLargeError({ message: "Browser page content exceeds 5MB limit" })
      }
      const waiter = sessions.get(sessionID)?.waiters.get(input.requestID)
      // Results for unknown or already timed-out requests are dropped.
      if (waiter) yield* Deferred.succeed(waiter, input)
    })

    const command = Effect.fn("Browser.command")(function* (
      sessionID: SessionID,
      command: Command,
      options: { readonly tabID?: string; readonly timeoutMs: number },
    ) {
      const current = yield* entry(sessionID)
      const attachWait = isAttached(current) ? 0 : Math.min(ATTACH_GRACE_MS, options.timeoutMs)
      const requestID = crypto.randomUUID()
      const result = yield* Deferred.make<ResultInput>()
      const attachSignal = current.attachSignal
      current.waiters.set(requestID, result)

      return yield* Effect.gen(function* () {
        yield* events.publish(Event.Command, {
          sessionID,
          requestID,
          ...(options.tabID ? { tabID: options.tabID } : {}),
          timeoutMs: attachWait + options.timeoutMs,
          command,
        })
        if (attachWait > 0) {
          yield* Deferred.await(attachSignal).pipe(
            Effect.timeoutOrElse({
              duration: Duration.millis(attachWait),
              orElse: () =>
                Effect.fail(
                  new CommandError({
                    message:
                      "The session browser panel is not open. Live browsing needs the Forge desktop app with the Browser panel open.",
                  }),
                ),
            }),
          )
        }
        const reply = yield* Deferred.await(result).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(options.timeoutMs),
            orElse: () =>
              Effect.fail(new CommandError({ message: `Browser did not respond within ${options.timeoutMs}ms` })),
          }),
        )
        if (!reply.ok) return yield* new CommandError({ message: reply.error ?? "Browser command failed" })
        return reply
      }).pipe(Effect.ensuring(Effect.sync(() => current.waiters.delete(requestID))))
    })

    return Service.of({ get, setState, attach, detach, resolve, command })
  }),
)

function isAttached(entry: Entry) {
  const now = Date.now()
  return [...entry.leases.values()].some((until) => until > now)
}

function toInfo(entry: Entry | undefined): Info {
  if (!entry) return { attached: false, tabs: [] }
  return {
    attached: isAttached(entry),
    ...(entry.activeTabID ? { activeTabID: entry.activeTabID } : {}),
    tabs: entry.tabs,
  }
}

function byteLength(value: string | undefined) {
  return value ? Buffer.byteLength(value, "utf8") : 0
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [EventV2Bridge.node],
})

export * as Browser from "."
