import { expect, test } from "@playwright/test"
import { setupReviewGit, openGitMenu } from "../utils/review-git"

test("creates a stash with message and untracked files, then applies and drops a selected stash", async ({ page }) => {
  const git = await setupReviewGit(page)
  await openGitMenu(page, "Stashes")
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox", { name: "Stash message (optional)", exact: true }).fill("Work in progress")
  await dialog.getByText("Include untracked files", { exact: true }).click()
  await expect(dialog.getByRole("checkbox", { name: "Include untracked files", exact: true })).toBeChecked()
  await dialog.getByRole("button", { name: "Create stash", exact: true }).click()
  await expect(dialog.getByRole("textbox", { name: "Stash message (optional)", exact: true })).toHaveValue("")
  expect(git.state.operations[0]).toEqual({
    path: "/vcs/stash/create",
    body: { message: "Work in progress", includeUntracked: true },
  })
  const row = dialog.getByRole("listitem").filter({ hasText: "Saved changes" })
  await row.getByRole("button", { name: "Apply", exact: true }).click()
  await expect(row).toBeVisible()
  await row.getByRole("button", { name: "Drop", exact: true }).click()
  await expect(dialog.getByText("Drop stash@{0}? This cannot be undone.", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  expect(git.state.operations).toHaveLength(2)
  await row.getByRole("button", { name: "Drop", exact: true }).click()
  await dialog
    .getByRole("group", { name: "Drop", exact: true })
    .getByRole("button", { name: "Drop", exact: true })
    .click()
  await expect(dialog.getByText("No stashes", { exact: true })).toBeVisible()
})

test("a conflicted pop retains the stash and displays the Git error", async ({ page }) => {
  const git = await setupReviewGit(page)
  await openGitMenu(page, "Stashes")
  const dialog = page.getByRole("dialog")
  git.state.failure = "Stash conflicts in file.txt"
  await dialog.getByRole("listitem").getByRole("button", { name: "Pop", exact: true }).click()
  await expect(dialog.getByRole("alert")).toHaveText("Stash conflicts in file.txt")
  await expect(dialog.getByRole("listitem")).toContainText("Saved changes")
})

test("stash controls support an RTL locale and mixed-direction messages", async ({ page }) => {
  const git = await setupReviewGit(page, { locale: "ar" })
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
  await openGitMenu(page, git.strings["session.review.git.stashes"], git.strings["session.review.git.remoteMenu"])
  const dialog = page.getByRole("dialog")
  const message = dialog.getByRole("textbox", { name: git.strings["session.review.git.stashMessage"], exact: true })
  await message.fill("تغييرات feature/rtl")
  await expect(message).toHaveValue("تغييرات feature/rtl")
  await expect(dialog.getByRole("listitem").locator("bdi")).toHaveAttribute("dir", "auto")
  await dialog.getByRole("button", { name: git.strings["session.review.git.stashCreate"], exact: true }).click()
  await expect(message).toHaveValue("")
  expect(git.state.operations[0]).toEqual({
    path: "/vcs/stash/create",
    body: { message: "تغييرات feature/rtl", includeUntracked: false },
  })
})
