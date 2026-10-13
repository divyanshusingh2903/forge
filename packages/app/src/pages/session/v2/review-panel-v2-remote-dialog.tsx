import { createEffect, createUniqueId, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { DialogV2, DialogHeader, DialogTitleGroup, DialogFooter } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { RadioGroupV2, RadioItemV2 } from "@opencode-ai/ui/v2/radio-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import type { ReviewGit } from "./review-panel-v2-git"

export function ReviewRemoteDialog(props: { controller: ReviewGit; mode: "push" | "pull" }) {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useSDK()
  const current = sdk()
  const id = createUniqueId()
  const [form, set] = createStore({ remote: "", branch: "", strategy: "merge" })
  const git = props.controller.state
  createEffect(() => {
    if (sdk() !== current) dialog.close()
  })
  const configured = () => git.targets.pull ?? "merge"
  onMount(() => void props.controller.loadTargets())
  createEffect(() => {
    if (form.remote) return
    const target = git.remote.target
    const remote =
      target && git.targets.remotes.includes(target.remote)
        ? target.remote
        : git.targets.remotes.includes("origin")
          ? "origin"
          : ""
    if (remote) set({ remote, branch: target?.branch ?? git.info.branch ?? "", strategy: configured() })
  })
  const valid = () =>
    !!form.remote &&
    git.targets.remotes.includes(form.remote) &&
    (props.mode === "push" ? !!git.info.branch : !!form.branch.trim())
  return (
    <DialogV2 fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t(props.mode === "push" ? "session.review.git.pushUpstream" : "session.review.git.pull")}
          description={undefined}
        />
      </DialogHeader>
      <div class="flex flex-col gap-3 px-4 pb-4">
        <bdi dir="ltr">{git.info.branch}</bdi>
        <label class="flex flex-col gap-1">
          <span>{language.t("session.review.git.remote")}</span>
          <SelectV2
            modal
            aria-label={language.t("session.review.git.remote")}
            options={[...git.targets.remotes]}
            current={form.remote || undefined}
            onSelect={(remote) => set({ remote: remote ?? "", branch: "" })}
            disabled={git.busy}
          />
        </label>
        <Show when={props.mode === "pull"}>
          <label class="flex flex-col gap-1">
            <span>{language.t("session.review.git.branch")}</span>
            <TextInputV2
              dir="ltr"
              aria-label={language.t("session.review.git.branch")}
              list={id}
              value={form.branch}
              disabled={git.busy}
              onInput={(event) => set("branch", event.currentTarget.value)}
            />
            <datalist id={id}>
              <For each={git.targets.branches.filter((branch) => branch.remote === form.remote)}>
                {(branch) => <option value={branch.branch} />}
              </For>
            </datalist>
          </label>
          <RadioGroupV2
            label={language.t("session.review.git.strategy")}
            value={form.strategy}
            onChange={(value) => set("strategy", value)}
            disabled={git.busy}
          >
            <RadioItemV2 value="merge" label={language.t("session.review.git.merge")} />
            <RadioItemV2 value="rebase" label={language.t("session.review.git.rebase")} />
          </RadioGroupV2>
        </Show>
        <Show when={git.choicesError || git.error}>
          {(error) => (
            <div role="alert" class="text-text-danger">
              {error()}
            </div>
          )}
        </Show>
      </div>
      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          disabled={git.busy || !valid()}
          onClick={async () => {
            const success = await props.controller.run(() =>
              props.mode === "push"
                ? current.client.instance.vcsPushWithUpstream(
                    { directory: current.directory, vcsPushInput: { remote: form.remote, setUpstream: true } },
                    { throwOnError: true },
                  )
                : current.client.instance.vcsPullFrom(
                    {
                      directory: current.directory,
                      vcsPullInput: {
                        remote: form.remote,
                        branch: form.branch.trim(),
                        // Leave the configured strategy to Git so options like rebase=merges still apply.
                        ...(form.strategy === configured()
                          ? {}
                          : { strategy: form.strategy === "rebase" ? ("rebase" as const) : ("merge" as const) }),
                      },
                    },
                    { throwOnError: true },
                  ),
            )
            if (success && sdk() === current) dialog.close()
          }}
        >
          {language.t(props.mode === "push" ? "session.review.git.push" : "session.review.git.pull")}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}
