import { For, Show, createMemo, onCleanup, type Accessor } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { debounce } from "@solid-primitives/scheduled"
import type { GitChange, GitState, GitStash } from "@opencode/client/promise"
import { Checkbox } from "@opencode/ui/checkbox"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { SplitButton, SplitButtonAction, SplitButtonMenuTrigger } from "@opencode/ui/split-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { createKeyed, usePlugin, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import type { ChangeKind } from "@opencode/plugin/gui/review"
import type Review from "./index"
import { isReviewFolder } from "./kinds"
import { GitRemoteDialog, GitStashDialog } from "./git-dialogs"

/**
 * The working tree's Git state for the review panel, kept live: it reloads on `git.changed`, which the server sends
 * for any change to the index, refs, HEAD or working tree, from Forge or from a terminal.
 */
export function createReviewGit(input: { view: Accessor<MountedSession>; enabled: Accessor<boolean> }) {
  const view = input.view
  const directory = () => view().directory
  const location = () => ({ location: { directory: directory() } })
  const client = () => view().server.client.git

  const [store, setStore] = createStore({
    state: undefined as GitState | undefined,
    message: "",
    busy: false,
    error: "",
  })

  // Each directory's loads are numbered, so a slow answer for an older moment never replaces a newer one.
  const run = { generation: 0, latest: 0 }

  const load = async () => {
    if (!input.enabled() || !view().server.connected) return
    const generation = run.generation
    const request = ++run.latest
    await client()
      .state(location())
      .then(
        (result) => {
          if (generation !== run.generation || request !== run.latest) return
          setStore("state", reconcile(result.data, { key: "file" }))
        },
        (error) => {
          if (generation === run.generation) setStore("error", message(error))
        },
      )
  }

  const refresh = debounce(() => void load(), 100)

  createKeyed(
    () => ({ directory: directory(), data: view().server.data }),
    (current) => {
      run.generation++
      setStore({ state: undefined, message: "", busy: false, error: "" })
      onCleanup(
        current.data.listen(({ details }) => {
          if (details.location?.directory !== current.directory) return

          if (details.type === "git.changed" || details.type === "filesystem.changed") refresh()
        }),
      )
    },
    { equals: (previous, next) => previous.directory === next.directory && previous.data === next.data },
  )
  // Loads when the panel starts showing the working tree, and again for each new directory or server.
  createKeyed(
    () => ({ enabled: input.enabled(), directory: directory(), data: view().server.data }),
    (current) => {
      if (current.enabled) void load()
    },
    {
      equals: (previous, next) =>
        previous.enabled === next.enabled && previous.directory === next.directory && previous.data === next.data,
    },
  )

  /** Runs one action at a time; an optimistic change shows at once and the reload that follows confirms it. */
  const act = async <A,>(action: () => Promise<A>, optimistic?: () => void): Promise<A | undefined> => {
    if (store.busy) return
    const generation = run.generation
    setStore({ busy: true, error: "" })
    optimistic?.()

    const result = await action().then(
      (value) => ({ value }),
      (error) => {
        if (generation === run.generation) setStore("error", message(error))

        return undefined
      },
    )

    if (generation !== run.generation) return
    await load()
    setStore("busy", false)

    return result?.value
  }

  const setStaged = (staged: boolean, files?: readonly string[]) =>
    setStore("state", "changes", (change) => !files || files.includes(change.file), { staged, unstaged: !staged })

  return {
    store,
    setMessage: (value: string) => setStore("message", value),
    clearError: () => setStore("error", ""),
    act,
    stage: (files?: string[]) =>
      act(
        () => client().stage({ ...location(), files }),
        () => setStaged(true, files),
      ),
    unstage: (files?: string[]) =>
      act(
        () => client().unstage({ ...location(), files }),
        () => setStaged(false, files),
      ),
    discard: (file: string) => act(() => client().discard({ ...location(), file })),
    commit: async (all: boolean) => {
      const text = store.message

      const done = await act(
        () => client().commit({ ...location(), message: text, all }),
        all ? () => setStaged(true) : undefined,
      )

      if (done && store.message === text) setStore("message", "")
    },
    generate: async (model: { providerID: string; modelID: string; variant?: string } | undefined, all: boolean) => {
      const result = await act(() =>
        client().message({
          ...location(),
          all,
          ...(model ? { model: { providerID: model.providerID, id: model.modelID, variant: model.variant } } : {}),
        }),
      )

      if (result) setStore("message", result.data.message)
    },
    fetch: () => act(() => client().fetch(location())),
    push: (input?: { remote?: string; setUpstream?: boolean }) => act(() => client().push({ ...location(), ...input })),
    pull: (input?: { remote?: string; branch?: string; strategy?: "merge" | "rebase" }) =>
      act(() => client().pull({ ...location(), ...input })),
    targets: () => client().targets(location()).then((result) => result.data),
    stashes: () => client().stash.list(location()).then((result) => result.data),
    stashCreate: (input: { message?: string; includeUntracked?: boolean }) =>
      act(() => client().stash.create({ ...location(), ...input })),
    stashAction: (action: "apply" | "pop" | "drop", stash: GitStash) =>
      act(() => client().stash[action]({ ...location(), ref: stash.ref, oid: stash.oid })),
  }
}

