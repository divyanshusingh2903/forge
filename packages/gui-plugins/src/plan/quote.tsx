import { onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode/ui/button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { usePlugin, type ComposerQuoteAnchor } from "@opencode/plugin/gui"

const SETTLE_MS = 150

const GAP = 8

// Matches the timeline's limit, so a quote never carries more than one from the conversation could.
const MAX_LENGTH = 20_000

type Size = { width: number; height: number }

/** Offers to quote text selected in the plan into the composer, like the timeline's and the terminal's Quote button. */
export function PlanQuote(props: {
  root: () => HTMLElement | undefined
  available: () => boolean
  add: (text: string, anchor?: ComposerQuoteAnchor) => void
}) {
  const plugin = usePlugin()
  const mac = /(Mac|iPhone|iPad)/.test(navigator.platform)

  const [state, setState] = createStore<{
    text: string | undefined
    truncated: boolean
    rect: DOMRect | undefined
    disposed: boolean
    size: Size
  }>({ text: undefined, truncated: false, rect: undefined, disposed: false, size: { width: 0, height: 0 } })

  let range: Range | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let pointer = false

  const close = () => {
    range = undefined
    clearTimeout(timer)
    setState({ text: undefined, truncated: false, rect: undefined })
  }

  // Only a settled selection inside the plan offers a quote, so a drag in progress never flickers the toolbar.
  const read = () => {
    const root = props.root()
    const selection = window.getSelection()
    const current = selection?.rangeCount ? selection.getRangeAt(0) : undefined

    if (!root || !selection || !current || current.collapsed || !root.contains(current.commonAncestorContainer))
      return close()
    const text = selection.toString().trim()

    if (!text) return close()
    range = current.cloneRange()
    setState({ text, truncated: text.length > MAX_LENGTH, rect: range.getBoundingClientRect() })
  }

  const schedule = () => {
    clearTimeout(timer)

    if (pointer) return

    timer = setTimeout(read, SETTLE_MS)
  }

  makeEventListener(document, "selectionchange", schedule)
  makeEventListener(document, "pointerdown", (event) => {
    pointer = event.target instanceof Node && !!props.root()?.contains(event.target)
  })
  makeEventListener(document, "pointerup", () => {
    if (!pointer) return

    pointer = false
    schedule()
  })
  makeEventListener(document, "keydown", (event) => {
    if (event.key === "Escape" && state.text !== undefined) close()
  })
  // Scrolling the plan moves the selection under a fixed toolbar.
  makeEventListener(
    window,
    "scroll",
    () => {
      if (range) setState("rect", range.getBoundingClientRect())
    },
    { capture: true, passive: true },
  )

  onCleanup(() => {
    // The composer can retain a memoized anchor after this component is disposed.
    setState("disposed", true)
    clearTimeout(timer)
  })

  const add = (skip: boolean) => {
    const text = state.text
    const quoted = range

    if (!text || state.truncated || !quoted) return

    const anchor: ComposerQuoteAnchor = (size) => {
      if (state.disposed || !props.available() || !quoted.startContainer.isConnected) return

      return position(size, quoted.getBoundingClientRect())
    }

    window.getSelection()?.removeAllRanges()
    close()
    props.add(text, skip ? undefined : anchor)
  }

  // Above the selection when it fits inside the plan, otherwise below it, centered and kept inside the plan.
  const position = (size: Size, rect: DOMRect | undefined) => {
    const root = props.root()

    if (!root || !rect || (rect.width === 0 && rect.height === 0)) return
    const bounds = root.getBoundingClientRect()

    if (rect.bottom < bounds.top || rect.top > bounds.bottom) return
    const above = rect.top - size.height - GAP

    return {
      top: above >= bounds.top + GAP ? above : Math.min(rect.bottom + GAP, bounds.bottom - size.height - GAP),
      left: Math.min(
        Math.max(rect.left + (rect.width - size.width) / 2, bounds.left + GAP),
        bounds.right - size.width - GAP,
      ),
    }
  }

  return (
    <Show when={state.text !== undefined && props.available() && position(state.size, state.rect)}>
      {(place) => (
        <Portal>
          <div
            ref={(value) =>
              createResizeObserver(value, () =>
                setState("size", { width: value.offsetWidth, height: value.offsetHeight }),
              )
            }
            data-component="plan-quote"
            data-prevent-autofocus
            role="toolbar"
            aria-label={plugin.t("quote.actions")}
            class="fixed z-50 flex items-center gap-0.5 rounded-[8px] bg-v2-background-bg-base p-0.5 shadow-[var(--v2-elevation-raised)] [[data-color-scheme=dark]_&]:bg-v2-background-bg-layer-01"
            style={{
              top: `${place().top}px`,
              left: `${place().left}px`,
              visibility: state.size.height === 0 ? "hidden" : undefined,
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <Show when={state.truncated}>
              <span class="px-2 text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted [font-weight:440]">
                {plugin.t("quote.tooLong")}
              </span>
            </Show>
            <Tooltip
              value={
                <>
                  {plugin.t("quote.addWithoutComment")}
                  <Keybind keys={[mac ? "⌥" : plugin.t("common.key.alt")]} variant="neutral" />
                </>
              }
              placement="top"
              openDelay={800}
            >
              <Button
                size="small"
                variant="ghost"
                icon="outline-quote"
                disabled={state.truncated}
                onClick={(event: MouseEvent) => add(event.altKey)}
              >
                {plugin.t("quote.add")}
              </Button>
            </Tooltip>
          </div>
        </Portal>
      )}
    </Show>
  )
}
