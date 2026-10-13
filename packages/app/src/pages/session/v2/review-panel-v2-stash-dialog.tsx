import { createEffect, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { Vcs } from "@opencode-ai/schema/vcs"
import { DialogV2, DialogHeader, DialogTitleGroup, DialogFooter } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { CheckboxV2 } from "@opencode-ai/ui/v2/checkbox-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import type { ReviewGit } from "./review-panel-v2-git"

export function ReviewStashDialog(props: { controller: ReviewGit }) {
  const sdk = useSDK()
  const current = sdk()
  const language = useLanguage()
  const dialog = useDialog()
  const git = props.controller.state
  createEffect(() => {
    if (sdk() !== current) dialog.close()
  })
  const [form, set] = createStore({
    message: "",
    includeUntracked: false,
    ready: false,
    drop: undefined as Vcs.Stash | undefined,
  })
  onMount(() => void props.controller.loadStashes().then(() => set("ready", true)))
  const act = (action: "apply" | "pop" | "drop", stash: Vcs.Stash) =>
    props.controller.run(() => {
      const input = { directory: current.directory, vcsStashInput: { ref: stash.ref, oid: stash.oid } }
      if (action === "apply") return current.client.instance.vcsStashApply(input, { throwOnError: true })
      if (action === "pop") return current.client.instance.vcsStashPop(input, { throwOnError: true })
      return current.client.instance.vcsStashDrop(input, { throwOnError: true })
    })
  return (
    <DialogV2 fit>
      <DialogHeader>
        <DialogTitleGroup title={language.t("session.review.git.stashes")} description={undefined} />
      </DialogHeader>
      <div class="flex flex-col gap-3 px-4 pb-4">
        <TextInputV2
          aria-label={language.t("session.review.git.stashMessage")}
          placeholder={language.t("session.review.git.stashMessage")}
          value={form.message}
          disabled={git.busy}
          onInput={(event) => set("message", event.currentTarget.value)}
        />
        <CheckboxV2
          label={language.t("session.review.git.includeUntracked")}
          checked={form.includeUntracked}
          onChange={(checked) => set("includeUntracked", checked)}
          disabled={git.busy}
        />
        <ButtonV2
          disabled={git.busy || !git.changes.length}
          onClick={async () => {
            const success = await props.controller.run(() =>
              current.client.instance.vcsStashCreate(
                {
                  directory: current.directory,
                  vcsStashCreateInput: {
                    ...(form.message.trim() ? { message: form.message.trim() } : {}),
                    includeUntracked: form.includeUntracked,
                  },
                },
                { throwOnError: true },
              ),
            )
            if (success && sdk() === current) set("message", "")
          }}
        >
          {language.t("session.review.git.stashCreate")}
        </ButtonV2>
        <Show when={git.stashError || git.error}>
          {(error) => (
            <div role="alert" class="text-text-danger">
              {error()}
            </div>
          )}
        </Show>
        <Show when={form.ready && !git.stashError && !git.stashes.length}>
          <p>{language.t("session.review.git.stashEmpty")}</p>
        </Show>
        <div class="max-h-80 overflow-y-auto" role="list" aria-label={language.t("session.review.git.stashes")}>
          <For each={git.stashes}>
            {(stash) => (
              <div role="listitem" class="flex flex-col gap-2 border-b border-border-weak-base py-2">
                <bdi dir="auto">
                  {stash.ref}: {stash.message}
                </bdi>
                <div class="flex flex-wrap gap-2">
                  <ButtonV2 disabled={git.busy} onClick={() => void act("apply", stash)}>
                    {language.t("session.review.git.stashApply")}
                  </ButtonV2>
                  <ButtonV2 disabled={git.busy} onClick={() => void act("pop", stash)}>
                    {language.t("session.review.git.stashPop")}
                  </ButtonV2>
                  <ButtonV2 variant="danger" disabled={git.busy} onClick={() => set("drop", stash)}>
                    {language.t("session.review.git.stashDrop")}
                  </ButtonV2>
                </div>
              </div>
            )}
          </For>
        </div>
        <Show when={form.drop}>
          {(stash) => (
            <div role="group" aria-label={language.t("session.review.git.stashDrop")} class="flex flex-col gap-2">
              <p>{language.t("session.review.git.stashDropConfirm", { stash: stash().ref })}</p>
              <div class="flex gap-2">
                <ButtonV2 variant="ghost" disabled={git.busy} onClick={() => set("drop", undefined)}>
                  {language.t("common.cancel")}
                </ButtonV2>
                <ButtonV2
                  variant="danger"
                  disabled={git.busy}
                  onClick={async () => {
                    if (await act("drop", stash())) set("drop", undefined)
                  }}
                >
                  {language.t("session.review.git.stashDrop")}
                </ButtonV2>
              </div>
            </div>
          )}
        </Show>
      </div>
      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}
