import { expect, story } from "../../stories/playwright/story"

story("shows a notch per chapter and opens the list to jump inside a turn", async ({ mount, page }) => {
  await mount("plugins-chapters--mixed")

  const rail = page.getByRole("navigation", { name: "Chapters" })
  const notches = rail.locator('[data-slot="chapter-notch"]')
  await expect(notches).toHaveCount(3)
  // Only the chapter the viewport is in is marked as current.
  await expect(rail.locator('[data-slot="chapter-notch"][data-current]')).toHaveCount(1)
  await expect(notches.nth(1)).toHaveAttribute("data-current", "")
  // The titles stay out of the way until the notches are pointed at.
  const list = rail.locator('[data-slot="chapters-list"]')
  await expect(list).toHaveCSS("opacity", "0")

  await rail.hover()
  await expect(list).toHaveCSS("opacity", "1")
  const rows = list.locator('[data-slot="chapter-row"]')
  await expect(rows).toHaveText([
    "Set up the release workflow",
    "#4 Chapters tab in the session side panel",
    "Now write the tests for the plugin, the pin button and the rail",
  ])

  // A title too long for its row is cut, and its icon keeps the size of the others.
  const icons = await rows.locator('button[aria-label^="Jump to"] > :first-child').evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().width),
  )

  expect(new Set(icons).size).toBe(1)

  await page.getByRole("button", { name: "Jump to #4 Chapters tab in the session side panel" }).click()
  await expect(page.getByTestId("jumped")).toHaveText("msg_03 msg_04")
})

story("renames a chapter in place and removes one", async ({ mount, page }) => {
  await mount("plugins-chapters--mixed")

  const rail = page.getByRole("navigation", { name: "Chapters" })
  await rail.hover()
  const rows = rail.locator('[data-slot="chapter-row"]')
  await rows.nth(0).hover()
  await rows.nth(0).getByRole("button", { name: "Rename" }).click()
  const input = page.getByRole("textbox", { name: "Chapter title" })
  await input.fill("Release work")
  await input.press("Enter")
  await expect(rows.nth(0)).toContainText("Release work")

  // Escape leaves the title as it was.
  await rows.nth(0).hover()
  await rows.nth(0).getByRole("button", { name: "Rename" }).click()
  await input.fill("Discarded")
  await input.press("Escape")
  await expect(rows.nth(0)).toContainText("Release work")

  await rows.nth(2).hover()
  await rows.nth(2).getByRole("button", { name: "Remove" }).click()
  await expect(rows).toHaveCount(2)
  await expect(rail.locator('[data-slot="chapter-notch"]')).toHaveCount(2)
})

story("renders nothing for a session without chapters", async ({ mount, page }) => {
  await mount("plugins-chapters--empty")

  await expect(page.getByTestId("transcript")).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Chapters" })).toHaveCount(0)
})
