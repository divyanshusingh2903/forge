import { For, Show, createMemo, createSignal, type Accessor } from "solid-js"
import type { SessionContextUsage } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { useI18n } from "@opencode/ui/context/i18n"
import { usePlugin } from "@opencode/plugin/gui"

type CategoryID = SessionContextUsage["categories"][number]["id"]

// Fixed hues keep a category's colour stable as its share changes; messages lead in blue like the conversation.
const COLORS: Record<CategoryID, string> = {
  messages: "var(--v2-blue-600)",
  system: "var(--v2-grey-600)",
  tools: "var(--v2-orange-600)",
  mcpTools: "var(--v2-cyan-600)",
  codeMode: "var(--v2-purple-600)",
  mcpInstructions: "var(--v2-cyan-800)",
  skills: "var(--v2-yellow-600)",
  instructions: "var(--v2-green-600)",
  memory: "var(--v2-pink-600)",
  references: "var(--v2-blue-800)",
  other: "var(--v2-grey-800)",
}

const BUFFER = "repeating-linear-gradient(135deg, var(--v2-grey-700) 0 2px, transparent 2px 5px)"

/**
 * What the next request is made of: a bar split by part, then each part's tokens and share of the input window, with
 * the room automatic compaction keeps free and what is left.
 */
export function ContextBreakdown(props: { usage: Accessor<SessionContextUsage | undefined> }) {
  const ctx = usePlugin()
  const i18n = useI18n()

  const compact = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  const percent = createMemo(() => new Intl.NumberFormat(i18n.locale(), { style: "percent", maximumFractionDigits: 1 }))

  const view = createMemo(() => {
    const value = props.usage()

    if (!value) return

    // Messages first, then the fixed parts largest first, as they would be read off the bar.
    const categories = value.categories.toSorted((a, b) =>
      a.id === "messages" ? -1 : b.id === "messages" ? 1 : b.tokens - a.tokens,
    )

    const window = value.limit
    const buffer = window && value.threshold ? Math.max(0, window - value.threshold) : 0
    const free = window ? Math.max(0, window - value.total - buffer) : 0

    return { value, categories, window, buffer, free, scale: window ?? value.total }
  })

  const share = (tokens: number) => {
    const scale = view()?.scale

    return scale ? tokens / scale : 0
  }

  return (
    <Show when={view()}>
      {(view) => (
        <div data-slot="context-breakdown" class="flex flex-col gap-3">
          <div class="flex items-baseline justify-between gap-4">
            <div class="text-14-medium text-text-strong">
              <Show when={view().window} fallback={compact().format(view().value.total)}>
                {ctx.t("breakdown.used", { percent: percent().format(share(view().value.total)) })}
              </Show>
            </div>
            <div class="text-12-regular tabular-nums text-text-weak">
              <Show when={view().window} fallback={compact().format(view().value.total)}>
                {(window) =>
                  ctx.t("breakdown.window", {
                    used: compact().format(view().value.total),
                    limit: compact().format(window()),
                  })
                }
              </Show>
            </div>
          </div>

          <div
            role="img"
            aria-label={ctx.t("breakdown.bar")}
            class="flex h-2 w-full overflow-hidden rounded-full bg-v2-background-bg-layer-04 gap-px"
          >
            <For each={view().categories}>
              {(category) => (
                <div
                  class="h-full shrink-0"
                  style={{ width: `${share(category.tokens) * 100}%`, background: COLORS[category.id] }}
                />
              )}
            </For>
            <Show when={view().buffer > 0}>
              <div
                class="ml-auto h-full shrink-0"
                style={{ width: `${share(view().buffer) * 100}%`, background: BUFFER }}
              />
            </Show>
          </div>

          <Show when={view().value.threshold}>
            {(threshold) => (
              <div class="flex items-center justify-between text-12-regular">
                <span class="text-text-weak">{ctx.t("breakdown.autoCompact")}</span>
                <span class="tabular-nums text-text-base">{compact().format(threshold())}</span>
              </div>
            )}
          </Show>

          <div class="flex flex-col">
            <For each={view().categories}>
              {(category) => (
                <Row
                  label={ctx.t(`breakdown.category.${category.id}`)}
                  swatch={COLORS[category.id]}
                  tokens={compact().format(category.tokens)}
                  share={percent().format(share(category.tokens))}
                  items={category.items.toSorted((a, b) => b.tokens - a.tokens)}
                  format={(tokens) => compact().format(tokens)}
                />
              )}
            </For>
            <Show when={view().buffer > 0}>
              <Row
                label={ctx.t("breakdown.buffer")}
                swatch={BUFFER}
                tokens={compact().format(view().buffer)}
                share={percent().format(share(view().buffer))}
                items={[]}
                format={(tokens) => compact().format(tokens)}
              />
            </Show>
            <Show when={view().window}>
              <Row
                label={ctx.t("breakdown.free")}
                swatch="var(--v2-background-bg-layer-04)"
                tokens={compact().format(view().free)}
                share={percent().format(share(view().free))}
                items={[]}
                format={(tokens) => compact().format(tokens)}
              />
            </Show>
          </div>

          <div class="text-12-regular text-text-weak">
            {ctx.t(view().value.measured ? "breakdown.note.measured" : "breakdown.note.estimated")}
          </div>
        </div>
      )}
    </Show>
  )
}

