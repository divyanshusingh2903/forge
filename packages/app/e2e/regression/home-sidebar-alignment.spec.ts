import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test("keeps the projects sidebar aligned with the home panel", async ({ page }) => {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.addInitScript((directory) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  await page.goto("/")
  const sidebar = page.getByRole("complementary", { name: "Projects" })
  const panel = page.locator('[data-component="home-sessions"]')
  await expect(sidebar).toBeVisible()
  await expect(panel).toBeVisible()

  for (const height of [900, 700, 900]) {
    await page.setViewportSize({ width: 1440, height })
    await expect
      .poll(async () => {
        const [sidebarBox, panelBox] = await Promise.all([sidebar.boundingBox(), panel.boundingBox()])
        return (
          !!sidebarBox &&
          !!panelBox &&
          Math.abs(sidebarBox.y - panelBox.y) <= 1 &&
          Math.abs(sidebarBox.y + sidebarBox.height - panelBox.y - panelBox.height) <= 1
        )
      })
      .toBe(true)
  }
})
