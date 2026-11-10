import type { LinkPreviewResult } from "@opencode/client/promise"
import type { Page } from "@playwright/test"
import type { Reference } from "../src/components/reference"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./reference-popup.fixture.tsx", import.meta.url))

// The page's own styles load with any story; the fixture then mounts the real popup beside two reference links.
story.beforeEach(async ({ mount }) => {
  await mount("components-reference-card--ci-failing")
})

const ci: NonNullable<LinkPreviewResult["ci"]> = {
  status: "ok",
  unit: "checks",
  passed: 9,
  failed: 2,
  pending: 0,
  skipped: 1,
  cancelled: 0,
  total: 12,
  complete: true,
  failures: [
    { name: "unit (macos)", url: "https://github.com/forge/app/runs/1" },
    { name: "e2e (windows)", url: "https://github.com/forge/app/runs/2" },
  ],
}

// The nth lookup gets the nth answer, the last one repeating, after the nth delay in milliseconds if there is one.
async function mountPopup(page: Page, answers: LinkPreviewResult[], delays: number[] = []) {
  await page.evaluate(
    async ([fixture, answers, delays]) => {
      const { mountReferencePopup } = await import(fixture)

      mountReferencePopup({
        resolve: async (_reference: Reference, count: number) => {
          await new Promise((resolve) => setTimeout(resolve, delays[count - 1] ?? 0))

          return answers[Math.min(count, answers.length) - 1]
        },
      })
    },
    [fixture, answers, delays] as const,
  )
}

const pull = (title: string, extra: Partial<LinkPreviewResult> = {}): LinkPreviewResult => ({
  outcome: "ok",
  title,
  state: "open",
  ci,
  ...extra,
})

story("shows failing CI counts with links to the failing checks", async ({ page }) => {
  await mountPopup(page, [pull("Run shell code blocks")])
  await page.getByRole("link", { name: "pull 81" }).hover()
  const popup = page.getByRole("group", { name: "forge/app #81" })

  await expect(popup.getByText("2 of 12 checks failing")).toBeVisible()
  await expect(popup.getByText("Passed 9")).toBeVisible()
  await expect(popup.getByText("Failed 2")).toBeVisible()
  await expect(popup.getByRole("link", { name: "unit (macos)" })).toHaveAttribute("href", "https://github.com/forge/app/runs/1")
  await expect(popup.getByRole("link", { name: "Run shell code blocks" })).toHaveAttribute(
    "href",
    "https://github.com/forge/app/pull/81",
  )
})

story("never shows unfinished, partial or missing CI as passing", async ({ page }) => {
  await mountPopup(page, [
    pull("Running", { ci: { ...ci, failed: 0, failures: [], pending: 2, passed: 8, skipped: 2 } }),
  ])
  await page.getByRole("link", { name: "pull 81" }).hover()
  const popup = page.getByRole("group", { name: "forge/app #81" })

  await expect(popup.getByText("2 of 12 checks still running")).toBeVisible()
  await expect(popup.getByText(/passing/)).toHaveCount(0)
})

story("says when no CI ran instead of showing a passing result", async ({ page }) => {
  await mountPopup(page, [
    pull("No CI", { ci: { ...ci, status: "none", passed: 0, failed: 0, skipped: 0, total: 0, failures: [] } }),
  ])
  await page.getByRole("link", { name: "pull 81" }).hover()
  const popup = page.getByRole("group", { name: "forge/app #81" })

  await expect(popup.getByText("No CI ran for the latest commit")).toBeVisible()
  await expect(popup.getByText(/passing|failing/)).toHaveCount(0)
})