function Row(props: {
  label: string
  swatch: string
  tokens: string
  share: string
  items: ReadonlyArray<{ name: string; tokens: number }>
  format: (tokens: number) => string
}) {
  const [open, setOpen] = createSignal(false)
  const expandable = () => props.items.length > 1

  return (
    <div class="flex flex-col">
      <div
        class="flex h-7 items-center gap-2 text-12-regular"
        classList={{ "cursor-pointer": expandable() }}
        role={expandable() ? "button" : undefined}
        tabIndex={expandable() ? 0 : undefined}
        aria-expanded={expandable() ? open() : undefined}
        onClick={() => expandable() && setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!expandable() || (event.key !== "Enter" && event.key !== " ")) return
          event.preventDefault()
          setOpen((value) => !value)
        }}
      >
        <span aria-hidden="true" class="size-2.5 shrink-0 rounded-[3px]" style={{ background: props.swatch }} />
        <span class="min-w-0 truncate text-text-base">{props.label}</span>
        <Show when={expandable()}>
          <Icon
            name="chevron-right"
            size="small"
            class="shrink-0 text-text-weak transition-transform"
            classList={{ "rotate-90": open() }}
          />
        </Show>
        <span class="ml-auto shrink-0 tabular-nums text-text-strong">{props.tokens}</span>
        <span class="w-12 shrink-0 text-right tabular-nums text-text-weak">{props.share}</span>
      </div>
      <Show when={open()}>
        <For each={props.items}>
          {(item) => (
            <div class="flex h-6 items-center gap-2 pl-[18px] text-12-regular">
              <span class="min-w-0 truncate text-text-weak">{item.name}</span>
              <span class="ml-auto shrink-0 tabular-nums text-text-base">{props.format(item.tokens)}</span>
              <span class="w-12 shrink-0" />
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}

/**
 * The system prompt the next request sends, one collapsed part per source in the order the model reads them. Updates
 * that arrive mid-session are conversation messages, so they stay with the raw messages instead.
 */
export function ContextPrompt(props: { usage: Accessor<SessionContextUsage | undefined> }) {
  const ctx = usePlugin()
  const i18n = useI18n()

  const compact = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  return (
    <Show when={props.usage()?.prompt.length}>
      <div class="flex flex-col gap-2">
        <div class="text-12-regular text-text-weak">{ctx.t("systemPrompt.title")}</div>
        <div class="flex flex-col overflow-hidden rounded-md border border-v2-border-border-base bg-surface-base">
          <For each={props.usage()?.prompt}>
            {(part) => <PromptPart part={part} tokens={compact().format(Math.round(part.text.length / 4))} />}
          </For>
        </div>
      </div>
    </Show>
  )
}

function PromptPart(props: { part: SessionContextUsage["prompt"][number]; tokens: string }) {
  const ctx = usePlugin()
  const [open, setOpen] = createSignal(false)
  const toggle = () => !window.getSelection()?.toString() && setOpen((value) => !value)

  return (
    <div class="flex flex-col border-b border-v2-border-border-base last:border-b-0">
      <div
        class="flex h-8 cursor-pointer items-center gap-2 px-3 text-12-regular"
        role="button"
        tabIndex={0}
        aria-expanded={open()}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          setOpen((value) => !value)
        }}
      >
        <span
          aria-hidden="true"
          class="size-2.5 shrink-0 rounded-[3px]"
          style={{ background: COLORS[props.part.id] }}
        />
        <span class="shrink-0 text-text-base">
          {props.part.name === "base" ? ctx.t("breakdown.prompt.base") : ctx.t(`breakdown.category.${props.part.id}`)}
        </span>
        <Show when={props.part.name !== "base"}>
          <span class="min-w-0 truncate text-text-weak">{props.part.name}</span>
        </Show>
        <span class="ml-auto shrink-0 tabular-nums text-text-weak">~{props.tokens}</span>
        <Icon
          name="chevron-right"
          size="small"
          class="shrink-0 text-text-weak transition-transform"
          classList={{ "rotate-90": open() }}
        />
      </div>
      <Show when={open()}>
        <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 font-mono text-12-regular text-text-base select-text">
          {props.part.text}
        </pre>
      </Show>
    </div>
  )
}
