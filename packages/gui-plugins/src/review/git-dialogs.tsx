import { For, Show, createResource, createUniqueId } from "solid-js"
import { createStore } from "solid-js/store"
import type { GitStash } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { RadioGroup, RadioItem } from "@opencode/ui/radio"
import { Select } from "@opencode/ui/select"
import { TextInput } from "@opencode/ui/text-input"
import { usePlugin, type DialogHandle } from "@opencode/plugin/gui"
import type Review from "./index"
import type { ReviewGit } from "./git"

/** Pushes the branch to a chosen remote and tracks it, or pulls a chosen remote branch with merge or rebase. */
export function GitRemoteDialog(props: { git: ReviewGit; mode: "push" | "pull"; dialog: DialogHandle }) {
  const ctx = usePlugin<typeof Review>()
  const id = createUniqueId()
  const git = props.git
  const branch = () => git.store.state?.branch
  const [targets] = createResource(() => git.targets())
  const [form, setForm] = createStore({ remote: "", branch: "", strategy: "", error: "" })
  const remotes = () => targets()?.remotes ?? []
  const configured = () => targets()?.pull ?? "merge"
  // Until the user picks, the branch's upstream remote, else origin, else the only remote.
  const remote = () => {
    if (form.remote) return form.remote
    const target = git.store.state?.remote.target
    if (target && remotes().includes(target.remote)) return target.remote
    if (remotes().includes("origin")) return "origin"
    return remotes().length === 1 ? remotes()[0] : ""
  }
  const pullBranch = () => form.branch || (form.remote ? "" : (git.store.state?.remote.target?.branch ?? branch() ?? ""))
  const strategy = () => form.strategy || configured()
  const valid = () => !!remote() && (props.mode === "push" ? !!branch() : !!pullBranch().trim())

  const submit = async () => {
    setForm("error", "")
    const done =
      props.mode === "push"
        ? await git.push({ remote: remote(), setUpstream: true })
        : await git.pull({
            remote: remote(),
            branch: pullBranch().trim(),
            // Leave the configured strategy to Git, so options such as rebase=merges still apply.
            ...(strategy() === configured() ? {} : { strategy: strategy() === "rebase" ? "rebase" : "merge" }),
          })
    if (done) return props.dialog.close()
    setForm("error", git.store.error)
  }

  return (
    <Dialog fit containerClass="!w-[min(calc(100vw_-_32px),420px)]">
      <DialogHeader closeLabel={ctx.t("common.close")}>
        <DialogTitleGroup title={ctx.t(props.mode === "push" ? "git.publish" : "git.pull")} />
      </DialogHeader>
      <DialogBody>
        <div class="flex flex-col gap-3 px-6 pb-2 text-13-regular text-v2-text-text-base">
          <bdi dir="ltr" class="text-v2-text-text-muted">
            {branch()}
          </bdi>
          <label class="flex flex-col gap-1">
            <span>{ctx.t("git.remote")}</span>
            <Select
              aria-label={ctx.t("git.remote")}
              options={[...remotes()]}
              current={remote() || undefined}
              onSelect={(value) => setForm({ remote: value ?? "", branch: "" })}
              disabled={git.store.busy}
            />
          </label>
          <Show when={props.mode === "pull"}>
            <label class="flex flex-col gap-1">
              <span>{ctx.t("git.branch")}</span>
              <TextInput
                dir="ltr"
                aria-label={ctx.t("git.branch")}
                list={id}
                value={pullBranch()}
                disabled={git.store.busy}
                onInput={(event) => setForm("branch", event.currentTarget.value)}
              />
              <datalist id={id}>
                <For each={targets()?.branches.filter((item) => item.remote === remote()) ?? []}>
                  {(item) => <option value={item.branch} />}
                </For>
              </datalist>
            </label>
            <RadioGroup
              label={ctx.t("git.strategy")}
              value={strategy()}
              onChange={(value) => setForm("strategy", value)}
              disabled={git.store.busy}
            >
              <RadioItem value="merge" label={ctx.t("git.merge")} />
              <RadioItem value="rebase" label={ctx.t("git.rebase")} />
            </RadioGroup>
          </Show>
          <Show when={form.error || (targets.error && String(targets.error))}>
            {(error) => (
              <div role="alert" class="whitespace-pre-wrap text-12-regular text-v2-state-fg-danger">
                {error()}
              </div>
            )}
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.dialog.close()}>
          {ctx.t("common.cancel")}
        </Button>
        <Button variant="contrast" disabled={git.store.busy || !valid()} onClick={() => void submit()}>
          {ctx.t(props.mode === "push" ? "git.push" : "git.pull")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Creates a stash and lists the stack, each with apply, pop and a confirmed drop. */
export function GitStashDialog(props: { git: ReviewGit; dialog: DialogHandle }) {
  const ctx = usePlugin<typeof Review>()
  const git = props.git
  const [stashes, { refetch }] = createResource(() => git.stashes())
  const [form, setForm] = createStore({
    message: "",
    includeUntracked: false,
    drop: undefined as GitStash | undefined,
  })
  const act = async (action: "apply" | "pop" | "drop", stash: GitStash) => {
    const done = await git.stashAction(action, stash)
    await refetch()
    return done
  }

  return (
    <Dialog fit containerClass="!w-[min(calc(100vw_-_32px),460px)]">
      <DialogHeader closeLabel={ctx.t("common.close")}>
        <DialogTitleGroup title={ctx.t("git.stashes")} />
      </DialogHeader>
      <DialogBody>
        <div class="flex flex-col gap-3 px-6 pb-2 text-13-regular text-v2-text-text-base">
          <TextInput
            aria-label={ctx.t("git.stashMessage")}
            placeholder={ctx.t("git.stashMessage")}
            value={form.message}
            disabled={git.store.busy}
            onInput={(event) => setForm("message", event.currentTarget.value)}
          />
          <Checkbox
            checked={form.includeUntracked}
            onChange={(checked: boolean) => setForm("includeUntracked", checked)}
            disabled={git.store.busy}
          >
            {ctx.t("git.includeUntracked")}
          </Checkbox>
          <div>
            <Button
              variant="neutral"
              disabled={git.store.busy || !git.store.state?.changes.length}
              onClick={async () => {
                const done = await git.stashCreate({
                  ...(form.message.trim() ? { message: form.message.trim() } : {}),
                  includeUntracked: form.includeUntracked,
                })
                if (done) setForm("message", "")
                await refetch()
              }}
            >
              {ctx.t("git.stashCreate")}
            </Button>
          </div>
          <Show when={git.store.error || (stashes.error && String(stashes.error))}>
            {(error) => (
              <div role="alert" class="whitespace-pre-wrap text-12-regular text-v2-state-fg-danger">
                {error()}
              </div>
            )}
          </Show>
          <Show when={stashes.state === "ready" && stashes()?.length === 0}>
            <p class="text-v2-text-text-muted">{ctx.t("git.stashEmpty")}</p>
          </Show>
          <div class="max-h-80 overflow-y-auto" role="list" aria-label={ctx.t("git.stashes")}>
            <For each={stashes.latest ?? []}>
              {(stash) => (
                <div role="listitem" class="flex flex-col gap-2 border-b border-v2-border-border-muted py-2">
                  <bdi dir="auto">
                    {stash.ref}: {stash.message}
                  </bdi>
                  <div class="flex flex-wrap gap-2">
                    <Button size="small" disabled={git.store.busy} onClick={() => void act("apply", stash)}>
                      {ctx.t("git.stashApply")}
                    </Button>
                    <Button size="small" disabled={git.store.busy} onClick={() => void act("pop", stash)}>
                      {ctx.t("git.stashPop")}
                    </Button>
                    <Button
                      size="small"
                      variant="ghost-danger"
                      disabled={git.store.busy}
                      onClick={() => setForm("drop", stash)}
                    >
                      {ctx.t("git.stashDrop")}
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </div>
          <Show when={form.drop}>
            {(stash) => (
              <div role="group" aria-label={ctx.t("git.stashDrop")} class="flex flex-col gap-2">
                <p>{ctx.t("git.stashDropConfirm", { stash: stash().ref })}</p>
                <div class="flex gap-2">
                  <Button variant="ghost" disabled={git.store.busy} onClick={() => setForm("drop", undefined)}>
                    {ctx.t("common.cancel")}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={git.store.busy}
                    onClick={async () => {
                      if (await act("drop", stash())) setForm("drop", undefined)
                    }}
                  >
                    {ctx.t("git.stashDrop")}
                  </Button>
                </div>
              </div>
            )}
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.dialog.close()}>
          {ctx.t("common.close")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
