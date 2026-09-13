import { type Accessor, createMemo, createSignal, For, type JSX, onCleanup, Show, splitProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { getProjectAvatarVariant, type HomeProjectSelection, type LocalProject } from "@/context/layout"
import { ServerConnection } from "@/context/server"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { compareSessionTime, displayName, getProjectAvatarSource, sortedRootSessions } from "@/pages/layout/helpers"
import { ServerRowMenuView, serverMenuLabels } from "@/components/server/server-row-menu"
import { ServerHealthIndicator } from "@/components/server/server-row"
import { type ServerHealth } from "@/utils/server-health"
import { fileManagerApp } from "@/utils/file-manager"
import { sessionTitle } from "@/utils/session-title"
import { Persist, persisted } from "@/utils/persist"
import type { PinnedSessions } from "./pinned-sessions"

const HOME_PROJECT_NAV_LABEL = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"

const serverContextMenuID = (server: ServerConnection.Any) => `server:${ServerConnection.key(server)}`
const projectContextMenuID = (server: ServerConnection.Any, directory: string) =>
  `project:${ServerConnection.key(server)}:${directory}`

export type HomeProjectsViewProps = {
  language: ReturnType<typeof useLanguage>
  servers: Accessor<ServerConnection.Any[]>
  projects: Accessor<LocalProject[]>
  recentlyClosed: Accessor<LocalProject[]>
  selection: Accessor<HomeProjectSelection>
  homedir: Accessor<string>
  serverHealth: (server: ServerConnection.Any) => ServerHealth | undefined
  projectsForServer: (server: ServerConnection.Any) => LocalProject[]
  collapsed: (server: ServerConnection.Any) => boolean
  canDefaultServer: Accessor<boolean>
  defaultServerKey: Accessor<ServerConnection.Key | null | undefined>
  canRevealProject: (server: ServerConnection.Any) => boolean
  unseenCount: (server: ServerConnection.Any, project: LocalProject) => number
  onWheel: (event: WheelEvent) => void
  onChooseProject: (server: ServerConnection.Any) => void
  onFocusServer: (server: ServerConnection.Any) => void
  onToggleCollapsed: (server: ServerConnection.Any) => void
  onEditServer: (server: ServerConnection.Http) => void
  onSetDefaultServer: (server: ServerConnection.Any | undefined) => void
  onRemoveServer: (server: ServerConnection.Any) => void
  onMoveProject: (server: ServerConnection.Any, worktree: string, index: number) => void
  onSelectProject: (server: ServerConnection.Any, directory: string) => void
  onAddProjects: (server: ServerConnection.Any, directories: string[]) => void
  onOpenProjectNewSession: (server: ServerConnection.Any, directory: string) => void
  onEditProject: (server: ServerConnection.Any, project: LocalProject) => void
  onRevealProject: (server: ServerConnection.Any, project: LocalProject) => void
  onClearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  onCloseProject: (server: ServerConnection.Any, directory: string) => void
  onOpenSettings: () => void
  onOpenHelp: () => void
  onOpenSession: (server: ServerConnection.Any, session: Session) => void
  onDeleteSession: (server: ServerConnection.Any, session: Session) => void | Promise<void>
  currentSession?: Accessor<{ server?: string; id?: string } | undefined>
  pinned: PinnedSessions
}

export function HomeProjectsView(props: HomeProjectsViewProps) {
  const [contextMenu, setContextMenu] = createStore({ open: undefined as string | undefined })
  const contextMenuProps = {
    contextMenuOpen: (id: string) => contextMenu.open === id,
    onSetContextMenuOpen: (id: string, open: boolean) => setContextMenu("open", open ? id : undefined),
  }
  const [expanded, setExpanded] = persisted(
    Persist.global("home.sidebar.sessionsExpanded"),
    createStore({ worktrees: {} as Record<string, boolean> }),
  )
  const expandedProps = {
    sessionsExpanded: (worktree: string, selected: boolean) => expanded.worktrees[worktree] ?? selected,
    onToggleSessionsExpanded: (worktree: string, selected: boolean) =>
      setExpanded("worktrees", worktree, (value) => !(value ?? selected)),
  }
  return (
    <aside
      class={`
        flex h-full w-[260px] shrink-0 min-h-0 min-w-0 flex-col gap-4 overflow-hidden
        bg-v2-background-bg-deep border-r border-v2-border-border-base py-3 pl-3 pr-2
        rounded-tr-xl rounded-br-xl
      `}
      aria-label={props.language.t("home.projects")}
      onWheel={(event) => {
        if (event.target === event.currentTarget) return
        props.onWheel(event)
      }}
    >
      <HomePinnedSessions
        servers={props.servers}
        projectsForServer={props.projectsForServer}
        currentSession={props.currentSession}
        onOpenSession={props.onOpenSession}
        onDeleteSession={props.onDeleteSession}
        pinned={props.pinned}
        language={props.language}
      />
      <div class="flex h-7 min-w-0 shrink-0 items-center justify-between pl-1.5 pr-3">
        <div class="text-v2-text-text-muted [font-weight:530]">{props.language.t("home.projects")}</div>
        <Show
          when={props.servers().length === 1 && !(props.projects().length === 0 && props.recentlyClosed().length > 0)}
        >
          <TooltipV2 placement="bottom" value={props.language.t("home.project.add")}>
            <IconButtonV2
              data-action="home-add-project"
              variant="ghost-muted"
              size="large"
              class="titlebar-icon [&_[data-slot=icon-svg]]:text-v2-icon-icon-muted"
              icon={<IconV2 name="folder-add-left" />}
              disabled={props.serverHealth(props.servers()[0])?.healthy === false}
              onClick={() => props.onChooseProject(props.servers()[0])}
              aria-label={props.language.t("home.project.add")}
            />
          </TooltipV2>
        </Show>
      </div>
      <ScrollView data-slot="home-projects-scroll" class="min-h-0 min-w-0 shrink">
        <Show
          when={props.servers().length > 1}
          fallback={
            <div class="pr-3">
              <Show
                when={props.projects().length > 0}
                fallback={<HomeProjectEmpty {...props} server={props.servers()[0]} items={props.recentlyClosed()} />}
              >
                <HomeProjectList
                  {...props}
                  {...contextMenuProps}
                  {...expandedProps}
                  server={props.servers()[0]}
                  items={props.projects()}
                />
              </Show>
            </div>
          }
        >
          <div class="flex min-w-0 flex-col gap-4 pr-3">
            <For each={props.servers()}>
              {(item) => {
                const projects = () => props.projectsForServer(item)
                const healthy = () => !!props.serverHealth(item)?.healthy
                const hasProjects = () => projects().length > 0
                const collapsed = () => props.collapsed(item)
                return (
                  <div class="flex min-w-0 flex-col gap-1">
                    <HomeServerRow
                      server={item}
                      {...props}
                      {...contextMenuProps}
                      selected={props.selection().server === ServerConnection.key(item) && !props.selection().directory}
                      collapsed={collapsed()}
                      health={props.serverHealth(item)}
                    />
                    <Show when={healthy() && hasProjects() && !collapsed()}>
                      <div class="mx-3 h-px bg-v2-border-border-base" />
                      <HomeProjectList {...props} {...contextMenuProps} {...expandedProps} server={item} items={projects()} />
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </ScrollView>
      <HomeUtilityNav
        class="mb-8 mt-4 hidden shrink-0 lg:flex"
        onOpenSettings={props.onOpenSettings}
        onOpenHelp={props.onOpenHelp}
        language={props.language}
      />
    </aside>
  )
}

export function HomeUtilityNav(props: {
  class?: string
  onOpenSettings: () => void
  onOpenHelp: () => void
  language: ReturnType<typeof useLanguage>
}) {
  return (
    <div class={`${props.class ?? ""} min-w-0 flex-col gap-1 pr-3`}>
      <HomeProjectNavButton
        type="button"
        class="text-v2-text-text-faint [&>[data-slot=icon-svg]]:text-v2-icon-icon-muted"
        onClick={props.onOpenSettings}
      >
        <IconV2 name="settings-gear" size="small" />
        <span class={HOME_PROJECT_NAV_LABEL}>{props.language.t("sidebar.settings")}</span>
      </HomeProjectNavButton>
      <HomeProjectNavButton
        type="button"
        class="text-v2-text-text-faint [&>[data-slot=icon-svg]]:text-v2-icon-icon-muted"
        onClick={props.onOpenHelp}
      >
        <IconV2 name="help" size="small" />
        <span class={HOME_PROJECT_NAV_LABEL}>{props.language.t("sidebar.help")}</span>
      </HomeProjectNavButton>
    </div>
  )
}

function HomeServerRow(props: {
  language: HomeProjectsViewProps["language"]
  projectsForServer: HomeProjectsViewProps["projectsForServer"]
  contextMenuOpen: HomeProjectsContextMenuProps["contextMenuOpen"]
  canDefaultServer: HomeProjectsViewProps["canDefaultServer"]
  defaultServerKey: HomeProjectsViewProps["defaultServerKey"]
  onFocusServer: HomeProjectsViewProps["onFocusServer"]
  onToggleCollapsed: HomeProjectsViewProps["onToggleCollapsed"]
  onEditServer: HomeProjectsViewProps["onEditServer"]
  onSetDefaultServer: HomeProjectsViewProps["onSetDefaultServer"]
  onRemoveServer: HomeProjectsViewProps["onRemoveServer"]
  onSetContextMenuOpen: HomeProjectsContextMenuProps["onSetContextMenuOpen"]
  onChooseProject: HomeProjectsViewProps["onChooseProject"]
  server: ServerConnection.Any
  selected: boolean
  collapsed: boolean
  health: ServerHealth | undefined
}) {
  const healthy = () => !!props.health?.healthy
  const canToggle = () => healthy() && props.projectsForServer(props.server).length > 0
  const contextMenuID = () => serverContextMenuID(props.server)
  onCleanup(() => {
    const id = contextMenuID()
    if (props.contextMenuOpen(id)) props.onSetContextMenuOpen(id, false)
  })
  return (
    <div class="group/server relative flex h-7 min-w-0 items-center rounded-[6px]">
      <HomeProjectNavButton
        type="button"
        class="pr-16 disabled:opacity-60"
        data-selected={props.selected ? "" : undefined}
        disabled={!healthy()}
        onClick={() => props.onFocusServer(props.server)}
      >
        <span
          data-action="home-server-collapse"
          class={`
            -ml-0.5 -mr-1.5 inline-flex size-5 shrink-0 items-center justify-center
            rounded-[4px] text-v2-icon-icon-muted
          `}
          classList={{
            "hover:bg-v2-overlay-simple-overlay-hover": canToggle(),
            "cursor-default opacity-40": !canToggle(),
          }}
          aria-label={
            props.collapsed ? props.language.t("home.server.expand") : props.language.t("home.server.collapse")
          }
          aria-disabled={!canToggle()}
          aria-expanded={canToggle() ? !props.collapsed : undefined}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!canToggle()) return
            props.onToggleCollapsed(props.server)
          }}
          onPointerDown={(event) => event.preventDefault()}
        >
          <IconV2
            name="chevron-down"
            size="small"
            class="transition-transform duration-150 ease-in-out"
            style={{ transform: `rotate(${props.collapsed ? -90 : 0}deg)` }}
          />
        </span>
        <div class="flex size-4 shrink-0 items-center justify-center -mr-0.5">
          <ServerHealthIndicator health={props.health} />
        </div>
        <span class="flex min-w-0 items-center gap-1">
          <span class={HOME_PROJECT_NAV_LABEL}>{props.server.displayName ?? new URL(props.server.http.url).host}</span>
          <Show when={props.server.label}>
            {(label) => (
              <span
                class={`
                  shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5
                  text-[9px] leading-none text-v2-text-text-muted
                `}
              >
                {label()}
              </span>
            )}
          </Show>
        </span>
      </HomeProjectNavButton>
      <div
        class={`
          hover-reveal absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1
          group-hover/server:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100
        `}
        data-menu={props.contextMenuOpen(contextMenuID())}
      >
        <ServerRowMenuView
          server={props.server}
          labels={serverMenuLabels(props.language)}
          canDefault={props.canDefaultServer()}
          isDefault={props.defaultServerKey() === ServerConnection.key(props.server)}
          onEdit={props.onEditServer}
          onSetDefault={() => props.onSetDefaultServer(props.server)}
          onRemoveDefault={() => props.onSetDefaultServer(undefined)}
          onRemove={() => props.onRemoveServer(props.server)}
          open={props.contextMenuOpen(contextMenuID())}
          onOpenChange={(open) => props.onSetContextMenuOpen(contextMenuID(), open)}
        />
        <TooltipV2 class="flex shrink-0 items-center" placement="bottom" value={props.language.t("home.project.add")}>
          <IconButtonV2
            data-action="home-add-project"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="folder-add-left" />}
            aria-label={props.language.t("home.project.add")}
            disabled={props.health?.healthy === false}
            onClick={() => props.onChooseProject(props.server)}
          />
        </TooltipV2>
      </div>
    </div>
  )
}

