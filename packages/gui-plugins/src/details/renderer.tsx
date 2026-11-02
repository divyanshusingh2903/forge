import { lazy, onCleanup, Show, Suspense } from "solid-js"
import { Panel, Slot, Style, usePanel, type Plugin } from "@opencode/plugin/gui"
import type Details from "./index"
import { DetailsHeader, McpHeader, type DetailsMenus } from "./popover"
import { BuiltinSlot, onIdle } from "@opencode/plugin/gui/builtin"

const setup: Plugin.Setup<typeof Details> = (ctx) => {
  const sessions = ctx.sessions

  const menus: DetailsMenus = new Set()

  // Both popovers share the stylesheet, added by whichever opens first.
  const styles = once(() => import("./details.css?inline").then((css) => void ctx.add(Style, css.default)))
  const DetailsPanel = lazy(() => Promise.all([import("./panel"), styles()]).then(([panel]) => panel))
  const McpPanel = lazy(() => Promise.all([import("./mcp-panel"), styles()]).then(([panel]) => panel))

  const LocationMenu = lazy(() => import("./location-menu"))
  const LocationWorkspace = lazy(() => import("./location-workspace"))

  // Compile the panel while the app idles, so the first open renders at once.
  onCleanup(
    onIdle(() => {
      void DetailsPanel.preload()
      void McpPanel.preload()
      void LocationMenu.preload()
      void LocationWorkspace.preload()
    }),
  )

  // Between the context usage (order 10) and the details button.
  ctx.add(Slot, {
    at: "session.header",
    order: 15,
    render: (input) => <McpHeader session={input.session} panel={McpPanel} />,
  })

  ctx.add(Slot, {
    at: "session.header",
    order: 20,
    render: (input) => (
      <DetailsHeader menus={menus} session={input.session} active={input.active} panel={DetailsPanel} />
    ),
  })

  ctx.add(Slot, {
    at: "session.location.menu",
    render: (input) => (
      <Suspense>
        <LocationMenu session={input.session} screen={input.screen} shown={input.shown} />
      </Suspense>
    ),
  })

  ctx.add(BuiltinSlot, {
    at: "session.location.workspace",
    render: (input) => (
      <Suspense>
        <LocationWorkspace {...input} />
      </Suspense>
    ),
  })

  // The narrow-screen details drawer, offered for sessions of a project, subagents included.
  const panel: Panel = {
    id: "main",
    region: "side",
    mobile: {
      get title() {
        return ctx.t("title")
      },
      order: 50,
      kind: "drawer",
      icon: "info",
    },
    list: () => [],
    render: (props) => {
      const frame = usePanel()

      return (
        <Show when={props.session.project}>
          <Suspense>
            <DetailsPanel mobile shown={frame.visible()} session={props.session} />
          </Suspense>
        </Show>
      )
    },
  }

  ctx.add(Panel, () => {
    const session = sessions.current()

    if (!session?.project) return

    return panel
  })
}

function once<T>(run: () => Promise<T>) {
  let pending: Promise<T> | undefined

  return () => (pending ??= run())
}

export default setup
