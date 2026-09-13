import type { Accessor } from "solid-js"
import type { ServerConnection } from "@/context/server"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { PinnedSessions } from "./pinned-sessions"
import type { HomeProjectsController } from "./home-projects-controller"
import { HomeProjectsView } from "./home-projects-view"
import type { HomeScrollController } from "./home-scroll-controller"

export function HomeProjects(props: {
  projects: HomeProjectsController
  scroll: HomeScrollController
  onOpenSession: (server: ServerConnection.Any, session: Session) => void
  onDeleteSession: (server: ServerConnection.Any, session: Session) => void | Promise<void>
  currentSession?: Accessor<{ server?: string; id?: string } | undefined>
  pinned: PinnedSessions
}) {
  return (
    <HomeProjectsView
      language={props.projects.copy.language}
      servers={props.projects.server.list}
      projects={props.projects.project.list}
      recentlyClosed={props.projects.project.recentlyClosed}
      selection={props.projects.selection.value}
      homedir={props.projects.project.homedir}
      serverHealth={props.projects.server.health}
      projectsForServer={props.projects.server.projects}
      collapsed={props.projects.server.collapsed}
      canDefaultServer={props.projects.server.canDefault}
      defaultServerKey={props.projects.server.defaultKey}
      canRevealProject={props.projects.project.canReveal}
      unseenCount={props.projects.project.unseenCount}
      onWheel={props.scroll.viewport.containWheel}
      onChooseProject={props.projects.project.choose}
      onFocusServer={props.projects.server.focus}
      onToggleCollapsed={props.projects.server.toggleCollapsed}
      onEditServer={props.projects.server.edit}
      onSetDefaultServer={props.projects.server.setDefault}
      onRemoveServer={props.projects.server.remove}
      onMoveProject={props.projects.project.move}
      onSelectProject={props.projects.project.select}
      onAddProjects={props.projects.project.add}
      onOpenProjectNewSession={props.projects.project.openNewSession}
      onEditProject={props.projects.project.edit}
      onRevealProject={props.projects.project.reveal}
      onClearNotifications={props.projects.project.clearNotifications}
      onCloseProject={props.projects.project.close}
      onOpenSettings={props.projects.utility.settings}
      onOpenHelp={props.projects.utility.help}
      onOpenSession={props.onOpenSession}
      onDeleteSession={props.onDeleteSession}
      currentSession={props.currentSession}
      pinned={props.pinned}
    />
  )
}
