import { afterEach, expect, test } from "bun:test"
import { Tabs, useTabsContext, type TabsContextValue } from "@kobalte/core/tabs"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createComponent, render } from "solid-js/web"
import { closeSessionTab, openSessionTab } from "@/context/layout-tabs"
import { createSessionTabs } from "@/pages/session/helpers"
import { ensurePlanActive } from "@/pages/session/plan-tab-activation"
import { createSessionPanelTabChange } from "@/pages/session/session-panel-tabs"

const cleanups: VoidFunction[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

test("keeps the requested Plan selected throughout trigger registration", async () => {
  const panel = mountPanel()
  panel.present()
  // Hold mounting separately from selection to expose Kobalte's registration
  // gap even when the trigger mounts after the old microtask workaround.
  await Promise.resolve()
  expect(panel.changes).not.toContain("review")
  expect(panel.state.tabs.active).toBe("plan")
  panel.registerPlan()
  expect(panel.context().listState().collection().getItem("plan")).toBeDefined()
  expect(panel.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Plan")
})

test("accepts manual Review selection once Plan has registered", async () => {
  const panel = mountPanel()
  panel.registerPlan()
  panel.present()
  expect(panel.context().listState().collection().getItem("plan")).toBeDefined()
  panel.host.querySelector<HTMLButtonElement>('[role="tab"][data-key="review"]')!.click()
  await Promise.resolve()
  expect(panel.state.tabs.active).toBe("review")
  expect(panel.changes).toEqual(["review"])
  expect(panel.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Review")
})

test("respects closing Plan during registration and allows a later presentation", async () => {
  const panel = mountPanel()
  panel.present()
  panel.closePlan()
  await Promise.resolve()
  panel.registerPlan()
  expect(panel.state.tabs.all).not.toContain("plan")
  expect(panel.state.tabs.active).not.toBe("plan")
  expect(panel.context().listState().collection().getItem("plan")).toBeUndefined()

  panel.present()
  expect(panel.state.tabs.active).toBe("plan")
  expect(panel.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Plan")
})

test("opens a closed pane and permits closing a registered Plan", async () => {
  const panel = mountPanel(false)
  panel.registerPlan()
  panel.present()
  expect(panel.state.opened).toBeTrue()
  panel.closePlan()
  await Promise.resolve()
  expect(panel.state.tabs.all).not.toContain("plan")
  expect(panel.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Review")
})

test("does not protect missing non-Plan tabs from the normal fallback", () => {
  const panel = mountPanel()
  panel.select("context")
  expect(panel.state.tabs.active).toBe("review")
  expect(panel.changes).toEqual(["review"])
})

test("does not change another panel after disposing during registration", async () => {
  const first = mountPanel()
  first.present()
  first.dispose()
  const next = mountPanel()
  await Promise.resolve()
  expect(next.state.tabs.active).toBe("review")
  expect(next.state.tabs.all).toEqual([])
  expect(next.changes).toEqual([])
})

function mountPanel(opened = true) {
  const [state, setState] = createStore({
    tabs: { all: [] as string[], active: "review" as string | undefined },
    opened,
    mountPlan: false,
  })
  const changes: string[] = []
  const registration: { current?: TabsContextValue } = {}
  const host = document.createElement("div")
  document.body.append(host)
  const tabs = {
    all: () => state.tabs.all,
    active: () => state.tabs.active,
    open: (tab: string) => setState("tabs", openSessionTab({ tabs: state.tabs }, tab).tabs),
    setActive: (active: string | undefined) => setState("tabs", "active", active),
  }
  const dispose = render(() => {
    const tabState = createSessionTabs({
      tabs: () => tabs,
      pathFromTab: () => undefined,
      normalizeTab: (tab) => tab,
      review: () => true,
      hasReview: () => true,
    })
    const Register = () => {
      registration.current = useTabsContext()
      return createComponent(Tabs.List, {
        get children() {
          return [
            createComponent(Tabs.Trigger, { value: "review", children: "Review" }),
            createComponent(Show, {
              get when() {
                return state.mountPlan && tabState.planOpen()
              },
              get children() {
                return createComponent(Tabs.Trigger, { value: "plan", children: "Plan" })
              },
            }),
          ]
        },
      })
    }
    return createComponent(Tabs, {
      get value() {
        return tabState.activeTab()
      },
      onChange: createSessionPanelTabChange({
        active: tabs.active,
        planOpen: () => tabs.all().includes("plan"),
        context: () => registration.current,
        onChange: (value) => {
          changes.push(value)
          tabs.setActive(value)
        },
      }),
      get children() {
        return createComponent(Register, {})
      },
    })
  }, host)
  cleanups.push(() => {
    dispose()
    host.remove()
  })
  expect(registration.current?.listState().collection().getItem("review")).toBeDefined()
  expect(changes).toEqual([])
  return {
    state,
    changes,
    host,
    context: () => registration.current!,
    dispose,
    select: tabs.setActive,
    present: () =>
      ensurePlanActive({ reviewPanel: { opened: () => state.opened, open: () => setState("opened", true) } }, tabs),
    registerPlan: () => setState("mountPlan", true),
    closePlan: () => setState("tabs", closeSessionTab({ tabs: state.tabs }, "plan").tabs),
  }
}
