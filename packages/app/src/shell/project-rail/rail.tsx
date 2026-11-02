import { createSignal, For, Show } from "solid-js"
import { Schema } from "effect"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { createHomeController } from "@/home/model"
import { createHomeProjectsController } from "@/home/projects/controller"
import { HomeProjects } from "@/home/projects/region"
import { HomeProjectAvatar } from "@/home/projects/view"
import { createHomeSessionsController, type HomeSessionRecord } from "@/home/sessions/controller"
import { createPinnedSessions } from "@/home/sessions/pinned"
import { useLanguage } from "@/runtime/i18n/language"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection } from "@/runtime/server/registry"
import { sessionLabel } from "@/session/title"
import { useCurrentRoute } from "@/shell/state/layout"

const ProjectRailSchema = Schema.Struct({
  expanded: Persistence.record(Persistence.fallback(Schema.Boolean, () => false)),
})

const SESSIONS_PER_PROJECT = 8

/** The persistent Projects sidebar: projects with their sessions underneath, and pinned sessions on top. */
export function ProjectRail(props: { onHide: () => void }) {
  const language = useLanguage()
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const pinned = createPinnedSessions()
  const route = useCurrentRoute()
  // Only the session on screen is highlighted; an open background tab is not.
  const isActive = (server: string, id: string) => {
    const current = route()

    return current.type === "session" && current.server === server && current.sessionId === id
  }
  const [state, setState] = persisted(Persist.global("project-rail"), ProjectRailSchema, { expanded: {} })

  const focused = () => {
    const conn = home.server.focused()

    return conn ? ServerConnection.key(conn) : undefined
  }
  // Sessions are indexed for the focused server only, so other servers' projects stay collapsed to their rows.
  const listsSessions = (server: ServerConnection.Any) => ServerConnection.key(server) === focused()
  const expandedKey = (server: ServerConnection.Any, worktree: string) => `${ServerConnection.key(server)}\0${worktree}`
  const isOpen = (server: ServerConnection.Any, worktree: string) =>
    listsSessions(server) &&
    (state.expanded[expandedKey(server, worktree)] ??
      (home.selection.value().server === ServerConnection.key(server) &&
        home.selection.value().directory === worktree))

  return (
    <HomeProjects
      projects={projects}
      rail={{
        rail: true,
        projectHighlight: () => route().type !== "session",
        railActions: () => (
          <Tooltip placement="bottom" value={language.t("sidebar.rail.hide")}>
            <IconButton
              data-action="project-rail-hide"
              variant="ghost-muted"
              size="large"
              class="titlebar-icon [&_[data-slot=icon-svg]]:text-v2-icon-icon-muted"
              icon={<Icon name="layout-left" />}
              aria-label={language.t("sidebar.rail.hide")}
              onClick={props.onHide}
            />
          </Tooltip>
        ),
        pinnedSection: () => (
          <PinnedSessions
            server={focused()}
            entries={pinned.entries()}
            find={sessions.data.sidebar.find}
            sessions={sessions}
            pinned={pinned}
            active={isActive}
          />
        ),
        sessionsOpen: (server, project) => isOpen(server, project.worktree),
        onToggleSessions: (server, project) => {
          if (!listsSessions(server)) return
          setState("expanded", expandedKey(server, project.worktree), !isOpen(server, project.worktree))
        },
        projectSessions: (server, project) => (
          <Show when={listsSessions(server)}>
            <ProjectSessions
              server={ServerConnection.key(server)}
              records={sessions.data.sidebar.forProject(project.worktree)}
              sessions={sessions}
              pinned={pinned}
              active={isActive}
            />
          </Show>
        ),
      }}
    />
  )
}

type RailSessionsController = ReturnType<typeof createHomeSessionsController>

