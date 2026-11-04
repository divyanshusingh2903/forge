import type { Page } from "@playwright/test"

// Shortcut labels differ on macOS, where the app shows and listens for Cmd.
export function onMac(page: Page) {
  return page.evaluate(() => /(Mac|iPod|iPhone|iPad)/.test(navigator.platform))
}

// Ctrl+Home and Ctrl+End move to the start and end of a document everywhere except macOS, where Cmd+Up and Cmd+Down do
// in text. Chromium on macOS scrolls a plain region only for Home and End, so `scroller` takes those there.
export async function documentKey(page: Page, edge: "start" | "end", target: "text" | "scroller" = "text") {
  if (await onMac(page)) {
    if (target === "scroller") return edge === "start" ? "Home" : "End"

    return edge === "start" ? "Meta+ArrowUp" : "Meta+ArrowDown"
  }

  return edge === "start" ? "Control+Home" : "Control+End"
}