story("shows sub-issue progress for direct children, with not planned kept apart", async ({ page }) => {
  await mountPopup(page, [
    {
      outcome: "ok",
      title: "Epic",
      state: "open",
      progress: { status: "ok", completed: 2, cancelled: 1, open: 3, total: 6, partial: false },
    },
  ])
  await page.getByRole("link", { name: "issue 79" }).hover()
  const popup = page.getByRole("group", { name: "forge/app #79" })

  await expect(popup.getByText("2 of 6 sub-issues complete · 33%")).toBeVisible()
  await expect(popup.getByText("Direct sub-issues only")).toBeVisible()
  await expect(popup.getByText("Completed 2")).toBeVisible()
  await expect(popup.getByText("Not planned 1")).toBeVisible()
  await expect(popup.getByText("Open 3")).toBeVisible()
})

story("does not turn unavailable hierarchy data into a result", async ({ page }) => {
  await mountPopup(page, [
    {
      outcome: "ok",
      title: "Epic",
      state: "open",
      progress: { status: "unavailable", completed: 0, cancelled: 0, open: 0, total: 0, partial: true },
    },
  ])
  await page.getByRole("link", { name: "issue 79" }).hover()
  const popup = page.getByRole("group", { name: "forge/app #79" })

  await expect(popup.getByText("Sub-issue progress unavailable")).toBeVisible()
  await expect(popup.getByText(/complete/)).toHaveCount(0)
})

story("stays open while the pointer is over the popup, and closes once it leaves both", async ({ page }) => {
  await mountPopup(page, [pull("Run shell code blocks")])
  await page.getByRole("link", { name: "pull 81" }).hover()
  const popup = page.getByRole("group", { name: "forge/app #81" })
  await expect(popup).toBeVisible()
  const box = await popup.boundingBox()

  if (!box) throw new Error("The popup has no box")

  await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 8 })

  // A negative result: the hide delay is 150ms, so wait well past it before asserting the popup is still there.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)))
  await expect(popup).toBeVisible()
  await expect(popup.getByRole("link", { name: "unit (macos)" })).toBeVisible()

  await page.mouse.move(box.x + box.width + 300, box.y + box.height + 300, { steps: 8 })
  await expect(popup).toBeHidden()
})

story("refreshes from the popup, keeps the card when a refresh fails, and says so", async ({ page }) => {
  await mountPopup(page, [pull("First title"), pull("Second title"), { outcome: "unavailable" }])
  await page.getByRole("link", { name: "pull 81" }).hover()
  const popup = page.getByRole("group", { name: "forge/app #81" })
  await expect(popup.getByRole("link", { name: "First title" })).toBeVisible()
  const box = await popup.boundingBox()

  if (!box) throw new Error("The popup has no box")

  await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 8 })
  await popup.getByRole("button", { name: "Refresh" }).click()
  await expect(popup.getByRole("link", { name: "Second title" })).toBeVisible()
  await expect(popup.getByRole("status")).toHaveCount(0)

  await popup.getByRole("button", { name: "Refresh" }).click()
  await expect(popup.getByRole("status")).toHaveText("Could not refresh. Showing the last result.")
  await expect(popup.getByRole("link", { name: "Second title" })).toBeVisible()
})

story("shows a skeleton, not the old numbers, while a refresh loads, and the popup stays open", async ({ page }) => {
  await mountPopup(page, [pull("First title"), pull("Second title")], [0, 1500])
  await page.getByRole("link", { name: "pull 81" }).hover()
  const popup = page.getByRole("group", { name: "forge/app #81" })
  await expect(popup.getByRole("link", { name: "First title" })).toBeVisible()
  const box = await popup.boundingBox()

  if (!box) throw new Error("The popup has no box")

  await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 8 })
  await popup.getByRole("button", { name: "Refresh" }).click()

  await expect(popup.getByRole("status", { name: "Refreshing…" })).toBeVisible()
  await expect(popup.getByRole("link", { name: "First title" })).toHaveCount(0)
  await expect(popup).toBeVisible()
  await expect(popup.getByRole("link", { name: "Second title" })).toBeVisible()
  await expect(popup.getByRole("status", { name: "Refreshing…" })).toHaveCount(0)
})
