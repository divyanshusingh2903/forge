import { expect, story } from "../../stories/playwright/story"

story("lists tracked pull requests failing first, with merged ones folded away", async ({ mount, page }) => {
  await mount("plugins-pull-requests--mixed")

  const rows = page.locator('[data-slot="pull-request-row"]')
  await expect(rows).toHaveCount(5)
  await expect(page.getByText("5 tracked")).toBeVisible()

  // Failing CI sorts above running CI, above passing.
  const titles = rows.locator("> button")
  await expect(titles.nth(0)).toContainText("Track session pull requests")
  await expect(titles.nth(0)).toContainText("2 of 24 failing")
  await expect(titles.nth(1)).toContainText("Retry the webhook queue")
  await expect(titles.nth(1)).toContainText("CI running")
  await expect(titles.nth(2)).toContainText("Show sub-issue completion")
  await expect(titles.nth(2)).toContainText("CI passing")

  // The merged one is inside a closed group until it is opened.
  const merged = page.getByText("Fix scroll state")
  await expect(merged).toBeHidden()
  await page.getByText("Merged and closed").click()
  await expect(merged).toBeVisible()
})

story("expands a row into the card, failing checks and the auto-fix control", async ({ mount, page }) => {
  await mount("plugins-pull-requests--mixed")

  const first = page.locator('[data-slot="pull-request-row"]').first()
  const header = first.locator("> button")
  await expect(header).toHaveAttribute("aria-expanded", "false")
  await expect(first.getByRole("link", { name: "unit (macos)" })).toBeHidden()

  await header.click()
  await expect(header).toHaveAttribute("aria-expanded", "true")
  await expect(first.getByRole("link", { name: "unit (macos)" })).toHaveAttribute("href", /actions\/runs\/1$/)
  await expect(first.getByRole("link", { name: "e2e (windows, app-1)" })).toBeVisible()

  const toggle = first.getByRole("switch", { name: "Auto-fix CI" })
  await expect(toggle).toHaveAttribute("aria-checked", "true")
  await expect(first.getByText("Fixing, attempt 1 of 3")).toBeVisible()
  await expect(first.getByText("Opened by the agent")).toBeVisible()
  // The card's own refresh icon is not repeated: the row has the one Refresh button.
  await expect(first.getByRole("button", { name: "Refresh" })).toHaveCount(1)
})

story("confirms a copied link, then goes back to Copy link", async ({ mount, page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await mount("plugins-pull-requests--mixed")

  const first = page.locator('[data-slot="pull-request-row"]').first()
  await first.locator("> button").click()
  await first.getByRole("button", { name: "Copy link" }).click()

  await expect(first.getByRole("button", { name: "Copied" })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://github.com/forge/app/pull/84")
  await expect(first.getByRole("button", { name: "Copy link" })).toBeVisible()
})

story("offers no auto-fix on a missing, merged or closed pull request", async ({ mount, page }) => {
  await mount("plugins-pull-requests--mixed")

  const rows = page.locator('[data-slot="pull-request-row"]')
  // The missing one is the last open row; the merged one is inside the folded group.
  const missing = rows.nth(3)
  await missing.locator("> button").click()
  await expect(missing.getByText(/not found/)).toBeVisible()
  await expect(missing.getByRole("switch")).toHaveCount(0)
  await expect(missing.getByRole("button", { name: "Refresh" })).toBeVisible()

  await page.getByText("Merged and closed").click()
  const merged = rows.nth(4)
  await merged.locator("> button").click()
  await expect(merged.getByRole("button", { name: "Stop tracking" })).toBeVisible()
  await expect(merged.getByRole("switch")).toHaveCount(0)

  // An open pull request keeps its switch.
  const open = rows.first()
  await open.locator("> button").click()
  await expect(open.getByRole("switch", { name: "Auto-fix CI" })).toBeVisible()
})

story("a paused fix says so, offers Resume, and shows when the status went stale", async ({ mount, page }) => {
  await mount("plugins-pull-requests--mixed")

  const row = page.locator('[data-slot="pull-request-row"]').nth(2)
  await row.locator("> button").click()

  await expect(row.getByText("Paused")).toBeVisible()
  await expect(row.getByRole("button", { name: "Resume" })).toBeVisible()
  // The last refresh failed: it is called stale, never presented as live.
  await expect(row.getByText(/Stale since/)).toBeVisible()
  await expect(row.getByText(/rate-limited, will retry/)).toBeVisible()
})

story("shows the empty state with how to start tracking", async ({ mount, page }) => {
  await mount("plugins-pull-requests--empty")

  await expect(page.getByText("No pull requests tracked in this session")).toBeVisible()
  await expect(page.getByPlaceholder("Paste a GitHub PR or GitLab MR link")).toBeVisible()
  await expect(page.locator('[data-slot="pull-request-row"]')).toHaveCount(0)
})
