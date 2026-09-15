import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/TerminalCursorFocus"
const projectID = "proj_terminal_cursor_focus"
const sessionID = "ses_terminal_cursor_focus"
const ptyID = "pty_terminal_cursor_focus"

test.use({ viewport: { width: 1440, height: 900 } })

for (const newLayoutDesigns of [true, false]) {
  test.describe(`terminal cursor focus (newLayoutDesigns=${newLayoutDesigns})`, () => {
    test.beforeEach(async ({ page }) => {
      await mockOpenCodeServer(page, {
        protocol: "v2",
        directory,
        project: {
          id: projectID,
          worktree: directory,
          vcs: "git",
          name: "terminal-cursor-focus",
          time: { created: 1700000000000, updated: 1700000000000 },
          sandboxes: [],
        },
        provider: {
          all: [
            {
              id: "opencode",
              name: "OpenCode",
              models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
            },
          ],
          connected: ["opencode"],
          default: { providerID: "opencode", modelID: "test" },
        },
        sessions: [
          {
            id: sessionID,
            slug: "terminal-cursor-focus",
            projectID,
            directory,
            title: "Terminal cursor focus",
            version: "dev",
            time: { created: 1700000000000, updated: 1700000000000 },
          },
        ],
        pageMessages: () => ({ items: [] }),
      })
      await page.route("**/api/pty*", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ location: ptyLocation(), data: ptyInfo() }),
        }),
      )
      await page.route(`**/api/pty/${ptyID}*`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ location: ptyLocation(), data: ptyInfo() }),
        }),
      )
      await page.route(`**/api/pty/${ptyID}/connect-token*`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ location: ptyLocation(), data: { ticket: "e2e-ticket", expires_in: 60 } }),
        }),
      )
      await page.routeWebSocket(new RegExp(`/api/pty/${ptyID}/connect`), () => undefined)
      await page.addInitScript(
        (newLayoutDesigns) => {
          localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns } }))
        },
        newLayoutDesigns,
      )
    })

    test("clicking the composer keeps it focused instead of the terminal reclaiming focus a moment later", async ({
      page,
    }) => {
      await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
      await expectSessionTitle(page, "Terminal cursor focus")

      const composer = page.locator('[data-component="prompt-input"]')
      const terminal = page.locator('[data-component="terminal"]')
      await page.keyboard.press("Control+Backquote")
      await expect(terminal).toBeVisible()
      await expect.poll(() => terminal.evaluate((element) => element.contains(document.activeElement))).toBe(true)

      await composer.click()
      await expect(composer).toBeFocused()

      // The legacy (non-V2) panel used to refocus the terminal on a fixed
      // schedule (rAF, then 120ms, then 240ms) regardless of what the user
      // did in between -- wait past all of them and confirm the composer is
      // still the one holding focus, not the terminal again.
      await page.waitForTimeout(300)
      await expect(composer).toBeFocused()
      await expect.poll(() => terminal.evaluate((element) => element.contains(document.activeElement))).toBe(false)
    })

    test("closing the terminal panel leaves nothing inside it focused", async ({ page }) => {
      await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
      await expectSessionTitle(page, "Terminal cursor focus")

      const terminal = page.locator('[data-component="terminal"]')
      await page.keyboard.press("Control+Backquote")
      await expect(terminal).toBeVisible()
      await expect.poll(() => terminal.evaluate((element) => element.contains(document.activeElement))).toBe(true)

      await page.keyboard.press("Control+Backquote")
      await expect
        .poll(() => page.evaluate(() => document.querySelector("#terminal-panel")?.contains(document.activeElement)))
        .toBeFalsy()
    })
  })
}

function ptyLocation() {
  return { directory, project: { id: projectID, directory } }
}

function ptyInfo() {
  return { id: ptyID, title: "Terminal 1", command: "cmd.exe", args: [], cwd: directory, status: "running", pid: 1 }
}
