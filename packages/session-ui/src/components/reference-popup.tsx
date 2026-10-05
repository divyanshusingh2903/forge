import type { LinkPreviewResult } from "@opencode-ai/sdk/v2"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { ReferenceCard } from "./reference-card"
import { parseReference, type Reference } from "./reference"
import { createReferenceStatusCache } from "./reference-status"

const HOVER_DELAY_MS = 250
const WIDTH = 320
const GAP = 6
const MARGIN = 8

// A single popup for every `a[data-reference]` in the timeline. It listens at the document, so links produced by
// markdown post-processing and by Solid components behave identically, and nothing renders until one is used.
export function ReferencePopup(props: { resolve: (reference: Reference) => Promise<LinkPreviewResult> }) {
  const i18n = useI18n()
  const id = createUniqueId()
  const lookup = createReferenceStatusCache((reference) => props.resolve(reference))
  const [anchor, setAnchor] = createSignal<HTMLAnchorElement>()
  const [result, setResult] = createSignal<LinkPreviewResult>()
  const [popup, setPopup] = createSignal<HTMLDivElement>()
  const [position, setPosition] = createSignal({ top: 0, left: 0 })
  const reference = createMemo(() => {
    const link = anchor()
    return link ? parseReference(link.href) : undefined
  })
  let timer: ReturnType<typeof setTimeout> | undefined

  const hide = () => {
    clearTimeout(timer)
    setAnchor(undefined)
  }

  const show = (link: HTMLAnchorElement) => {
    clearTimeout(timer)
    setResult(undefined)
    setAnchor(link)
  }

  createEffect(() => {
    const link = anchor()
    const current = reference()
    if (!link || !current) return
    link.setAttribute("aria-describedby", id)
    onCleanup(() => link.removeAttribute("aria-describedby"))
    let stale = false
    onCleanup(() => (stale = true))
    void lookup(current).then((value) => {
      if (!stale) setResult(value)
    })
  })

  // Placed from the rendered height, which differs per kind and between loading and loaded.
  createEffect(() => {
    const link = anchor()
    const element = popup()
    result()
    if (!link || !element) return
    const rect = link.getBoundingClientRect()
    const height = element.offsetHeight
    const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - WIDTH - MARGIN)
    const below = rect.bottom + GAP
    // Flip above the link when the popup would run off the bottom of the viewport.
    setPosition({ left, top: below + height > window.innerHeight - MARGIN ? Math.max(MARGIN, rect.top - GAP - height) : below })
  })

  onMount(() => {
    const target = (event: Event) =>
      event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-reference]") : null
    const over = (event: PointerEvent) => {
      const link = target(event)
      if (!link || link === anchor()) return
      clearTimeout(timer)
      timer = setTimeout(() => show(link), HOVER_DELAY_MS)
    }
    const out = (event: PointerEvent) => {
      const link = target(event)
      if (!link || (event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) return
      hide()
    }
    const focus = (event: FocusEvent) => {
      const link = target(event)
      if (link) show(link)
    }
    const blur = (event: FocusEvent) => {
      if (target(event)) hide()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && anchor()) hide()
    }
    document.addEventListener("pointerover", over)
    document.addEventListener("pointerout", out)
    document.addEventListener("focusin", focus)
    document.addEventListener("focusout", blur)
    document.addEventListener("keydown", key)
    window.addEventListener("scroll", hide, true)
    onCleanup(() => {
      clearTimeout(timer)
      document.removeEventListener("pointerover", over)
      document.removeEventListener("pointerout", out)
      document.removeEventListener("focusin", focus)
      document.removeEventListener("focusout", blur)
      document.removeEventListener("keydown", key)
      window.removeEventListener("scroll", hide, true)
    })
  })

  return (
    <Show when={reference()}>
      {(current) => (
        <Portal>
          <div
            ref={setPopup}
            id={id}
            role="tooltip"
            data-component="reference-popup"
            style={{ top: `${position().top}px`, left: `${position().left}px`, width: `${WIDTH}px` }}
          >
            <Show
              when={result()}
              fallback={
                <div data-slot="reference-popup-pending">
                  <span data-slot="reference-popup-label">{label(current())}</span>
                  <span data-slot="reference-popup-message">{i18n.t("ui.reference.loading")}</span>
                </div>
              }
            >
              {(value) => (
                <Show
                  when={value().outcome === "ok"}
                  fallback={
                    <div data-slot="reference-popup-pending">
                      <span data-slot="reference-popup-label">{label(current())}</span>
                      <span data-slot="reference-popup-message">{i18n.t(messageKey(value().outcome))}</span>
                    </div>
                  }
                >
                  <ReferenceCard reference={current()} result={value()} />
                </Show>
              )}
            </Show>
          </div>
        </Portal>
      )}
    </Show>
  )
}

function label(reference: Reference) {
  if (reference.kind === "github-release") return `${reference.owner}/${reference.repo} ${reference.tag}`
  if ("owner" in reference) return `${reference.owner}/${reference.repo} #${reference.number}`
  return reference.id
}

function messageKey(outcome: LinkPreviewResult["outcome"]) {
  if (outcome === "forbidden") return "ui.reference.forbidden"
  if (outcome === "not-found") return "ui.reference.notFound"
  return "ui.reference.unavailable"
}
