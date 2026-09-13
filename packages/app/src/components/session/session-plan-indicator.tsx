import { Show } from "solid-js"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"
import { usePlanInfo } from "@/pages/session/use-plan-info"

export function SessionPlanIndicator() {
  const language = useLanguage()
  const { params, view, tabs } = useSessionLayout()
  const plan = usePlanInfo(() => params.id)

  const open = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    tabs().setActive("plan")
  }

  const tooltip = () => (plan.pending() ? language.t("session.plan.openTooltip") : language.t("session.plan.viewTooltip"))

  return (
    <Show when={plan.exists() || plan.pending()}>
      <TooltipV2 value={tooltip()} placement="bottom">
        <IconButtonV2
          type="button"
          variant="ghost-muted"
          size="large"
          class="!w-9 shrink-0"
          state={plan.pending() ? "pressed" : undefined}
          aria-label={language.t("session.tab.plan")}
          onClick={open}
          icon={<IconV2 name="plan" />}
        />
      </TooltipV2>
    </Show>
  )
}