type HomeProjectsContextMenuProps = {
  contextMenuOpen: (id: string) => boolean
  onSetContextMenuOpen: (id: string, open: boolean) => void
}

type HomeProjectsExpandedProps = {
  sessionsExpanded: (worktree: string, selected: boolean) => boolean
  onToggleSessionsExpanded: (worktree: string, selected: boolean) => void
}

type HomeProjectListProps = HomeProjectsViewProps &
  HomeProjectsContextMenuProps &
  HomeProjectsExpandedProps & {
    server: ServerConnection.Any
    items: LocalProject[]
  }

function HomeProjectList(props: HomeProjectListProps) {
  let listRef!: HTMLDivElement

  return (
    <DragDropProvider
      sensors={(defaults) => [
        ...defaults.filter((sensor) => sensor !== PointerSensor),
        PointerSensor.configure({
          activationConstraints: (event) =>
            event.pointerType === "touch"
              ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
              : [new PointerActivationConstraints.Distance({ value: 4 })],
          preventActivation: (event) => event.target instanceof Element && !!event.target.closest("[data-action]"),
        }),
      ]}
      modifiers={[RestrictToVerticalAxis, RestrictToElement.configure({ element: () => listRef })]}
      plugins={(defaults) => [
        ...defaults.filter((plugin) => plugin !== AutoScroller && plugin !== Feedback),
        AutoScroller.configure({ acceleration: 8, threshold: { x: 0, y: 0.05 } }),
        Feedback.configure({ dropAnimation: null }),
      ]}
      onDragEnd={(event) => {
        const source = event.operation.source
        if (event.canceled || !isSortable(source)) return
        if (source.initialIndex !== source.index) props.onMoveProject(props.server, source.id.toString(), source.index)
        if (props.selection().server !== ServerConnection.key(props.server))
          props.onSelectProject(props.server, source.id.toString())
      }}
    >
      <div class="flex min-w-0 flex-col gap-1" ref={listRef}>
        {/* Keyed on worktree strings: the enriched project objects are
            recreated on every store or sync update, so iterating them directly
            remounts all rows — killing any in-flight drag activation (the
            row's sortable unregisters on unmount) and discarding animations.
            String keys keep row elements alive and move them on reorder. */}
        <For each={props.items.map((project) => project.worktree)}>
          {(worktree, index) => <HomeProjectSlot {...props} worktree={worktree} index={index} />}
        </For>
      </div>
    </DragDropProvider>
  )
}

