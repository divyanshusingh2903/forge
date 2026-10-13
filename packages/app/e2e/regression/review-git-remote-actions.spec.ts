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