export type ReviewGit = ReturnType<typeof createReviewGit>

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const checked = (change: GitChange) => change.staged && !change.unstaged

/**
 * The changed files as a tree with staging checkboxes. A file with uncommitted changes has a checkbox in every mode,
 * and a folder's checkbox stages everything under it; Uncommitted lists the working tree's changes as Git reports them.
 */
export function GitChanges(props: {
  git: ReviewGit
  /** Whether the working tree's changes are shown, rather than a branch's or a turn's. */
  working: boolean
  files: readonly string[]
  kinds: ReadonlyMap<string, ChangeKind>
  active?: string
  onSelectFile: (path: string) => void
}) {
  const ctx = usePlugin<typeof Review>()
  const changes = createMemo(() => props.git.store.state?.changes ?? [])
  const byFile = createMemo(() => new Map(changes().map((change) => [change.file, change] as const)))

  // Uncommitted lists every change Git reports, such as files inside an untracked folder the diff shows as one row.
  const files = createMemo(
    () => (props.working ? changes().map((change) => change.file) : props.files.filter((file) => !isReviewFolder(file))),
    undefined,
    // Staging reloads the state without changing which files are listed; keep the tree and its rows mounted.
    { equals: (a, b) => a.length === b.length && a.every((file, index) => file === b[index]) },
  )

  const tree = createMemo(() => buildTree(files()))
  const [collapsed, setCollapsed] = createStore<Record<string, boolean>>({})

  // A branch's or a turn's list stages only its own files; other uncommitted changes stay out of its count.
  const listed = createMemo(() => {
    if (props.working) return changes()
    const shown = new Set(files())

    return changes().filter((change) => shown.has(change.file))
  })

  const scope = () => (props.working ? undefined : listed().map((change) => change.file))
  const staged = () => listed().filter((change) => change.staged).length
  const allStaged = () => listed().length > 0 && listed().every(checked)
  const busy = () => props.git.store.busy

  const discard = async (file: string) => {
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("git.discard.title"),
      description: ctx.t("git.discard.description", { file }),
      confirm: ctx.t("git.discard"),
      danger: true,
    })

    if (confirmed) void props.git.discard(file)
  }

  const indent = (depth: number) => ({ "padding-inline-start": `${8 + depth * 12}px` })

  const Rows = (input: { nodes: readonly TreeNode[]; depth: number }) => (
    <For each={input.nodes}>
      {(node) => (
        <Show when={node.file} fallback={<Folder node={node} depth={input.depth} />}>
          {(file) => <File file={file()} name={node.name} depth={input.depth} />}
        </Show>
      )}
    </For>
  )

  const Folder = (input: { node: TreeNode; depth: number }) => {
    const tracked = createMemo(() => input.node.files.filter((file) => byFile().has(file)))
    const all = () => tracked().length > 0 && tracked().every((file) => checked(byFile().get(file)!))
    const some = () => tracked().some((file) => byFile().get(file)!.staged)

    return (
      <>
        <div
          class="flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-md pe-1 hover:bg-v2-overlay-simple-overlay-hover"
          style={indent(input.depth)}
          onClick={() => setCollapsed(input.node.path, (value) => !value)}
        >
          <div onClick={(event) => event.stopPropagation()} class="flex size-4 shrink-0 items-center">
            <Show when={tracked().length > 0}>
              <Checkbox
                hideLabel
                checked={all()}
                indeterminate={some() && !all()}
                disabled={busy()}
                onChange={() => void (all() ? props.git.unstage(tracked()) : props.git.stage(tracked()))}
              >
                {ctx.t(all() ? "git.unstageFile" : "git.stageFile", { file: input.node.path })}
              </Checkbox>
            </Show>
          </div>
          <Icon
            name="chevron-right"
            size="small"
            class="shrink-0 text-v2-icon-icon-muted transition-transform"
            classList={{ "rotate-90": !collapsed[input.node.path] }}
          />
          <bdi dir="ltr" class="min-w-0 flex-1 truncate text-12-regular text-v2-text-text-muted">
            {input.node.name}
          </bdi>
        </div>
        <Show when={!collapsed[input.node.path]}>
          <Rows nodes={input.node.children} depth={input.depth + 1} />
        </Show>
      </>
    )
  }

  const File = (input: { file: string; name: string; depth: number }) => {
    const change = () => byFile().get(input.file)

    const letter = () => {
      const current = change()

      if (props.working && current) return current.conflicted ? "!" : current.untracked ? "U" : "M"
      const kind = props.kinds.get(input.file)

      return kind === "add" ? "A" : kind === "del" ? "D" : "M"
    }

    return (
      <div
        class="group/git-row flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-md pe-1 hover:bg-v2-overlay-simple-overlay-hover"
        classList={{ "bg-v2-overlay-simple-overlay-pressed": props.active === input.file }}
        style={indent(input.depth)}
        onClick={() => props.onSelectFile(input.file)}
      >
        <div onClick={(event) => event.stopPropagation()} class="flex size-4 shrink-0 items-center">
          <Show when={change()}>
            {(current) => (
              <Checkbox
                hideLabel
                checked={checked(current())}
                // A partly staged file shows a dash, and checking it stages the rest.
                indeterminate={current().staged && current().unstaged}
                disabled={busy() || current().conflicted}
                onChange={() =>
                  void (checked(current()) ? props.git.unstage([input.file]) : props.git.stage([input.file]))
                }
              >
                {ctx.t(checked(current()) ? "git.unstageFile" : "git.stageFile", { file: input.file })}
              </Checkbox>
            )}
          </Show>
        </div>
        {/* Lines the name up with folder names, which follow a chevron. */}
        <span class="w-4 shrink-0" />
        <bdi dir="ltr" class="min-w-0 flex-1 truncate text-12-medium text-v2-text-text-base">
          {input.name}
        </bdi>
        <Show when={change()?.unstaged && !change()?.conflicted}>
          <IconButton
            size="small"
            variant="ghost-muted"
            icon={<Icon name="outline-reset" />}
            class="shrink-0 opacity-0 group-hover/git-row:opacity-100 focus-visible:opacity-100"
            aria-label={ctx.t("git.discardFile", { file: input.file })}
            disabled={busy()}
            onClick={(event: MouseEvent) => {
              event.stopPropagation()
              void discard(input.file)
            }}
          />
        </Show>
        <span
          class="w-3 shrink-0 text-center text-11-medium tabular-nums"
          classList={{
            "text-v2-state-fg-danger": letter() === "!" || letter() === "D",
            "text-v2-state-fg-success": letter() === "U" || letter() === "A",
            "text-v2-state-fg-info": letter() === "M",
          }}
        >
          {letter()}
        </span>
      </div>
    )
  }

  return (
    <div class="flex flex-col">
      <Show when={listed().length > 0}>
        <div class="flex h-8 items-center gap-2 ps-2 pe-1">
          <Checkbox
            hideLabel
            checked={allStaged()}
            indeterminate={staged() > 0 && !allStaged()}
            disabled={busy()}
            onChange={() => void (allStaged() ? props.git.unstage(scope()) : props.git.stage(scope()))}
          >
            {ctx.t(allStaged() ? "git.unstageAll" : "git.stageAll")}
          </Checkbox>
          <span class="min-w-0 flex-1 truncate text-12-regular text-v2-text-text-muted">
            {ctx.t("git.stagedOf", { staged: staged(), total: listed().length })}
          </span>
        </div>
      </Show>
      <Show
        when={tree().length > 0}
        fallback={<div class="px-2 py-2 text-12-regular text-v2-text-text-muted">{ctx.t("noChanges")}</div>}
      >
        <Rows nodes={tree()} depth={0} />
      </Show>
    </div>
  )
}

