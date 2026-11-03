import type { Page } from "@playwright/test"

/** The titlebar's New session button. Forge's Projects rail repeats it for each project, so those are left out. */
export function newSessionButton(page: Page) {
  return page
    .getByRole("button", { name: "New session", exact: true })
    .and(page.locator(':not([data-action="home-project-new-session"])'))
}
