import type { Page } from "@playwright/test"

// Shortcut labels differ on macOS, where the app shows and listens for Cmd.
export function onMac(page: Page) {
  return page.evaluate(() => /(Mac|iPod|iPhone|iPad)/.test(navigator.platform))
}