function HomeProjectSlot(
  props: HomeProjectListProps & {
    worktree: string
    index: () => number
  },
) {
  const initial = props.items.find((item) => item.worktree === props.worktree)
  if (!initial) return
  const project = createMemo<LocalProject>(
    (previous) => props.items.find((item) => item.worktree === props.worktree) ?? previous,
    initial,
  )
  const selected = createMemo(
    () =>
      props.selection().server === ServerConnection.key(props.server) &&
      props.selection().directory === props.worktree,
  )
  const sessionsOpen = createMemo(() => props.sessionsExpanded(props.worktree, selected()))

  return (
    <div class="flex min-w-0 flex-col gap-0.5">
      <HomeProjectRow
        {...props}
        project={project()}
        server={props.server}
        index={props.index}
        serverSelected={props.selection().server === ServerConnection.key(props.server)}
        selected={selected()}
        unseen={props.unseenCount(props.server, project())}
        sessionsOpen={sessionsOpen()}
        onToggleSessions={() => props.onToggleSessionsExpanded(props.worktree, selected())}
      />
      <Show when={sessionsOpen()}>
        <HomeProjectSessions
          server={props.server}
          directory={props.worktree}
          project={project()}
          currentSession={props.currentSession}
          onOpenSession={props.onOpenSession}
          onDeleteSession={props.onDeleteSession}
          pinned={props.pinned}
          language={props.language}
        />
      </Show>
    </div>
  )
}

