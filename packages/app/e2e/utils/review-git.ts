import { expect, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "./mock-server"
import { installSseTransport } from "./sse-transport"
import { expectSessionTitle } from "./waits"

export async function setupReviewGit(page: Page, input: { locale?: "ar" } = {}) {
  const locale = input.locale ? await import("../../src/i18n/ar") : await import("../../src/i18n/en")
  const strings = locale.dict
  const directory = "C:/OpenCode/ReviewGit"
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  const transport = await installSseTransport<unknown>(page, { server })
  const state = {
    changes: [{ file: "file.txt", staged: false, unstaged: true, untracked: false }],
    remote: { upstream: false, ahead: 0, behind: 0 },
    info: { branch: "feature", default_branch: "main" } as { branch?: string; default_branch?: string },
    stashes: [{ ref: "stash@{0}", oid: "a".repeat(40), message: "Saved changes", createdAt: 1700000000000 }],
    operations: [] as { path: string; body: unknown }[],
    failure: "",
    result: { success: true, output: "Completed" },
  }
  await mockOpenCodeServer(page, {
    protocol: "v1",
    directory,
    project: {
      id: "proj_review_git",
      worktree: directory,
      vcs: "git",
      name: "review-git",
      sandboxes: [],
      time: { created: 1700000000000, updated: 1700000000000 },
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: "ses_review_git",
        slug: "review-git",
        title: "Review Git",
        projectID: "proj_review_git",
        directory,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    vcsDiff: [
      {
        file: "file.txt",
        additions: 1,
        deletions: 1,
        status: "modified",
        patch: "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n",
      },
    ],
    vcsChanges: () => state.changes,
    vcsRemote: () => state.remote,
    vcsInfo: () => state.info,
    vcsTargets: () => ({
      remotes: ["origin", "backup"],
      branches: [
        { remote: "origin", branch: "feature" },
        { remote: "backup", branch: "feature/remote" },
      ],
    }),
    vcsStashes: () => state.stashes,
    onGitOperation: (operation) => {
      state.operations.push(operation)
      if (state.failure)
        return { status: 400, body: { name: "VcsOperationError", data: { message: state.failure, operation: "pull" } } }
      if (!state.result.success) return { body: state.result }
      if (operation.path === "/vcs/push/upstream") state.remote.upstream = true
      if (operation.path === "/vcs/stash/pop" || operation.path === "/vcs/stash/drop") state.stashes = []
      return { body: state.result }
    },
  })
  await page.addInitScript(
    ({ directory, server, locale }) => {
      if (locale) localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale }))
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
        JSON.stringify([{ type: "session", server, sessionId: "ses_review_git" }]),
      )
    },
    { directory, server, locale: input.locale },
  )
  await page.goto(`/server/${base64Encode(server)}/session/ses_review_git`)
  await transport.waitForConnection()
  await expectSessionTitle(page, "Review Git")
  await page.getByRole("button", { name: strings["command.review.toggle"], exact: true }).click()
  await expect(
    page.getByRole("checkbox", {
      name: strings["session.review.git.stageFile"].replace("{{file}}", "file.txt"),
      exact: true,
    }),
  ).toBeVisible()
  return {
    state,
    directory,
    strings,
    changed: (directoryOverride = directory) =>
      transport.send({ directory: directoryOverride, payload: { type: "vcs.changed", properties: {} } }),
  }
}

export async function openGitMenu(page: Page, name: string, menu = "Remote actions") {
  await page.getByRole("button", { name: menu, exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}
