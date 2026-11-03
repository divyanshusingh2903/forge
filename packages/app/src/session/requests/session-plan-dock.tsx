import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { Predicate } from "effect"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FormAnswer, FormInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { ComposerAttachments } from "@/composer/editor/editor"
import { useComposerState } from "@/composer/persistence"
import { ForgePlan } from "@opencode/schema/forge-plan"

// The answers Forge's plan plugin reads, by value. Anything else in `decision` is revision feedback.
const review = { manual: "Accept (Manual)", edits: "Accept (Auto)", revise: "Revise", deny: "Deny" } as const

// Read by the model ahead of quoted revision feedback, so it is not localized.
const quotedLead =
  "Revise the plan. The user quoted these parts of it, each followed by their comment when they left one:"

/** Forge's plan forms: `plan.review` when the plan agent presents its plan, and `plan.enter` when Build suggests Plan. */
export function isPlanForm(form: FormInfo | undefined) {
  const forge = form?.metadata?.forge

  return forge === "plan.review" || forge === "plan.enter"
}

/**
 * Asks for a decision on a plan the way the permission dock asks for one on a tool: a short header, the plan file,
 * and one button per answer. Revise opens a note for what to change, which reaches the agent as feedback. Text quoted
 * from the plan tab joins the revision with its comment, under the same chips the composer shows for quotes.
 */
