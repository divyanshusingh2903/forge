import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { useI18n } from "../context/i18n"
import { formatElapsed, useElapsed } from "./use-elapsed"

describe("formatElapsed", () => {
  test("formats under a minute as seconds", () => {
    createRoot((dispose) => {
      const i18n = useI18n()
      const numfmt = new Intl.NumberFormat(i18n.locale())
      expect(formatElapsed(i18n, numfmt, 12_000)).toBe("12s")
      dispose()
    })
  })

  test("formats a minute or more as minutes and seconds", () => {
    createRoot((dispose) => {
      const i18n = useI18n()
      const numfmt = new Intl.NumberFormat(i18n.locale())
      expect(formatElapsed(i18n, numfmt, 64_000)).toBe("1m 4s")
      dispose()
    })
  })

  test("rounds to the nearest second", () => {
    createRoot((dispose) => {
      const i18n = useI18n()
      const numfmt = new Intl.NumberFormat(i18n.locale())
      expect(formatElapsed(i18n, numfmt, 1_600)).toBe("2s")
      dispose()
    })
  })
})

describe("useElapsed", () => {
  test("returns undefined when start is undefined", () => {
    createRoot((dispose) => {
      const elapsed = useElapsed(
        () => undefined,
        () => undefined,
      )
      expect(elapsed()).toBeUndefined()
      dispose()
    })
  })

  test("returns the static end minus start once end is set", () => {
    createRoot((dispose) => {
      const elapsed = useElapsed(
        () => 1_000,
        () => 4_500,
      )
      expect(elapsed()).toBe(3_500)
      dispose()
    })
  })

  test("returns a live now-minus-start value while end is unset", () => {
    createRoot((dispose) => {
      const start = Date.now() - 2_000
      const elapsed = useElapsed(
        () => start,
        () => undefined,
      )
      const ms = elapsed()
      expect(ms).toBeGreaterThanOrEqual(2_000)
      expect(ms).toBeLessThan(3_000)
      dispose()
    })
  })
})
