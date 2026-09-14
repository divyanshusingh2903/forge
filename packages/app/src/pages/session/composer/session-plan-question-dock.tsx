import { createEffect, createMemo, For, Show } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useMutation } from "@tanstack/solid-query"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { Keybind } from "@opencode-ai/ui/keybind"
import { showToast } from "@/utils/toast"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"

// Same numeric-shortcut convention as SessionPermissionDock: deny/no is
// always the most de-emphasized (ghost, lowest digit), the safest "go
// ahead" option is always primary and gets the highest digit.
const RANK: Record<string, number> = {
  Deny: 0,
  No: 0,
  Revise: 1,
  "Accept (Auto)": 2,
  "Accept (Manual)": 3,
  Yes: 3,
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

export function SessionPlanQuestionDock(props: {
  request: QuestionRequest
  toolName?: string
  onSubmit: () => void
}) {
  const language = useLanguage()
  const sdk = useSDK()
  const { view, tabs } = useSessionLayout()

  const openPlan = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    void tabs().open("plan")
    tabs().setActive("plan")
  }

  const question = createMemo(() => props.request.questions[0])
  const options = createMemo(() =>
    [...(question()?.options ?? [])].sort((a, b) => (RANK[a.label] ?? 1) - (RANK[b.label] ?? 1)),
  )
  const variantFor = (label: string) => {
    const rank = RANK[label] ?? 1
    if (rank === 0) return "ghost" as const
    const max = Math.max(...options().map((opt) => RANK[opt.label] ?? 1))
    return rank === max ? ("primary" as const) : ("secondary" as const)
  }

  const fail = (err: unknown) => {
    showToast({
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })
  }

  const replyMutation = useMutation(() => ({
    mutationFn: (label: string) =>
      sdk().api.question.reply({
        sessionID: props.request.sessionID,
        requestID: props.request.id,
        answers: [[label]],
      }),
    onMutate: () => props.onSubmit(),
    onError: fail,
  }))

  const sending = () => replyMutation.isPending

  const choose = (label: string) => {
    if (sending()) return
    void replyMutation.mutateAsync(label)
  }

  createEffect(() => {
    if (sending()) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (isEditableTarget(event.target)) return
      const index = Number(event.key) - 1
      const opt = options()[index]
      if (!opt) return
      event.preventDefault()
      choose(opt.label)
    }
    makeEventListener(window, "keydown", onKeyDown)
  })

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="bubble-5" size="normal" />
          </span>
          <div data-slot="permission-header-title">{question()?.question}</div>
        </div>
      }
      footer={
        <>
          <div>
            <Show when={props.toolName === "present_plan"}>
              <Button variant="ghost" size="normal" onClick={openPlan}>
                {language.t("session.plan.openButton")}
              </Button>
            </Show>
          </div>
          <div data-slot="permission-footer-actions">
            <For each={options()}>
              {(opt, i) => (
                <Button variant={variantFor(opt.label)} size="normal" disabled={sending()} onClick={() => choose(opt.label)}>
                  {opt.label}
                  <Keybind>{i() + 1}</Keybind>
                </Button>
              )}
            </For>
          </div>
        </>
      }
    >
      <></>
    </DockPrompt>
  )
}
