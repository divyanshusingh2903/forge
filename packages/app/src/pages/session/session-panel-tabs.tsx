import { useTabsContext, type TabsContextValue } from "@kobalte/core/tabs"
import { Tabs } from "@opencode-ai/ui/tabs"
import type { Accessor, ParentProps } from "solid-js"

export function SessionPanelTabs(
  props: ParentProps<{ value: string; planOpen: boolean; onChange: (value: string) => void }>,
) {
  const registration: { current?: TabsContextValue } = {}
  return (
    <Tabs
      value={props.value}
      onChange={createSessionPanelTabChange({
        active: () => props.value,
        planOpen: () => props.planOpen,
        context: () => registration.current,
        onChange: (value) => props.onChange(value),
      })}
    >
      <SessionPanelTabRegistration register={(context) => (registration.current = context)}>
        {props.children}
      </SessionPanelTabRegistration>
    </Tabs>
  )
}

export function createSessionPanelTabChange(input: {
  active: Accessor<string | undefined>
  planOpen: Accessor<boolean>
  context: Accessor<TabsContextValue | undefined>
  onChange: (value: string) => void
}) {
  return (value: string) => {
    // Kobalte falls back to Review if Plan is selected before its conditional
    // trigger registers. Preserve the requested selection only during that gap.
    if (input.active() === "plan" && input.planOpen() && !input.context()?.listState().collection().getItem("plan")) {
      return
    }
    input.onChange(value)
  }
}

function SessionPanelTabRegistration(props: ParentProps<{ register: (context: TabsContextValue) => void }>) {
  props.register(useTabsContext())
  return props.children
}
