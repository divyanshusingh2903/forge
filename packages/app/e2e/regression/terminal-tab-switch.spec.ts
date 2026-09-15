import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/TerminalTabSwitch"
const projectID = "proj_terminal_tab_switch"
const sessionA = "ses_terminal_tab_a"
const sessionB = "ses_terminal_tab_b"
const titleA = "Alpha session"
const titleB = "Beta session"
const ptyA = "pty_tab_switch_a"
const ptyB = "pty_tab_switch_b"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
// Marks the terminal DOM node so a remount (fresh node) is detectable.
const PROBE = "original"

test.use({ viewport: { width: 1440, height: 900 } })

// Terminals are session-scoped: each session gets its own terminal set, and
// switching to a different session must not show the previous session's
// terminal(s). Switching back to a session must reconnect to that same
// session's own pty, not a fresh one and not the other session's.
test("keeps terminal sets independent when switching session tabs in the same workspace", async ({ page }) => {
  const connections = await setup(page)

  await page.goto(sessionHref(sessionA))
  await expectSessionTitle(page, titleA)

  await page.keyboard.press("Control+Backquote")
  const terminal = page.locator('[data-component="terminal"]')
  await expect(terminal).toBeVisible()
  await expect.poll(() => connections.length).toBe(1)
  expect(connectionPtyID(connections[0]!)).toBe(ptyA)
  await writeProbe(page)

  await switchTab(page, titleB)
  await expectSessionTitle(page, titleB)
  // Session B has never had a terminal of its own -- a brand new one gets
  // auto-created for it, distinct from session A's.
  await expect(terminal).toBeVisible()
  await expect.poll(() => connections.length).toBe(2)
  expect(connectionPtyID(connections[1]!)).toBe(ptyB)
  expect(await readProbe(page)).toBeUndefined()

  await switchTab(page, titleA)
  await expectSessionTitle(page, titleA)
  await expect(terminal).toBeVisible()
  // Reconnecting to A's own terminal set -- same pty as before, not a new one
  // and not B's. The DOM node itself is a fresh mount (session B's terminal
  // occupied that slot in between), so the probe does not survive; what
  // matters is that it's still ptyA being reconnected to, not a clone.
  await expect.poll(() => connections.length).toBe(3)
  expect(connectionPtyID(connections[2]!)).toBe(ptyA)
})

type Probed = HTMLElement & { __e2eProbe?: string }

async function switchTab(page: Page, title: string) {
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
}

async function writeProbe(page: Page) {
  await page.locator('[data-component="terminal"]').evaluate((el, probe) => {
    ;(el as Probed).__e2eProbe = probe
  }, PROBE)
}

async function readProbe(page: Page) {
  return page.locator('[data-component="terminal"]').evaluate((el) => (el as Probed).__e2eProbe)
}

function connectionPtyID(url: string) {
  const match = /\/api\/pty\/([^/]+)\/connect/.exec(new URL(url).pathname)
  return match?.[1]
}

async function setup(page: Page) {
  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "terminal-tab-switch",
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
    sessions: [session(sessionA, titleA, 1700000000000), session(sessionB, titleB, 1700000001000)],
    pageMessages: () => ({ items: [] }),
  })
  const created = { count: 0 }
  await page.route("**/api/pty*", (route) => {
    created.count += 1
    const info = created.count === 1 ? ptyInfo(ptyA) : ptyInfo(ptyB)
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ location: ptyLocation(), data: info }),
    })
  })
  await page.route(`**/api/pty/${ptyA}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ location: ptyLocation(), data: ptyInfo(ptyA) }),
    }),
  )
  await page.route(`**/api/pty/${ptyB}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ location: ptyLocation(), data: ptyInfo(ptyB) }),
    }),
  )
  await page.route(/\/api\/pty\/[^/]+\/connect-token/, (route) => {
    expect(route.request().headers()["x-opencode-ticket"]).toBe("1")
    const url = new URL(route.request().url())
    expect(url.searchParams.get("location[directory]")).toBe(directory)
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ location: ptyLocation(), data: { ticket: "e2e-ticket", expires_in: 60 } }),
    })
  })
  const connections: string[] = []
  await page.routeWebSocket(/\/api\/pty\/[^/]+\/connect/, (ws) => {
    connections.push(ws.url())
  })

  await page.addInitScript(
    ({ directory, server, sessions }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify(sessions.map((sessionId: string) => ({ type: "session", server, sessionId }))),
      )
    },
    { directory, server, sessions: [sessionA, sessionB] },
  )
  return connections
}

function session(id: string, title: string, created: number) {
  return {
    id,
    slug: id,
    projectID,
    directory,
    title,
    version: "dev",
    time: { created, updated: created },
  }
}

function sessionHref(sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

function ptyLocation() {
  return { directory, project: { id: projectID, directory } }
}

function ptyInfo(id: string) {
  return { id, title: "Terminal 1", command: "cmd.exe", args: [], cwd: directory, status: "running", pid: 1 }
}
