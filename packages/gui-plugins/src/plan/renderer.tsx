import { lazy, Show, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import {
  Command,
  createKeyed,
  MenuItem,
  Panel,
  Slot,
  type MountedSession,
  type PanelTab,
  type Plugin,
  type SessionRef,
} from "@opencode/plugin/gui"
import { ForgePlan } from "@opencode/schema/forge-plan"
import type PlanDefinition from "./index"

const TAB = "plan"

/**
 * The session's plan in the side region: a fifth launcher, "Review plan", next to Review, Browser, Terminal and Open
 * file, and a Plan tab that renders the plan file Forge's plan agent writes. The tab opens by itself when the agent
 * presents a plan for review. The server's plan plugin names the file in the session's metadata.
 */
const setup: Plugin.Setup<typeof PlanDefinition> = (ctx) => {
  const sessions = ctx.sessions
  const layout = ctx.layout
  const key = `${ctx.id}:${TAB}`

  const plan = (session: SessionRef) => ForgePlan.read(session.server.data.session.get(session.id)?.metadata)

  const open = (session: MountedSession) => layout.open(key, session, layout.narrow() ? undefined : { tab: "select" })

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
      id: "review",
      title: ctx.t("menu.review"),
      icon: "file-document",
      keybind: `${ctx.id}.open`,
      order: 40,
      run() {
        const session = sessions.current()

        if (session) open(session)
      },
    }
  })

  // A plan the agent presents opens for review, each time it presents it.
  createKeyed(
    () => {
      const session = sessions.current()
      const info = session && plan(session)

      return session && info?.status === "ready" ? `${session.key}\u0000${info.path}` : undefined
    },
    () => {
      const session = sessions.current()

      if (session) open(session)
    },
  )

  const PlanPanel = lazy(() => import("./panel"))

  // One tab object for every session, so a session switch never renders its trigger again.
  const tab: PanelTab = {
    id: TAB,
    get title() {
      return ctx.t("tab.title")
    },
    label: () => (
      <div class="flex items-center gap-1.5">
        <Icon name="file-document" size="small" />
        <span>{ctx.t("tab.title")}</span>
      </div>
    ),
  }

  ctx.add(Panel, {
    id: "main",
    region: "side",
    list: (input) => (input.open.includes(TAB) ? [tab] : []),
    render: (props) => (
      <Suspense>
        <PlanPanel session={props.session} screen={props.screen} plan={() => plan(props.session)} t={ctx.t} />
      </Suspense>
    ),
  })

  // While a plan is being written or waits for review, the title row says so and opens it. Decided plans drop out.
  ctx.add(Slot, {
    at: "session.header",
    order: 5,
    render: (input) => (
      <Show when={ForgePlan.open(plan(input.session)) ? plan(input.session) : undefined}>
        {(info) => {
          const label = () => ctx.t(info().status === "ready" ? "indicator.ready" : "indicator.drafting")

          return (
            <Tooltip placement="bottom" value={ctx.t("indicator.open")}>
              <button
                type="button"
                data-slot="plan-indicator"
                data-status={info().status}
                class="flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-[6px] px-2 text-[12px] [font-weight:530] text-v2-text-text-muted hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base data-[status=ready]:text-v2-text-text-base"
                aria-label={label()}
                onClick={() => open(input.session)}
              >
                <Icon name="file-document" size="small" />
                <Show when={!input.compact}>
                  <span>{label()}</span>
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