function ProjectSessions(props: {
  server: string
  records: HomeSessionRecord[]
  sessions: RailSessionsController
  pinned: ReturnType<typeof createPinnedSessions>
  active: (server: string, id: string) => boolean
}) {
  const language = useLanguage()
  const [limit, setLimit] = createSignal(SESSIONS_PER_PROJECT)

  return (
    <div class="flex min-w-0 flex-col gap-0.5 pb-1">
      <Show
        when={props.records.length > 0}
        fallback={
          <div class="h-7 pl-7 pr-1.5 text-v2-text-text-faint [font-weight:440] leading-7">
            {language.t("sidebar.rail.sessions.empty")}
          </div>
        }
      >
        <For each={props.records.slice(0, limit())}>
          {(record) => (
            <RailSession
              server={props.server}
              record={record}
              sessions={props.sessions}
              pinned={props.pinned}
              active={props.active}
            />
          )}
        </For>
        <Show when={props.records.length > limit()}>
          <button
            type="button"
            class="h-7 cursor-default rounded-[6px] pl-7 pr-1.5 text-left text-v2-text-text-faint [font-weight:440] hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base"
            onClick={() => setLimit((value) => value + SESSIONS_PER_PROJECT)}
          >
            {language.t("sidebar.rail.sessions.more")}
          </button>
        </Show>
      </Show>
    </div>
  )
}

function PinnedSessions(props: {
  server: string | undefined
  entries: { server: string; id: string }[]
  find: (id: string) => HomeSessionRecord | undefined
  sessions: RailSessionsController
  pinned: ReturnType<typeof createPinnedSessions>
  active: (server: string, id: string) => boolean
}) {
  const language = useLanguage()
  const records = () =>
    props.entries
      .filter((entry) => entry.server === props.server)
      .flatMap((entry) => {
        const record = props.find(entry.id)

        return record ? [record] : []
      })

  return (
    <Show when={props.server && records().length > 0}>
      <div class="flex min-w-0 flex-col gap-0.5 pr-3" data-slot="project-rail-pinned">
        <div class="h-7 pl-1.5 text-v2-text-text-muted [font-weight:530] leading-7">
          {language.t("sidebar.rail.pinned")}
        </div>
        <For each={records()}>
          {(record) => (
            <RailSession
              server={props.server!}
              record={record}
              sessions={props.sessions}
              pinned={props.pinned}
              active={props.active}
              flush
            />
          )}
        </For>
      </div>
    </Show>
  )
}

function RailSession(props: {
  server: string
  record: HomeSessionRecord
  sessions: RailSessionsController
  pinned: ReturnType<typeof createPinnedSessions>
  active: (server: string, id: string) => boolean
  flush?: boolean
}) {
  const language = useLanguage()
  const isPinned = () => props.pinned.isPinned(props.server, props.record.session.id)
  const label = () => sessionLabel(props.record.session)
  const active = () => props.active(props.server, props.record.session.id)

  return (
    <div
      class="group/session relative flex h-7 min-w-0 items-center rounded-[6px]"
      data-home-row
      data-selected={active() ? "" : undefined}
    >
      <button
        type="button"
        data-component="project-rail-session"
        data-selected={active() ? "" : undefined}
        class="flex h-7 w-full min-w-0 cursor-default items-center gap-2 rounded-[6px] bg-transparent pr-7 text-left text-v2-text-text-muted [font-weight:440] transition-[background-color,color] duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base focus-visible:bg-v2-background-bg-layer-01 focus-visible:outline-none"
        style={{ "padding-inline-start": props.flush ? "6px" : "28px" }}
        onClick={() => props.sessions.session.open(props.record.session)}
      >
        {/* Pinned sessions sit outside their project, so each carries its project's icon. */}
        <Show when={props.flush}>
          <HomeProjectAvatar project={props.record.project} />
        </Show>
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label()}</span>
      </button>
      <div
        class="absolute bottom-0 right-1 top-0 flex items-center opacity-0 group-hover/session:opacity-100 focus-within:opacity-100"
        classList={{ "opacity-100": isPinned() }}
      >
        <Tooltip placement="right" value={language.t(isPinned() ? "sidebar.rail.unpin" : "sidebar.rail.pin")}>
          <IconButton
            data-action="project-rail-pin"
            variant="ghost-muted"
            size="small"
            icon={<Icon name={isPinned() ? "pin-filled" : "pin"} size="small" />}
            aria-label={language.t(isPinned() ? "sidebar.rail.unpin" : "sidebar.rail.pin")}
            aria-pressed={isPinned()}
            onClick={() => props.pinned.toggle(props.server, props.record.session.id)}
          />
        </Tooltip>
      </div>
    </div>
  )
}