function HomePinnedSessions(props: {
  servers: Accessor<ServerConnection.Any[]>
  projectsForServer: (server: ServerConnection.Any) => LocalProject[]
  currentSession?: Accessor<{ server?: string; id?: string } | undefined>
  onOpenSession: (server: ServerConnection.Any, session: Session) => void
  onDeleteSession: (server: ServerConnection.Any, session: Session) => void | Promise<void>
  pinned: PinnedSessions
  language: ReturnType<typeof useLanguage>
}) {
  const global = useGlobal()
  const entries = createMemo(() => {
    const pins = new Set(props.pinned.entries().map((entry) => `${entry.server}\0${entry.id}`))
    if (pins.size === 0) return []
    const all: { server: ServerConnection.Any; project: LocalProject; session: Session }[] = []
    for (const server of props.servers()) {
      const serverKey = ServerConnection.key(server)
      for (const project of props.projectsForServer(server)) {
        const [store] = global.ensureServerCtx(server).sync.child(project.worktree, { bootstrap: true })
        for (const session of sortedRootSessions(store, 0)) {
          if (pins.has(`${serverKey}\0${session.id}`)) all.push({ server, project, session })
        }
      }
    }
    return all.sort((a, b) => compareSessionTime(a.session, b.session))
  })

  return (
    <Show when={entries().length > 0}>
      <div class="flex min-w-0 shrink-0 flex-col gap-0.5">
        <div class="flex h-7 min-w-0 shrink-0 items-center pl-1.5 pr-3">
          <div class="text-v2-text-text-muted [font-weight:530]">{props.language.t("home.pinnedSessions")}</div>
        </div>
        <For each={entries()}>
          {(entry) => (
            <HomeSessionRow
              server={entry.server}
              session={entry.session}
              project={entry.project}
              currentSession={props.currentSession}
              onOpenSession={props.onOpenSession}
              onDeleteSession={props.onDeleteSession}
              pinned={props.pinned}
              language={props.language}
            />
          )}
        </For>
      </div>
    </Show>
  )
}

