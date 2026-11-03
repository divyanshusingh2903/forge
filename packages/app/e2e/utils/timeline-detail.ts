import type { Page } from "@playwright/test"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"

// Forge shows every action by default. These specs were written against upstream's Compact timeline, which groups tools.
const compact = timelinePresets.find((preset) => preset.id === "compact")?.value ?? timelinePresets[0].value

/**
 * The old shell, edit and reasoning flags only set those categories, and Forge fills the rest with its show-everything
 * default. This keeps upstream's grouping for the others.
 */
export function legacyTimelineDetail(flags: { shell?: boolean; edit?: boolean; thinking?: boolean }) {
  const activity = (expanded: boolean | undefined) =>
    ({ placement: expanded ? "separate" : "grouped", details: expanded ? "expanded" : "collapsed" }) as const

  return { ...compact, shell: activity(flags.shell), edit: activity(flags.edit), thinking: activity(flags.thinking) }
}

/** Saves upstream's Compact timeline as a choice, so Forge's migration keeps it. */
export async function installCompactTimeline(page: Page) {
  await page.addInitScript((timelineDetail) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { timelineDetail, timelineExpanded: true } }))
  }, compact)
}
