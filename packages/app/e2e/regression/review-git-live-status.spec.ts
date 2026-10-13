import { expect, test } from "@playwright/test"
import { setupReviewGit } from "../utils/review-git"

test("external VCS events update staging and branch without remounting the review", async ({ page }) => {
  const git = await setupReviewGit(page)
  const checkbox = page.getByRole("checkbox", { name: "Stage file.txt", exact: true })
  await expect(checkbox).not.toBeChecked()
  const review = page.locator('#review-panel [data-component="session-review-v2"]')
  await review.evaluate((element) => element.setAttribute("data-test-instance", "original"))
  git.state.changes = [{ file: "file.txt", staged: true, unstaged: false, untracked: false }]
  git.state.info.branch = "new-branch"
  await git.changed()
  await expect(page.getByRole("checkbox", { name: "Unstage file.txt", exact: true })).toBeChecked()
  await expect(page.locator("#review-panel")).toContainText("new-branch")
  await expect(page.getByRole("button", { name: "file.txt", exact: true })).toBeVisible()
  await expect(review).toHaveAttribute("data-test-instance", "original")
})

test("detached HEAD clears stale branch metadata and disables upstream publication", async ({ page }) => {
  const git = await setupReviewGit(page)
  await expect(page.locator("#review-panel")).toContainText("feature")
  delete git.state.info.branch
  await git.changed()
  await expect(page.locator("#review-panel")).not.toContainText("feature")
  await page.getByRole("button", { name: "Remote actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Push and set upstream", exact: true }).click()
  await expect(page.getByRole("dialog").getByRole("button", { name: "Push", exact: true })).toBeDisabled()
})