export function SessionPlanDock(props: { request: FormInfo; onSubmit: () => void }) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const [sending, setSending] = createSignal(false)
  const [revising, setRevising] = createSignal(false)
  const [note, setNote] = createSignal("")
  const enter = () => props.request.metadata?.forge === "plan.enter"

  const plan = () => {
    const value = props.request.metadata?.plan

    return Predicate.isString(value) ? value : undefined
  }

  const prompt = useComposerState()

  // The plan tab attaches quotes to the composer, which this dock covers, so they are shown and sent from here.
  const quotes = createMemo(() => {
    const path = plan()

    if (enter() || !path) return []

    const subject = ForgePlan.quoteSubject(path)

    return prompt.context
      .items()
      .flatMap((item) => (item.type === "quote" && item.source?.subject === subject ? [item] : []))
  })

  // A new quote means the user is commenting on the plan, so the dock switches to revising.
  createEffect(
    on(
      () => quotes().length,
      (count, previous) => {
        if (count > (previous ?? 0)) setRevising(true)
      },
    ),
  )

  const reply = (answer: FormAnswer) => {
    if (sending()) return

    setSending(true)
    props.onSubmit()
    serverSDK.api.session.form
      .reply({ sessionID: props.request.sessionID, formID: props.request.id, answer })
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected promise carries any value
      .catch((error: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setSending(false))
  }

  const decide = (decision: string) => reply({ decision })

  const revise = () => {
    if (!revising()) return setRevising(true)

    const sent = quotes()

    const feedback = [
      ...sent.map((item) => {
        const quoted = item.text
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")

        return item.comment?.trim() ? `${quoted}\n\n${item.comment.trim()}` : quoted
      }),
      note().trim(),
    ]
      .filter(Boolean)
      .join("\n\n")

    if (!feedback) return decide(review.revise)

    decide(sent.length ? `${quotedLead}\n\n${feedback}` : feedback)
    prompt.capture().quoteComment.set(undefined)
    sent.forEach((item) => prompt.context.remove(item.key))
  }

  // The buttons in the order they show, so the number keys follow what the user reads left to right.
  const actions = () =>
    enter()
      ? [
          { label: "plan.dock.enter.no", variant: "ghost", run: () => reply({ switch: "No" }) } as const,
          { label: "plan.dock.enter.yes", variant: "submit", run: () => reply({ switch: "Yes" }) } as const,
        ]
      : [
          { label: "plan.dock.review.deny", variant: "ghost", run: () => decide(review.deny) } as const,
          {
            label: revising() ? "plan.dock.review.sendRevision" : "plan.dock.review.revise",
            variant: "neutral",
            run: revise,
          } as const,
          ...(revising()
            ? []
            : [
                { label: "plan.dock.review.manual", variant: "neutral", run: () => decide(review.manual) } as const,
                { label: "plan.dock.review.edits", variant: "submit", run: () => decide(review.edits) } as const,
              ]),
        ]

  // Number keys answer from anywhere but a text field, so the dock works without first clicking into it.
  makeEventListener(window, "keydown", (event) => {
    if (sending() || event.defaultPrevented || event.repeat || event.isComposing) return

    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return

    if (editable(event.target)) return

    const action = /^[1-9]$/.test(event.key) ? actions()[Number(event.key) - 1] : undefined

    if (!action) return

    event.preventDefault()
    action.run()
  })

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="file-document" size="normal" />
          </span>
          <div data-slot="permission-header-title">
            {language.t(enter() ? "plan.dock.enter.title" : "plan.dock.review.title")}
          </div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions" class="min-w-0 flex-wrap justify-end">
            <For each={actions()}>
              {(action, index) => (
                <Button
                  variant={action.variant}
                  size="normal"
                  disabled={sending()}
                  class="gap-2 whitespace-nowrap"
                  aria-keyshortcuts={String(index() + 1)}
                  onClick={action.run}
                >
                  {language.t(action.label)}
                  {/* The question dock's filled number hint. The theme's fill vanishes on the light submit button, so there
                      it is a shade of the button's own text color. */}
                  <Keybind
                    keys={[String(index() + 1)]}
                    variant="neutral"
                    aria-hidden="true"
                    style={
                      action.variant === "submit"
                        ? {
                            "--v2-background-bg-layer-03": "color-mix(in srgb, currentColor 14%, transparent)",
                            "--v2-text-text-muted": "color-mix(in srgb, currentColor 70%, transparent)",
                          }
                        : undefined
                    }
                  />
                </Button>
              )}
            </For>
          </div>
        </>
      }
    >
      <div data-slot="permission-row">
        <span data-slot="permission-spacer" aria-hidden="true" />
        <div data-slot="permission-hint">
          {language.t(enter() ? "plan.dock.enter.description" : "plan.dock.review.description")}
        </div>
      </div>
      <Show when={plan()}>
        {(path) => (
          <div data-slot="permission-row">
            <span data-slot="permission-spacer" aria-hidden="true" />
            <div data-slot="permission-patterns">
              <code class="text-text-base break-all">{path()}</code>
            </div>
          </div>
        )}
      </Show>
      <Show when={revising() && quotes().length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div class="min-w-0 flex-1 -mx-2">
            <ComposerAttachments
              attachments={[]}
              comments={quotes()}
              removeLabel={language.t("plan.dock.review.removeQuote")}
              preview={() => Promise.resolve(undefined)}
              onAttachmentRemove={() => {}}
              onCommentRemove={(item) => prompt.context.remove(item.key)}
              editingQuote={prompt.capture().quoteComment.key()}
              quoteAnchor={prompt.capture().quoteComment.anchor()}
              onEditQuote={(key) => prompt.capture().quoteComment.set(key)}
              onQuoteComment={(item, comment) => prompt.context.updateComment(item.commentID, { comment })}
            />
          </div>
        </div>
      </Show>
      <Show when={revising()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <textarea
            data-slot="plan-revision-note"
            // A quote's comment editor keeps focus when the quote opened revising.
            ref={(element) => queueMicrotask(() => !prompt.capture().quoteComment.key() && element.focus())}
            rows={3}
            class="w-full resize-none rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-base px-2.5 py-2 text-[13px] text-v2-text-text-base outline-none focus:border-v2-border-border-strong"
            placeholder={language.t("plan.dock.review.placeholder")}
            value={note()}
            onInput={(event) => setNote(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setRevising(false)

              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) revise()
            }}
          />
        </div>
      </Show>
    </DockPrompt>
  )
}

function editable(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))
}
