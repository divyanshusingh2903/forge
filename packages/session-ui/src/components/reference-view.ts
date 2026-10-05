import type { LinkPreviewResult } from "@opencode-ai/sdk/v2"
import type { Reference } from "./reference"

export type Tone = "success" | "warning" | "danger" | "done" | "accent" | "muted"

// Colour carries the same meaning each provider uses: green open, purple merged or completed, red a closed pull
// request or a cancelled item, amber work in progress, grey anything not started or not final.
export function stateTone(reference: Reference, result: LinkPreviewResult): Tone {
  const state = result.state
  if (reference.kind === "github-issue")
    return state === "open" ? "success" : state === "not-planned" ? "muted" : "done"
  if (reference.kind === "github-pr") {
    if (state === "open") return "success"
    if (state === "merged") return "done"
    return state === "draft" ? "muted" : "danger"
  }
  if (reference.kind === "github-release")
    return state === "prerelease" ? "warning" : state === "draft" ? "muted" : "accent"
  if (result.stateType === "started") return "warning"
  if (result.stateType === "completed") return "done"
  if (result.stateType === "canceled") return "danger"
  return "muted"
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
]

// "3 days ago" style text in the UI locale; undefined for a missing or unparsable timestamp.
export function relativeTime(iso: string | undefined, locale: string, now = Date.now()) {
  const time = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(time)) return
  const seconds = Math.round((time - now) / 1000)
  const [unit, size] = UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? ["second", 1]
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(seconds / size), unit)
}

export function compactNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

// Linear reports "No priority" as a real value; showing it would only add noise.
export function visiblePriority(priority: string | undefined) {
  return priority && priority.toLowerCase() !== "no priority" ? priority : undefined
}

export function initials(name: string) {
  return name.replace(/\[bot\]$/i, "").slice(0, 1).toUpperCase() || "?"
}
