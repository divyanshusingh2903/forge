import { batch } from "solid-js"

type PlanTabView = {
  reviewPanel: {
    opened: () => boolean
    open: () => void
  }
}

type PlanTabTabs = {
  open: (tab: string) => unknown
  setActive: (tab: string | undefined) => void
}

// Single shared helper for opening + activating the Plan tab. Every caller
// (first-create effect, header indicator, question dock, reactive pending
// watcher) must go through here so `open("plan")` without `setActive("plan")`
// can never drift back in and leave the review pane stuck on Files Changed.
export function ensurePlanActive(view: PlanTabView, tabs: PlanTabTabs) {
  batch(() => {
    if (!view.reviewPanel.opened()) view.reviewPanel.open()
    void tabs.open("plan")
    tabs.setActive("plan")
  })
  // `open()` applies synchronously today but persisted handoff restore and
  // other effects can `setActive` in the same tick; re-assert after so the
  // Plan tab wins for a newly pending plan.
  queueMicrotask(() => tabs.setActive("plan"))
}
