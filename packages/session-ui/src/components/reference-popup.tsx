import type { LinkPreviewResult } from "@opencode/client/promise"
import { useI18n } from "@opencode/ui/context/i18n"
import { createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { ReferenceCard, ReferenceSkeleton } from "./reference-card"
import { parseReference, referenceLabel, type Reference } from "./reference"
import { createReferenceStatusCache } from "./reference-status"

const ciActive = (value: LinkPreviewResult | undefined) =>
  value?.ci?.status === "ok" && (value.ci.pending > 0 || !value.ci.complete)

const HOVER_DELAY_MS = 250

// Long enough to cross the gap between a link and its popup, short enough that moving away still feels immediate.
const HIDE_DELAY_MS = 150

// While CI is unfinished the open popup looks again this often, one request at a time.
const POLL_MS = 15_000

const WIDTH = 420

const GAP = 6

const MARGIN = 8

// A single popup for every `a[data-reference]` in the timeline: GitHub, GitLab, Linear and Jira links. It listens at the document, so links produced by
// markdown post-processing and by Solid components behave identically, and nothing renders until one is used.
// The pointer may travel from the link onto the popup, which stays open while it is over either, so its links and
// buttons can be used and its text selected.
export function ReferencePopup(props: { resolve: (reference: Reference) => Promise<LinkPreviewResult> }) {
  const i18n = useI18n()
  const id = createUniqueId()
  const cache = createReferenceStatusCache((reference) => props.resolve(reference))
  const [anchor, setAnchor] = createSignal<HTMLAnchorElement>()
  const [result, setResult] = createSignal<LinkPreviewResult>()
  const [popup, setPopup] = createSignal<HTMLDivElement>()
  const [position, setPosition] = createSignal({ top: 0, left: 0 })
  const [refreshing, setRefreshing] = createSignal(false)
  // The last refresh failed, so the card on screen may be out of date; it stays rather than being replaced by an error.
  const [stale, setStale] = createSignal(false)
  const [round, setRound] = createSignal(0)
  // The popup keeps its height while a refresh shows a skeleton, so it does not jump.
  const [held, setHeld] = createSignal(0)

  // Landscape where there is room, and never wider than the window on a narrow one.
  const width = () => Math.min(WIDTH, window.innerWidth - 2 * MARGIN)

  const reference = createMemo(() => {
    const link = anchor()

    return link ? parseReference(link.href) : undefined
  })

  let showTimer: ReturnType<typeof setTimeout> | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  const hide = () => {
    clearTimeout(hideTimer)
    setAnchor(undefined)
  }

  const scheduleHide = () => {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(hide, HIDE_DELAY_MS)
  }

  const show = (link: HTMLAnchorElement) => {
    clearTimeout(showTimer)
    clearTimeout(hideTimer)
    setResult(undefined)
    setStale(false)
    setRefreshing(false)
    setAnchor(link)
  }

  // A refreshed card replaces the one on screen; a failed refresh keeps it and says so.
  const refreshed = (value: LinkPreviewResult) => {
    if (value.outcome === "ok") {
      setResult(value)
      setStale(false)

      return
    }

    setStale(true)
  }

  const refresh = (current: Reference, link: HTMLAnchorElement | undefined) => {
    if (refreshing()) return Promise.resolve()
    setHeld(popup()?.offsetHeight ?? 0)
    setRefreshing(true)

    return cache
      .refresh(current)
      .then((value) => {
        if (anchor() === link) refreshed(value)
      })
      .finally(() => {
        if (anchor() === link) {
          setRefreshing(false)
          setRound((value) => value + 1)
        }
      })
  }

  createEffect(() => {
    const link = anchor()
    const current = reference()

    if (!link || !current) return
    link.setAttribute("aria-describedby", id)
    onCleanup(() => link.removeAttribute("aria-describedby"))
    let active = true
    onCleanup(() => (active = false))
    void cache.lookup(current).then((value) => {
      if (active) setResult(value)
    })
  })

  // Unfinished CI is looked at again while the popup stays open; a settled or failed one is left alone.
  createEffect(() => {
    const link = anchor()
    const current = reference()
    round()

    if (!link || !current || !ciActive(result()) || refreshing()) return
    const timer = setTimeout(() => void refresh(current, link), POLL_MS)
    onCleanup(() => clearTimeout(timer))
  })

  // Placed from the rendered height, which differs per kind and between loading and loaded.
  createEffect(() => {
    const link = anchor()
    const element = popup()
    result()

    if (!link || !element) return
    const rect = link.getBoundingClientRect()
    const height = element.offsetHeight
    const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - width() - MARGIN)
    const below = rect.bottom + GAP
    // Flip above the link when the popup would run off the bottom of the viewport.
    setPosition({ left, top: below + height > window.innerHeight - MARGIN ? Math.max(MARGIN, rect.top - GAP - height) : below })
  })

  onMount(() => {
    const target = (event: Event) =>
      event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-reference]") : null

    const inside = (node: EventTarget | null, container: Element | undefined) =>
      node instanceof Node && !!container?.contains(node)

    const over = (event: PointerEvent) => {
      // Back over the popup or the link it belongs to: stay open.
      if (inside(event.target, popup()) || (anchor() && inside(event.target, anchor()))) {
        clearTimeout(hideTimer)

        return
      }

      const link = target(event)

      if (!link) return
      clearTimeout(showTimer)
      showTimer = setTimeout(() => show(link), HOVER_DELAY_MS)
    }

    const out = (event: PointerEvent) => {
      const to = event.relatedTarget
      const link = target(event)

      // Moving between the link and the popup, or within either, does not leave.
      if (inside(to, popup()) || inside(to, anchor())) return

      if (link) {
        if (to instanceof Node && link.contains(to)) return
        clearTimeout(showTimer)

        if (link === anchor()) scheduleHide()

        return
      }

      if (inside(event.target, popup())) scheduleHide()
    }

    const focus = (event: FocusEvent) => {
      const link = target(event)

      if (link) show(link)
    }

    // Focus leaving for nowhere is not leaving: a button that is replaced, or disabled, loses focus that way.
    const blur = (event: FocusEvent) => {
      if (inside(event.relatedTarget, popup())) return

      if (target(event) || (event.relatedTarget && inside(event.target, popup()))) hide()
    }

    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && anchor()) hide()
    }

    // Scrolling the page moves the link away from the popup; scrolling inside the popup does not.
    const scroll = (event: Event) => {
      if (!inside(event.target, popup())) hide()
    }

    document.addEventListener("pointerover", over)
    document.addEventListener("pointerout", out)
    document.addEventListener("focusin", focus)
    document.addEventListener("focusout", blur)
    document.addEventListener("keydown", key)
    window.addEventListener("scroll", scroll, true)
    onCleanup(() => {
      clearTimeout(showTimer)
      clearTimeout(hideTimer)
      document.removeEventListener("pointerover", over)
      document.removeEventListener("pointerout", out)
      document.removeEventListener("focusin", focus)
      document.removeEventListener("focusout", blur)
      document.removeEventListener("keydown", key)
      window.removeEventListener("scroll", scroll, true)
    })
  })

  return (
    <Show when={reference()}>
      {(current) => (
        <Portal>
          <div
            ref={setPopup}
            id={id}
            role="group"
            aria-label={referenceLabel(current())}
            data-component="reference-popup"
            style={{
              top: `${position().top}px`,
              left: `${position().left}px`,
              width: `${width()}px`,
              "min-height": refreshing() ? `${held()}px` : undefined,
            }}
          >
            <Show
              when={result()}
              fallback={
                <div data-slot="reference-popup-pending">
                  <span data-slot="reference-popup-label">{referenceLabel(current())}</span>
                  <span data-slot="reference-popup-message">{i18n.t("ui.reference.loading")}</span>
                </div>
              }
            >
              {(value) => (
                <Show
                  when={value().outcome === "ok"}
                  fallback={
                    <div data-slot="reference-popup-pending">
                      <span data-slot="reference-popup-label">{referenceLabel(current())}</span>
                      <span data-slot="reference-popup-message">{i18n.t(messageKey(value().outcome))}</span>
                    </div>
                  }
                >
                  <Show
                    when={!refreshing()}
                    fallback={<ReferenceSkeleton />}
                  >
                    <ReferenceCard
                      reference={current()}
                      result={value()}
                      href={anchor()?.href}
                      stale={stale()}
                      onRefresh={() => void refresh(current(), anchor())}
                    />
                  </Show>
                </Show>
              )}
            </Show>
          </div>
        </Portal>
      )}
    </Show>
  )
}

function messageKey(outcome: LinkPreviewResult["outcome"]) {
  if (outcome === "forbidden") return "ui.reference.forbidden"

  if (outcome === "not-found") return "ui.reference.notFound"

  return "ui.reference.unavailable"
}