type TreeNode = {
  name: string
  path: string
  /** Every file at or under this node. */
  files: string[]
  children: TreeNode[]
  file?: string
}

/** Folders before files, each sorted by name; a folder whose only child is a folder shares its row, as `a/b`. */
function buildTree(files: readonly string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", files: [], children: [] }
  files.forEach((file) => {
    const parts = file.split("/")
    parts.reduce((parent, name, index) => {
      parent.files.push(file)
      const path = parts.slice(0, index + 1).join("/")
      const existing = parent.children.find((child) => child.path === path)

      if (existing) return existing
      const node: TreeNode = { name, path, files: [], children: [], ...(index === parts.length - 1 ? { file } : {}) }
      parent.children.push(node)

      return node
    }, root).files.push(file)
  })

  const sort = (nodes: TreeNode[]) =>
    nodes.toSorted((a, b) => (!a.file !== !b.file ? (a.file ? 1 : -1) : a.name.localeCompare(b.name)))

  const finish = (node: TreeNode): TreeNode => {
    const only = node.children.length === 1 && !node.children[0].file ? node.children[0] : undefined

    if (!node.file && only) return finish({ ...only, name: `${node.name}/${only.name}` })

    return { ...node, children: sort(node.children.map(finish)) }
  }

  return sort(root.children.map(finish))
}

