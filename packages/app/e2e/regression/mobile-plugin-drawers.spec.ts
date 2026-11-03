import { expect, test } from "@playwright/test"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { sessionHref } from "../utils/app"
import { openWithDirection } from "../utils/direction"

for (const scheme of ["light", "dark"] as const) {
  for (const direction of ["ltr", "rtl"] as const) {
    test(`mobile plugins reuse the session drawer in ${scheme} ${direction}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await mockStressTimeline(page)
      await page.addInitScript((scheme) => {
        localStorage.setItem("opencode-color-scheme", scheme)
        localStorage.setItem("settings.v3", JSON.stringify({ general: { mobileTitlebarPosition: "bottom" } }))
      }, scheme)
      const warnings: string[] = []
      page.on("console", (event) => {
        if (event.text().includes("computations created outside")) warnings.push(event.text())
      })
      await openWithDirection(page, sessionHref(fixture.targetID), direction)
      const tabs = page.getByRole("tablist", { name: "Session view", exact: true })
      const more = tabs.getByRole("tab", { name: "More...", exact: true })
      await expect(tabs.getByRole("tab", { selected: true })).toHaveText("Session")
      await more.click()
      await page
        .getByRole("dialog", { name: "More options", exact: true })
        .getByRole("button", { name: "Session details", exact: true })
        .click()
      const details = page.getByRole("dialog", { name: "Session details", exact: true })
      // Forge lists MCPs from the desktop header's MCP button, so the drawer offers only the rest.
      await expect(details.getByRole("button", { name: "Plugins", exact: true })).toBeVisible()
      await details.evaluate((element) => element.setAttribute("data-drawer-probe", "single"))

      for (const [name, empty] of [
        ["Plugins", "No plugins configured"],
        ["Skills", "No skills configured"],
        ["LSP", "No LSP servers configured"],
      ]) {
        const trigger = details.getByRole("button", { name, exact: true })
        await trigger.click()
        const plugin = page.getByRole("dialog", { name, exact: true })
        await expect(plugin.getByText(empty, { exact: true })).toBeVisible()
        await expect(plugin).toHaveAttribute("data-drawer-probe", "single")
        await expect(page.getByRole("dialog")).toHaveCount(1)
        await expect(page.locator('[data-slot="mobile-drawer-overlay"]')).toHaveCount(1)
        await expect(plugin.getByRole("button", { name: "Close", exact: true })).toHaveCount(0)
        await expect(plugin.locator(".session-service-flyout")).toHaveCount(0)
        await expect(plugin).toBeInViewport({ ratio: 1 })
        await plugin.getByRole("button", { name: "Navigate back", exact: true }).click()
        await expect(details.getByRole("button", { name: "Plugins", exact: true })).toBeVisible()
        await expect(trigger).toBeFocused()
      }

      await details.getByRole("button", { name: "Skills", exact: true }).click()
      await expect(
        page.getByRole("dialog", { name: "Skills", exact: true }).getByText("No skills configured", { exact: true }),
      ).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath("plugins.png") })
      await testInfo.attach("plugins", { path: testInfo.outputPath("plugins.png"), contentType: "image/png" })
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect(more).toBeFocused()
      await more.click()
      await expect(
        page
          .getByRole("dialog", { name: "More options", exact: true })
          .getByRole("button", { name: "Files", exact: true }),
      ).toBeVisible()
      expect(warnings).toEqual([])
    })
  }
}

test("mobile plugin drawers keep configured lists, retry, and refresh working", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockStressTimeline(page)
  const state = { fail: true, extra: false }
  await page.route(
    (url) => url.pathname === "/api/plugin",
    (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback()

      if (state.fail) return route.fulfill({ status: 500, json: { message: "Unavailable" } })

      return route.fulfill({
        json: {
          location: { directory: fixture.directory },
          data: [
            {
              id: "drawer-plugin",
              source: { type: "package", target: "drawer-plugin" },
              features: {},
              state: { status: "active" },
            },
            ...(state.extra
              ? [
                  {
                    id: "extra-plugin",
                    source: { type: "package", target: "extra-plugin" },
                    features: {},
                    state: { status: "active" },
                  },
                ]
              : []),
          ],
        },
      })
    },
  )
  await page.route(
    (url) => url.pathname === "/api/skill",
    (route) =>
      route.fulfill({
        json: {
          location: { directory: fixture.directory },
          data: [
            { id: "drawer-skill", name: "drawer-skill", path: "/skills/drawer/SKILL.md", content: "Drawer skill" },
          ],
        },
      }),
  )
  await page.route(
    (url) => url.pathname === "/api/config",
    (route) =>
      route.fulfill({ json: [{ type: "document", info: { lsp: { "drawer-lsp": { command: ["drawer-lsp"] } } } }] }),
  )
  await openWithDirection(page, sessionHref(fixture.targetID), "ltr")
  const tabs = page.getByRole("tablist", { name: "Session view", exact: true })
  await expect(tabs.getByRole("tab", { selected: true })).toHaveText("Session")
  await tabs.getByRole("tab", { name: "More...", exact: true }).click()
  await page
    .getByRole("dialog", { name: "More options", exact: true })
    .getByRole("button", { name: "Session details", exact: true })
    .click()
  const details = page.getByRole("dialog", { name: "Session details", exact: true })
  await details.getByRole("button", { name: "Plugins", exact: true }).click()
  const plugins = page.getByRole("dialog", { name: "Plugins", exact: true })
  await expect(plugins.getByRole("alert")).toContainText("Request failed")
  state.fail = false
  await plugins.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(plugins.getByText("drawer-plugin", { exact: true })).toBeVisible()
  await plugins.getByRole("button", { name: "Navigate back", exact: true }).click()
  state.extra = true
  await details.getByRole("button", { name: "Plugins", exact: true }).click()
  await expect(plugins.getByText("extra-plugin", { exact: true })).toBeVisible()
  await plugins.getByRole("button", { name: "Navigate back", exact: true }).click()

  for (const [name, item] of [
    ["Skills", "drawer-skill"],
    ["LSP", "drawer-lsp"],
  ]) {
    await details.getByRole("button", { name, exact: true }).click()
    const plugin = page.getByRole("dialog", { name, exact: true })
    await expect(plugin.getByText(item, { exact: true })).toBeVisible()
    await plugin.getByRole("button", { name: "Navigate back", exact: true }).click()
  }
})