function HomeProjectSessions(props: {
  server: ServerConnection.Any
  directory: string
  project?: LocalProject
  currentSession?: Accessor<{ server?: string; id?: string } | undefined>
  onOpenSession: (server: ServerConnection.Any, session: Session) => void
  onDeleteSession: (server: ServerConnection.Any, session: Session) => void | Promise<void>
  pinned: PinnedSessions
  language: ReturnType<typeof useLanguage>
}) {
  const global = useGlobal()
  const [store] = global.ensureServerCtx(props.server).sync.child(props.directory, { bootstrap: true })
  const sessions = createMemo(() => sortedRootSessions(store, 0))

  return (
    <div class="flex min-w-0 flex-col gap-0.5 pl-6">
      <Show
        when={sessions().length > 0}
        fallback={<div class="px-1.5 py-1 text-v2-text-text-faint">{props.language.t("home.sessions.empty")}</div>}
      >
        <For each={sessions()}>
          {(session) => (
            <HomeSessionRow
              server={props.server}
              session={session}
              currentSession={props.currentSession}
              onOpenSession={props.onOpenSession}
              onDeleteSession={props.onDeleteSession}
              pinned={props.pinned}
              language={props.language}
              dense
            />
          )}
        </For>
      </Show>
    </div>
  )
}