/** The branch, its remote actions and the commit box, under the changes. */
export function GitFooter(props: { git: ReviewGit; screen: SessionScreen }) {
  const ctx = usePlugin<typeof Review>()
  const git = props.git
  const state = () => git.store.state
  const changes = () => state()?.changes ?? []
  const remote = () => state()?.remote
  const staged = () => changes().filter((change) => change.staged).length
  const busy = () => git.store.busy
  const canCommit = () => !busy() && changes().length > 0 && git.store.message.trim().length > 0
  // Nothing left to commit and local commits waiting: the remote button's primary action becomes Push.
  const pushReady = () => changes().length === 0 && (remote()?.ahead ?? 0) > 0
  const pullReady = () => (remote()?.behind ?? 0) > 0

  const remoteDialog = (mode: "push" | "pull") =>
    ctx.dialogs.open((dialog) => <GitRemoteDialog git={git} mode={mode} dialog={dialog} />)

  const push = () => (remote()?.upstream ? void git.push() : void remoteDialog("push"))

  const primary = () => {
    if (pushReady()) return push()

    if (pullReady()) return void git.pull()
    void git.fetch()
  }

  return (
    <div class="flex shrink-0 flex-col gap-2 border-t border-v2-border-border-muted p-2">
      <div class="flex items-center justify-between gap-2 ps-1">
        <span class="flex min-w-0 items-center gap-1.5 text-12-medium text-v2-text-text-base">
          <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
          <bdi dir="ltr" class="min-w-0 truncate">
            {state()?.branch ?? ctx.t("git.detached")}
          </bdi>
        </span>
        <Show when={remote()?.remotes}>
          <SplitButton data-variant="outline">
            <SplitButtonAction disabled={busy()} onClick={primary}>
              <Show
                when={pushReady()}
                fallback={
                  <Show
                    when={pullReady()}
                    fallback={
                      <>
                        <Icon name="refresh" size="small" />
                        {ctx.t("git.fetch")}
                      </>
                    }
                  >
                    <Icon name="arrow-down-to-line" size="small" />
                    {ctx.t("git.pull")}
                    <span class="tabular-nums text-v2-text-text-muted">{remote()?.behind}</span>
                  </Show>
                }
              >
                <Icon name={remote()?.upstream ? "arrow-up" : "cloud-upload"} size="small" />
                {ctx.t(remote()?.upstream ? "git.push" : "git.publish")}
                <span class="tabular-nums text-v2-text-text-muted">{remote()?.ahead}</span>
              </Show>
            </SplitButtonAction>
            <Menu gutter={4} modal={false} placement="bottom-end">
              <Menu.Trigger as={SplitButtonMenuTrigger} disabled={busy()} aria-label={ctx.t("git.remoteMenu")}>
                <Icon name="chevron-down" size="small" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content>
                  <Menu.Item onSelect={() => void git.fetch()}>{ctx.t("git.fetch")}</Menu.Item>
                  <Menu.Item onSelect={() => void remoteDialog("pull")}>{ctx.t("git.pull")}</Menu.Item>
                  <Menu.Separator />
                  <Menu.Item onSelect={push}>
                    {ctx.t(remote()?.upstream ? "git.push" : "git.publish")}
                    <Show when={(remote()?.ahead ?? 0) > 0}>
                      <span class="ms-auto ps-3 tabular-nums text-v2-text-text-muted">↑{remote()?.ahead}</span>
                    </Show>
                  </Menu.Item>
                  <Menu.Separator />
                  <Menu.Item
                    onSelect={() => void ctx.dialogs.open((dialog) => <GitStashDialog git={git} dialog={dialog} />)}
                  >
                    {ctx.t("git.stashes")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu>
          </SplitButton>
        </Show>
      </div>
      <div class="flex h-32 shrink-0 flex-col overflow-hidden rounded-lg border border-v2-border-border-muted bg-v2-background-bg-base transition-colors focus-within:border-v2-border-border-focus">
        <textarea
          class="min-h-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-12-regular text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
          aria-label={ctx.t("git.message.placeholder")}
          placeholder={ctx.t("git.message.placeholder")}
          value={git.store.message}
          onInput={(event) => git.setMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || !canCommit()) return
            event.preventDefault()
            void git.commit(staged() === 0)
          }}
        />
        <div class="flex shrink-0 items-center justify-between gap-2 px-1.5 pb-1.5">
          <Tooltip value={ctx.t("git.generate")} placement="top">
            <IconButton
              size="small"
              variant="ghost-muted"
              icon={<Icon name="brain" />}
              aria-label={ctx.t("git.generate")}
              disabled={busy() || changes().length === 0}
              onClick={() => void git.generate(props.screen.composer.model(), staged() === 0)}
            />
          </Tooltip>
          <SplitButton data-variant="outline">
            {/* With nothing staged, the primary action commits every change. */}
            <SplitButtonAction disabled={!canCommit()} onClick={() => void git.commit(staged() === 0)}>
              {ctx.t(staged() > 0 ? "git.commit" : "git.commitAll")}
            </SplitButtonAction>
            <Menu gutter={4} modal={false} placement="top-end">
              <Menu.Trigger as={SplitButtonMenuTrigger} disabled={!canCommit()} aria-label={ctx.t("git.commitMenu")}>
                <Icon name="chevron-down" size="small" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content>
                  <Menu.Item disabled={staged() === 0} onSelect={() => void git.commit(false)}>
                    {ctx.t("git.commit")}
                  </Menu.Item>
                  <Menu.Item onSelect={() => void git.commit(true)}>{ctx.t("git.commitAll")}</Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu>
          </SplitButton>
        </div>
      </div>
      <Show when={git.store.error}>
        {(error) => (
          <div role="alert" class="flex items-start gap-1 text-12-regular text-v2-state-fg-danger">
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words">{error()}</span>
            <IconButton
              size="small"
              variant="ghost-muted"
              icon={<Icon name="close-small" />}
              aria-label={ctx.t("git.dismiss")}
              onClick={git.clearError}
            />
          </div>
        )}
      </Show>
    </div>
  )
}
