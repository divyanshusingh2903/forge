import { createMediaQuery } from "@solid-primitives/media"
import { useSettings } from "@/settings/model"

/** The Projects sidebar belongs to the horizontal-tabs layout; vertical tabs have their own sidebar, and phones none. */
export function useProjectRail() {
  const settings = useSettings()
  const mobile = createMediaQuery("(max-width: 767px)")
  const available = () => settings.appearance.tabLayout() === "horizontal" && !mobile()

  return {
    available,
    visible: () => available() && settings.appearance.sidebarOpen(),
    toggle: () => settings.appearance.setSidebarOpen(!settings.appearance.sidebarOpen()),
  }
}