function HomeSessionDeleteDialog(props: {
  session: Session
  onConfirm: () => void | Promise<void>
  language: ReturnType<typeof useLanguage>
}) {
  const dialog = useDialog()
  const name = createMemo(() => sessionTitle(props.session.title) || props.language.t("command.session.new"))
  return (
    <DialogV2 fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={props.language.t("session.delete.title")}
          description={props.language.t("session.delete.confirm", { name: name() })}
        />
      </DialogHeader>
      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {props.language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          variant="danger"
          onClick={async () => {
            await props.onConfirm()
            dialog.close()
          }}
        >
          {props.language.t("session.delete.button")}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}

function HomeSessionRow(props: {
  server: ServerConnection.Any
  session: Session
  project?: LocalProject
  dense?: boolean
  currentSession?: Accessor<{ server?: string; id?: string } | undefined>
  onOpenSession: (server: ServerConnection.Any, session: Session) => void
  onDeleteSession: (server: ServerConnection.Any, session: Session) => void | Promise<void>
  pinned: PinnedSessions
  language: ReturnType<typeof useLanguage>
}) {
  const dialog = useDialog()
  const [menuOpen, setMenuOpen] = createSignal(false)
  const serverKey = () => ServerConnection.key(props.server)
  const current = createMemo(() => {
    const value = props.currentSession?.()
    return value?.server === serverKey() && value?.id === props.session.id
  })
  const isPinned = createMemo(() => props.pinned.isPinned(serverKey(), props.session.id))

  return (
    <div class="group/session relative flex min-w-0 items-center">
      <HomeProjectNavButton
        type="button"
        class={`${props.dense ? "h-6" : ""} pr-7 disabled:opacity-60`}
        data-selected={current() ? "" : undefined}
        onClick={() => props.onOpenSession(props.server, props.session)}
      >
        <Show when={props.project}>{(project) => <HomeProjectAvatar project={project()} />}</Show>
        <span class={`${HOME_PROJECT_NAV_LABEL} ${props.dense ? "text-[13px]" : ""}`}>
          {sessionTitle(props.session.title) || props.session.id}
        </span>
      </HomeProjectNavButton>
      <div
        class={`
          hover-reveal absolute right-1 top-1/2 flex -translate-y-1/2 items-center opacity-0
          group-hover/session:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100
        `}
        data-menu={menuOpen()}
      >
        <MenuV2 gutter={6} modal={false} placement="bottom-end" open={menuOpen()} onOpenChange={setMenuOpen}>
          <MenuV2.Trigger
            as={IconButtonV2}
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="outline-dots" />}
            aria-label={props.language.t("common.moreOptions")}
          />
          <MenuV2.Portal>
            <MenuV2.Content>
              <MenuV2.Item onSelect={() => props.pinned.toggle(serverKey(), props.session.id)}>
                {isPinned() ? props.language.t("common.unpin") : props.language.t("common.pin")}
              </MenuV2.Item>
              <MenuV2.Separator />
              <MenuV2.Item
                onSelect={() =>
                  dialog.show(() => (
                    <HomeSessionDeleteDialog
                      session={props.session}
                      language={props.language}
                      onConfirm={() => props.onDeleteSession(props.server, props.session)}
                    />
                  ))
                }
              >
                {props.language.t("session.delete.button")}
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </div>
    </div>
  )
}

function HomeProjectEmpty(
  props: HomeProjectsViewProps & {
    server: ServerConnection.Any
    items: LocalProject[]
  },
) {
  const unreachable = () => props.serverHealth(props.server)?.healthy === false
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <HomeProjectNavButton
        type="button"
        data-action="home-add-project-row"
        class="disabled:opacity-60 [&>[data-slot=icon-svg]]:text-v2-icon-icon-muted"
        disabled={unreachable()}
        onClick={() => props.onChooseProject(props.server)}
      >
        <IconV2 name="folder-add-left" size="small" />
        <span class={HOME_PROJECT_NAV_LABEL}>{props.language.t("home.project.add")}</span>
      </HomeProjectNavButton>
      <Show when={props.items.length > 0}>
        <div class="mt-3 flex h-7 min-w-0 shrink-0 items-center pl-1.5 pr-3">
          <div class="text-v2-text-text-faint [font-weight:530]">{props.language.t("home.recentlyClosed")}</div>
        </div>
        <For each={props.items}>
          {(project) => <HomeRecentlyClosedRow {...props} project={project} server={props.server} />}
        </For>
      </Show>
    </div>
  )
}

