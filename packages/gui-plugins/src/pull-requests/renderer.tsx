import { lazy, onCleanup, Show, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { showToast } from "@opencode/ui/toast"
import {
  Command,
  createKeyed,
  MenuItem,
  Panel,
  Slot,
  type MountedSession,
  type PanelTab,
  type Plugin,
} from "@opencode/plugin/gui"
import { ForgePullRequests } from "@opencode/schema/forge-pull-requests"
import type PullRequestsDefinition from "./index"

const TAB = "main"

const empty: ForgePullRequests.State = { items: [] }

/** Whether an item is open and its CI has finished with failures. */
const failing = (item: ForgePullRequests.Item) =>
  !ForgePullRequests.finished(item) && item.status?.ci?.status === "ok" && item.status.ci.failed > 0

/**
 * The session's tracked pull and merge requests: a "Pull requests" tab in the side region, and a header icon that
 * appears once the session tracks one, with a dot while CI is failing on an open one. The server's pull-requests plugin
 * owns the items and serves them over its RPC.
 */
const setup: Plugin.Setup<typeof PullRequestsDefinition> = (ctx) => {
  const sessions = ctx.sessions
  const layout = ctx.layout
  const key = `${ctx.id}:${TAB}`

  // The last state heard for each server and session. A session switched back to shows it until the refetch lands.
  const [states, setStates] = createStore<Record<string, ForgePullRequests.State>>({})
  const stateKey = (server: string, sessionID: string) => `${server}\u0000${sessionID}`
  const state = (session: MountedSession) => states[stateKey(session.server.id, session.id)] ?? empty

  const open = (session: MountedSession) => layout.open(key, session, layout.narrow() ? undefined : { tab: "select" })

  // Subscribes to the routed session's items: their current value, then every change. It runs again when another
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
      const rpc = session.server.client.rpc(ForgePullRequests.Definition)
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
      // A server without the plugin answers with an error, and the session tracks nothing.
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

  const call = <A,>(session: MountedSession, run: (rpc: ReturnType<typeof client>) => Promise<A>) => {
    const rpc = client(session)

    return run(rpc).catch((cause: unknown) => {
      showToast({
        variant: "error",
        title: ctx.t("common.requestFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      })

      return undefined
    })
  }

  const client = (session: MountedSession) => {
    const rpc = session.server.client.rpc(ForgePullRequests.Definition)
    const options = { location: { directory: session.directory } }

    return {
      refresh: (itemKey?: string) => rpc.refresh({ sessionID: session.id, key: itemKey }, options),
      track: (url: string) => rpc.track({ sessionID: session.id, url }, options),
      untrack: (itemKey: string) => rpc.untrack({ sessionID: session.id, key: itemKey }, options),
      autoFix: (itemKey: string, enabled: boolean) => rpc.autoFix({ sessionID: session.id, key: itemKey, enabled }, options),
    }
  }

  const apply = (session: MountedSession, next: ForgePullRequests.State | undefined) => {
    if (next) setStates(stateKey(session.server.id, session.id), next)
  }

  const actions = (session: MountedSession) => ({
    refresh: (itemKey?: string) => call(session, (rpc) => rpc.refresh(itemKey)).then((next) => apply(session, next)),
    track: (url: string) =>
      call(session, (rpc) => rpc.track(url)).then((result) => {
        if (result) apply(session, result.state)

        return result?.outcome
      }),
    untrack: (itemKey: string) => call(session, (rpc) => rpc.untrack(itemKey)).then((next) => apply(session, next)),
    autoFix: (itemKey: string, enabled: boolean) =>
      call(session, (rpc) => rpc.autoFix(itemKey, enabled)).then((next) => apply(session, next)),
  })

  ctx.add(Command, (): Command | undefined => {
    const session = sessions.current()

    if (!session) return undefined

    return {
      id: "open",
      title: ctx.t("command.open"),
      group: "View",
      editable: true,
      run: () => open(session),
    }
  })

  ctx.add(MenuItem, (): MenuItem | undefined => {
    if (!sessions.current()) return

    return {
      menu: "session.panel",
      id: "open",
      title: ctx.t("menu.open"),
      icon: "branch",
      keybind: `${ctx.id}.open`,
      order: 50,
      run() {
        const session = sessions.current()

        if (session) open(session)
      },
    }
  })

  const PullRequestsPanel = lazy(() => import("./panel"))

  // One tab object for every session, so a session switch never renders its trigger again.
  const tab: PanelTab = {
    id: TAB,
    get title() {
      return ctx.t("tab.title")
    },
    label: () => (
      <div class="flex items-center gap-1.5">
        <Icon name="branch" size="small" />
        <span>{ctx.t("tab.title")}</span>
      </div>
    ),
  }

  ctx.add(Panel, {
    id: TAB,
    region: "side",
    list: (input) => (input.open.includes(TAB) ? [tab] : []),
    render: (props) => (
      <Suspense>
        <PullRequestsPanel
          state={() => state(props.session)}
          actions={actions(props.session)}
          t={ctx.t}
          plural={ctx.plural}
        />
      </Suspense>
    ),
  })

  // Only a session that tracks something shows the icon, so sessions without pull requests carry no extra button.
  ctx.add(Slot, {
    at: "session.header",
    // After the context usage and the panel launchers, beside the plan indicator.
    order: 14,
    render: (input) => (
      <Show when={state(input.session).items.length > 0 ? state(input.session) : undefined}>
        {(current) => {
          const red = () => current().items.some(failing)

          const label = () =>
            red() ? `${ctx.t("indicator.label")}: ${ctx.t("indicator.failing")}` : ctx.t("indicator.label")

          return (
            <Tooltip placement="bottom" value={label()}>
              <button
                type="button"
                data-slot="pull-requests-indicator"
                data-failing={red() ? "" : undefined}
                class="relative flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-[6px] px-2 text-[12px] [font-weight:530] text-v2-text-text-muted hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base"
                aria-label={label()}
                onClick={() => open(input.session)}
              >
                <Icon name="branch" size="small" />
                <Show when={!input.compact}>
                  <span>{current().items.length}</span>
                </Show>
                <Show when={red()}>
                  <span
                    aria-hidden="true"
                    class="absolute top-1 right-1 size-1.5 rounded-full bg-v2-state-fg-danger"
                  />
                </Show>
              </button>
            </Tooltip>
          )
        }}
      </Show>
    ),
  })
}

export default setup
