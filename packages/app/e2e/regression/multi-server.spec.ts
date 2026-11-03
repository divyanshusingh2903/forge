import { expect, test, type Page } from "@playwright/test"
import { REMOTE_SERVER, SERVER, expectPath, project, seed, session, sessionHref, type TabSeed } from "../utils/app"
import { mockServers, type MockServerConfig } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directoryA = "C:/server-a"

const directoryB = "/home/server-b"

const sessionA = session({ id: "ses_server_a", directory: directoryA, title: "Server A session" })

const childA = session({
  id: "ses_server_a_child",
  directory: directoryA,
  title: "Server A child",
  parentID: sessionA.id,
})

const sessionB = session({ id: "ses_server_b", directory: directoryB, title: "Server B session" })

type Reply = { origin: string; sessionID: string; permissionID: string; body: unknown }

test.use({ serviceWorkers: "block" })

function pending(id: string, sessionID: string) {
  return { id, sessionID, action: "shell", resources: ["git status"], metadata: {}, save: [] }
}

async function setup(page: Page, input: { tabs: TabSeed[]; a?: Partial<MockServerConfig> }) {
  const replies: Reply[] = []

  const config = (origin: string, name: string, directory: string, sessions: ReturnType<typeof session>[]) => {
    const id = name.toLowerCase().replace(" ", "-")

    return {
      directory,
      project: project({ id: `proj_${id}`, directory }),
      provider: {
        all: [{ id, name: `${name} Provider`, models: { [id]: { id, name: `${name} Model` } } }],
        connected: [id],
        default: { providerID: id, modelID: id },
      },
      sessions,
      pageMessages: () => ({ items: [] }),
      sessionStatus: Object.fromEntries(sessions.map((item) => [item.id, { type: "running" }])),
      strictDirectory: true,
      onPermissionReply: (reply: Omit<Reply, "origin">) => replies.push({ origin, ...reply }),
    }
  }

  await mockServers(page, {
    [SERVER]: {
      ...config(SERVER, "Server A", directoryA, [sessionA, childA]),
      ...input.a,
    },
    [REMOTE_SERVER]: config(REMOTE_SERVER, "Server B", directoryB, [sessionB]),
  })

  await seed(page, { servers: [REMOTE_SERVER], tabs: input.tabs })

  return {
    replies,
    enableAutoAccept: () => enableAutoAccept(page),
  }
}

async function enableAutoAccept(page: Page) {
  await page.keyboard.press("Control+,")
  const autoAccept = page.getByTestId("settings-screen").locator('[data-action="settings-auto-accept-permissions"]')
  await autoAccept.locator('[data-slot="switch-control"]').click()
  await expect(autoAccept.getByRole("switch")).toBeChecked()
}

test("settings opened from a remote session keep the remote scope", async ({ page }) => {
  const view = await setup(page, { tabs: [], a: { permissions: [pending("permission-pending-a", sessionA.id)] } })
  await page.goto(sessionHref(sessionB.id, REMOTE_SERVER))
  await expectSessionTitle(page, sessionB.title)

  await view.enableAutoAccept()
  const settings = page.getByTestId("settings-screen")
  await expect(page).toHaveURL("/settings")
  await expect(page.locator('[data-titlebar-tab][data-active="true"]')).toHaveCount(0)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  // The server settles requests by session mode; the setting only picks the mode new sessions start in.
  expect(view.replies).toEqual([])

  // Per-server pages start on the server of the tab settings opened from.
  await settings.getByRole("tab", { name: "Models", exact: true }).click()
  await expect(settings.getByRole("button", { name: "Server 127.0.0.1:4097", exact: true })).toBeVisible()
  await expect(settings.getByRole("switch", { name: "Server B Model" })).toBeEnabled()
  await expect(settings.getByRole("switch", { name: "Server A Model" })).toHaveCount(0)
  await settings.getByRole("button", { name: "Back to app" }).click()
  await expect(settings).toBeHidden()
  await expectPath(page, sessionHref(sessionB.id, REMOTE_SERVER))
  await expect(page.locator('[data-titlebar-tab][data-active="true"]')).toContainText(sessionB.title)
  await page.keyboard.press("Control+]")
  await expect(page).toHaveURL("/settings?tab=models")
  await expect(settings.getByRole("tab", { name: "Models", exact: true })).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Escape")
  await expectPath(page, sessionHref(sessionB.id, REMOTE_SERVER))
  await expectSessionTitle(page, sessionB.title)
})

test("the auto-approve setting leaves open sessions' requests to their mode", async ({ page }) => {
  const view = await setup(page, {
    tabs: [sessionA.id],
    a: { sessionPermissions: { [sessionA.id]: [pending("permission-manual-a", sessionA.id)] } },
  })

  const dock = page.locator('[data-component="dock-prompt"][data-kind="permission"]')

  await page.goto(sessionHref(sessionA.id))
  await expectSessionTitle(page, sessionA.title)
  await expect(dock.getByText("git status")).toBeVisible()
  await view.enableAutoAccept()
  await page.getByTestId("settings-screen").getByRole("button", { name: "Back to app" }).click()

  await expectSessionTitle(page, sessionA.title)
  await expect(dock.getByText("git status")).toBeVisible()
  expect(view.replies).toEqual([])
})