function HomeRecentlyClosedRow(
  props: HomeProjectsViewProps & {
    project: LocalProject
    server: ServerConnection.Any
  },
) {
  const unreachable = () => props.serverHealth(props.server)?.healthy === false
  const path = () => {
    const home = props.homedir()
    const worktree = props.project.worktree
    if (home && (worktree === home || worktree.startsWith(`${home}/`))) return `~${worktree.slice(home.length)}`
    return worktree
  }
  return (
    <TooltipV2 placement="right" value={path()}>
      <HomeProjectNavButton
        type="button"
        data-component="home-recently-closed-row"
        class="disabled:opacity-60"
        disabled={unreachable()}
        onClick={() => props.onAddProjects(props.server, [props.project.worktree])}
      >
        <HomeProjectAvatar project={props.project} outline />
        <span class={HOME_PROJECT_NAV_LABEL}>{displayName(props.project)}</span>
      </HomeProjectNavButton>
    </TooltipV2>
  )
}

function HomeProjectRow(
  props: HomeProjectsViewProps &
    HomeProjectsContextMenuProps & {
      project: LocalProject
      server: ServerConnection.Any
      index: () => number
      serverSelected: boolean
      selected: boolean
      unseen: number
      sessionsOpen: boolean
      onToggleSessions: () => void
    },
) {
  const platform = usePlatform()
  const serverUnreachable = () => props.serverHealth(props.server)?.healthy === false
  const sortable = useSortable({
    get id() {
      return props.project.worktree
    },
    get index() {
      return props.index()
    },
  })
  let pointerDownSelected: boolean | undefined
  const contextMenuID = () => projectContextMenuID(props.server, props.project.worktree)
  onCleanup(() => {
    const id = contextMenuID()
    if (props.contextMenuOpen(id)) props.onSetContextMenuOpen(id, false)
  })
  return (
    <div
      ref={sortable.ref}
      class="group/project relative flex h-7 min-w-0 items-center rounded-[6px]"
      classList={{ "z-10": sortable.isDragSource() }}
      onContextMenu={(event) => {
        event.preventDefault()
        props.onSetContextMenuOpen(contextMenuID(), true)
      }}
    >
      <HomeProjectNavButton
        type="button"
        data-component="home-project-row"
        class="pr-16 disabled:opacity-60"
        classList={{
          "bg-v2-background-bg-layer-01 text-v2-text-text-base": sortable.isDragSource(),
        }}
        data-selected={props.selected ? "" : undefined}
        aria-current={props.selected ? "page" : undefined}
        disabled={serverUnreachable()}
        onPointerDown={(event) => {
          // Same-server mouse selection happens on pointerdown (like tabs),
          // but only ever selects; selectProject toggles, and deselecting here
          // would fire on every drag before the threshold is met. Cross-server
          // selection waits for click so reordering a remote server's projects
          // does not focus that server and load its session index. Touch is
          // excluded so flick-scrolling the list cannot select rows.
          pointerDownSelected = undefined
          if (event.button !== 0 || event.pointerType === "touch") return
          if (!props.serverSelected) return
          pointerDownSelected = props.selected
          if (!props.selected) props.onSelectProject(props.server, props.project.worktree)
        }}
        onClick={(event) => {
          // The drag sensor calls preventDefault on post-drag clicks; never
          // toggle selection as part of a reorder.
          if (event.defaultPrevented) return
          // Keyboard activation and touch taps keep the original toggle.
          if (event.detail === 0 || pointerDownSelected === undefined) {
            props.onSelectProject(props.server, props.project.worktree)
            return
          }
          // Mouse: pointerdown already selected unselected rows; a plain click
          // on an already-selected row toggles it off.
          if (pointerDownSelected) props.onSelectProject(props.server, props.project.worktree)
          pointerDownSelected = undefined
        }}
      >
        <span
          data-action="home-project-sessions-toggle"
          class="-ml-0.5 -mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
          aria-label={props.sessionsOpen ? props.language.t("home.server.collapse") : props.language.t("home.server.expand")}
          aria-expanded={props.sessionsOpen}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            props.onToggleSessions()
          }}
          onPointerDown={(event) => event.preventDefault()}
        >
          <IconV2
            name="chevron-down"
            size="small"
            class="transition-transform duration-150 ease-in-out"
            style={{ transform: `rotate(${props.sessionsOpen ? 0 : -90}deg)` }}
          />
        </span>
        <HomeProjectAvatar project={props.project} />
        <span class={HOME_PROJECT_NAV_LABEL}>{displayName(props.project)}</span>
      </HomeProjectNavButton>
      <div
        class={`
          hover-reveal absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1
          group-hover/project:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100
        `}
        data-menu={props.contextMenuOpen(contextMenuID())}
      >
        <MenuV2
          gutter={6}
          modal={false}
          placement="bottom-end"
          open={props.contextMenuOpen(contextMenuID())}
          onOpenChange={(open) => props.onSetContextMenuOpen(contextMenuID(), open)}
        >
          <MenuV2.Trigger
            as={IconButtonV2}
            data-action="home-project-menu"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="outline-dots" />}
            aria-label={props.language.t("common.moreOptions")}
          />
          <MenuV2.Portal>
            <MenuV2.Content>
              <MenuV2.Item onSelect={() => props.onOpenProjectNewSession(props.server, props.project.worktree)}>
                {props.language.t("command.session.new")}
              </MenuV2.Item>
              <MenuV2.Item onSelect={() => props.onEditProject(props.server, props.project)}>
                {props.language.t("dialog.project.edit.title")}
              </MenuV2.Item>
              <Show when={props.canRevealProject(props.server)}>
                <MenuV2.Item onSelect={() => props.onRevealProject(props.server, props.project)}>
                  {props.language.t(
                    fileManagerApp(platform.platform === "desktop" ? (platform.os ?? "unknown") : "unknown")
                      .actionLabel,
                  )}
                </MenuV2.Item>
              </Show>
              <MenuV2.Item
                disabled={props.unseen === 0}
                onSelect={() => props.onClearNotifications(props.server, props.project)}
              >
                {props.language.t("sidebar.project.clearNotifications")}
              </MenuV2.Item>
              <MenuV2.Separator />
              <MenuV2.Item onSelect={() => props.onCloseProject(props.server, props.project.worktree)}>
                {props.language.t("common.close")}
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
        <IconButtonV2
          data-action="home-project-new-session"
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="edit" />}
          aria-label={props.language.t("command.session.new")}
          onClick={() => props.onOpenProjectNewSession(props.server, props.project.worktree)}
        />
      </div>
    </div>
  )
}

function HomeProjectNavButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <button
      {...rest}
      class={`
        flex h-7 min-w-0 w-full shrink-0 cursor-default items-center gap-2 rounded-[6px] bg-transparent px-1.5 text-left
        text-v2-text-text-muted [font-weight:440] transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out
        hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base
        data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base
        data-[selected]:hover:bg-v2-background-bg-layer-03
        focus-visible:bg-v2-background-bg-layer-01 focus-visible:text-v2-text-text-base focus-visible:outline-none
        focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]
        ${local.class ?? ""}
      `}
      classList={local.classList}
    >
      {local.children}
    </button>
  )
}

function HomeProjectAvatar(props: { project: LocalProject; outline?: boolean }) {
  const name = createMemo(() => displayName(props.project))
  return (
    <ProjectAvatar
      fallback={name()}
      src={props.outline ? undefined : getProjectAvatarSource(props.project.id, props.project.icon)}
      variant={props.outline ? "outline" : getProjectAvatarVariant(props.project.icon?.color)}
    />
  )
}
