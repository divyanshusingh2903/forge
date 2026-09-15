import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import type { UiI18n } from "../context/i18n"

/**
 * Reactive elapsed-ms accessor: ticks once a second while `end` is not yet
 * set, freezes at `end() - start()` once it is. Returns undefined until
 * `start` itself is known (e.g. a tool call still pending).
 */
export function useElapsed(start: Accessor<number | undefined>, end: Accessor<number | undefined>) {
  const [now, setNow] = createSignal(Date.now())
  const ticking = createMemo(() => start() !== undefined && end() === undefined)
  let interval: ReturnType<typeof setInterval> | undefined

  createEffect(() => {
    if (!ticking()) {
      clearInterval(interval)
      interval = undefined
      return
    }
    if (interval) return
    setNow(Date.now())
    interval = setInterval(() => setNow(Date.now()), 1000)
  })

  onCleanup(() => clearInterval(interval))

  return createMemo(() => {
    const startMs = start()
    if (startMs === undefined) return undefined
    const endMs = end()
    return (endMs ?? now()) - startMs
  })
}

export function formatElapsed(i18n: Pick<UiI18n, "t">, numfmt: Intl.NumberFormat, ms: number) {
  const total = Math.round(Math.max(ms, 0) / 1000)
  if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt.format(total) })
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return i18n.t("ui.message.duration.minutesSeconds", {
    minutes: numfmt.format(minutes),
    seconds: numfmt.format(seconds),
  })
}
