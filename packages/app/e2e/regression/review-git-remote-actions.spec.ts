import { expect, test } from "@playwright/test"
import { setupReviewGit, openGitMenu } from "../utils/review-git"

test("publishes a new branch with origin upstream", async ({ page }) => {
  const git = await setupReviewGit(page)
  await openGitMenu(page, "Push and set upstream")
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("group", { name: "Remote", exact: true }).getByRole("button")).toHaveText("origin")
  await dialog.getByRole("button", { name: "Push", exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(git.state.operations).toEqual([{ path: "/vcs/push/upstream", body: { remote: "origin", setUpstream: true } }])
})

test("offers push with upstream as the primary action once a new branch is committed", async ({ page }) => {
  const git = await setupReviewGit(page)
  git.state.changes = []
  git.state.remote = { upstream: false, ahead: 1, behind: 0 }
  await git.changed()
  const primary = page.getByRole("button", { name: /^Push and set upstream\s*1$/ })
  await expect(primary).toBeVisible()
  await primary.click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Push", exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(git.state.operations).toEqual([{ path: "/vcs/push/upstream", body: { remote: "origin", setUpstream: true } }])
  await expect(page.getByRole("button", { name: "Fetch", exact: true })).toBeVisible()
})

test("pulls an explicit branch with rebase and surfaces conflicts", async ({ page }) => {
  const git = await setupReviewGit(page)
  await openGitMenu(page, "Pull")
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("group", { name: "Remote", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "backup", exact: true }).click()
  await dialog.getByRole("combobox", { name: "Branch", exact: true }).fill("feature/remote")
  await dialog.getByText("Rebase", { exact: true }).click()
  await expect(dialog.getByRole("radio", { name: "Rebase", exact: true })).toBeChecked()
  git.state.failure = "Merge conflict in file.txt"
  await dialog.getByRole("button", { name: "Pull", exact: true }).click()
  await expect(dialog.getByRole("alert")).toHaveText("Merge conflict in file.txt")
  expect(git.state.operations).toEqual([
    { path: "/vcs/pull/from", body: { remote: "backup", branch: "feature/remote", strategy: "rebase" } },
  ])
})

test("a rejected operation keeps the form open and releases the busy state", async ({ page }) => {
  const git = await setupReviewGit(page)
  git.state.result = { success: false, output: "Push rejected" }
  await openGitMenu(page, "Push and set upstream")
  const dialog = page.getByRole("dialog")
  const push = dialog.getByRole("button", { name: "Push", exact: true })
  await expect(push).toBeEnabled()
  await push.click()
  await expect(dialog.getByRole("alert")).toHaveText("Push rejected")
  await expect(push).toBeEnabled()
})
