import { createEffect, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { DelayedLoadingState } from "@opencode-ai/ui/loading-state"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { usePlatform } from "@/context/platform"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { ServerConnection } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeProjectsController } from "@/pages/home/home-projects-controller"
import { HomeProjects } from "@/pages/home/home-projects"
import { createHomeScrollController } from "@/pages/home/home-scroll-controller"
import { createPinnedSessions } from "@/pages/home/pinned-sessions"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const language = useLanguage()
  const [state, setState] = createStore({ debugTools: true })
  const global = useGlobal()
  const tabs = useTabs()
  const layout = useLayout()
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const scroll = createHomeScrollController(() => [])
  const pinned = createPinnedSessions()

  const openSession = (server: ServerConnection.Any, session: Session) => {
    const ctx = global.ensureServerCtx(server)
    ctx.projects.open(session.directory)
    ctx.projects.touch(session.directory)
    const tab = tabs.addSessionTab({ server: ServerConnection.key(server), sessionId: session.id })
    tabs.select(tab)
  }

  const deleteSession = async (server: ServerConnection.Any, session: Session) => {
    const ctx = global.ensureServerCtx(server)
    await ctx.sdk.api.session.remove({ sessionID: session.id })
    pinned.remove(ServerConnection.key(server), session.id)
  }

  const currentSession = () => {
    const route = layout.route()
    if (route.type !== "session") return undefined
    return { server: route.server, id: route.sessionId }
  }

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <div class="flex-1 min-h-0 min-w-0 flex flex-row">
        <HomeProjects
          projects={projects}
          scroll={scroll}
          onOpenSession={openSession}
          onDeleteSession={deleteSession}
          currentSession={currentSession}
          pinned={pinned}
        />
        <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
          <Suspense fallback={<DelayedLoadingState label={language.t("common.loading")} class="w-full" />}>
            {props.children}
          </Suspense>
        </main>
      </div>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
