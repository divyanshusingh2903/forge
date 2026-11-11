import { lazy, onCleanup, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@opencode/ui/toast"
import { createKeyed, type MountedSession, type Plugin } from "@opencode/plugin/gui"
import { BuiltinMessageAction, BuiltinSlot } from "@opencode/plugin/gui/builtin"
import { ForgeChapters } from "@opencode/schema/forge-chapters"
import type ChaptersDefinition from "./index"

const empty: ForgeChapters.State = { chapters: [], seen: [] }

/**
 * The session's chapters: a pin on every message that starts or removes a chapter there, and notches on the
 * transcript's edge that open into the list and jump to each. The server's chapters plugin owns them, including the
 * ones it starts by itself, and serves them over its RPC.
 */
const setup: Plugin.Setup<typeof ChaptersDefinition> = (ctx) => {
  const sessions = ctx.sessions

  // The last state heard for each server and session. A session switched back to shows it until the refetch lands.
  const [states, setStates] = createStore<Record<string, ForgeChapters.State>>({})
  const stateKey = (server: string, sessionID: string) => `${server}\u0000${sessionID}`
  const state = (session: MountedSession) => states[stateKey(session.server.id, session.id)] ?? empty

  // Subscribes to the routed session's chapters: their current value, then every change. It runs again when another
  // session is routed, the session moves, or its server reconnects, since changes published meanwhile were missed.
  createKeyed(
    () => {
      const session = sessions.current()

      return session?.server.connected ? stateKey(session.server.id, session.id) + `\u0000${session.directory}` : undefined
    },
    () => {
      const session = sessions.current()

      if (!session) return

      const server = session.server.id
      const rpc = session.server.client.rpc(ForgeChapters.Definition)
      const controller = new AbortController()
      // A change that arrives before the snapshot is newer than it.
      const heard = { value: false }
      onCleanup(() => controller.abort())
      onCleanup(
        rpc.events.on(
          "changed",
          (event) => {
            if (event.data.sessionID === session.id) heard.value = true
            setStates(stateKey(server, event.data.sessionID), event.data.state)
          },
          { signal: controller.signal },
        ),
      )
      // A server without the plugin answers with an error, and the session has no chapters.
      void rpc
        .list({ sessionID: session.id }, { location: { directory: session.directory }, signal: controller.signal })
        .then(
          (next) => {
            if (!controller.signal.aborted && !heard.value) setStates(stateKey(server, session.id), next)
          },
          () => undefined,
        )
    },
  )

  // Runs one write and shows its result at once; the `changed` event that follows carries the same state.
  const write = (
    session: MountedSession,
    run: (
      rpc: ReturnType<typeof session.server.client.rpc<typeof ForgeChapters.Definition>>,
      options: { location: { directory: string } },
    ) => Promise<ForgeChapters.State>,
  ) =>
    run(session.server.client.rpc(ForgeChapters.Definition), { location: { directory: session.directory } }).then(
      (next) => setStates(stateKey(session.server.id, session.id), next),
      (cause: unknown) => {
        showToast({
          variant: "error",
          title: ctx.t("common.requestFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
        })
      },
    )

  const pinned = (session: MountedSession, messageID: string) =>
    state(session).chapters.some((chapter) => chapter.anchorMessageID === messageID)

  ctx.add(BuiltinMessageAction, {
    id: "pin",
    icon: (active) => (active ? "pin-filled" : "pin"),
    label: (active) => ctx.t(active ? "pin.remove" : "pin.add"),
    active: (input) => pinned(input.session, input.messageID),
    run: (input) =>
      write(input.session, (rpc, options) =>
        pinned(input.session, input.messageID)
          ? rpc.remove({ sessionID: input.session.id, messageID: input.messageID }, options)
          : rpc.pin(
              {
                sessionID: input.session.id,
                messageID: input.messageID,
                turnMessageID: input.turnMessageID,
                role: input.role,
                title: ForgeChapters.title(input.text),
              },
              options,
            ),
      ),
  })

  const ChaptersRail = lazy(() => import("./rail"))

  ctx.add(BuiltinSlot, {
    at: "session.timeline.rail",
    render: (input) => (
      <Suspense>
        <ChaptersRail
          state={() => state(input.session)}
          turnMessageID={() => input.turnMessageID}
          actions={{
            jump: (chapter) =>
              input.screen.revealMessage({ turnMessageID: chapter.turnMessageID, messageID: chapter.anchorMessageID }),
            rename: (messageID, title) =>
              write(input.session, (rpc, options) => rpc.rename({ sessionID: input.session.id, messageID, title }, options)),
            remove: (messageID) =>
              write(input.session, (rpc, options) => rpc.remove({ sessionID: input.session.id, messageID }, options)),
          }}
          t={ctx.t}
        />
      </Suspense>
    ),
  })
}

export default setup
