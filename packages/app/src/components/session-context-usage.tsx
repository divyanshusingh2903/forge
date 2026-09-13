import { createSignal, For, Match, Show, Switch, createMemo, type ComponentProps, type JSX } from "solid-js"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { ProgressCircleV2 } from "@opencode-ai/ui/v2/progress-circle-v2"
import { Button } from "@opencode-ai/ui/button"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Popover } from "@opencode-ai/ui/popover"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createMediaQuery } from "@solid-primitives/media"
import { findLast } from "@opencode-ai/core/util/array"
import type { Part } from "@opencode-ai/sdk/v2/client"

import { useFile } from "@/context/file"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useSDK } from "@/context/sdk"
import { getSessionContext } from "@/components/session/session-context-metrics"
import {
  estimateSessionContextBreakdown,
  type SessionContextBreakdownKey,
} from "@/components/session/session-context-breakdown"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"
import { useSettings } from "@/context/settings"

const BREAKDOWN_COLOR: Record<SessionContextBreakdownKey, string> = {
  system: "var(--syntax-info)",
  user: "var(--syntax-success)",
  assistant: "var(--syntax-property)",
  tool: "var(--syntax-warning)",
  other: "var(--syntax-comment)",
}

interface SessionContextUsageProps {
  variant?: "button" | "indicator"
  buttonAppearance?: "default" | "v2"
  placement?: ComponentProps<typeof TooltipV2>["placement"]
}

function ContextTooltipRow(props: { name: JSX.Element; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-v2-text-text-muted">{props.name}</span>
      <span class="ml-auto min-w-0 truncate text-right text-v2-text-text-base">{props.value}</span>
    </div>
  )
}

function openSessionContext(args: {
  view: ReturnType<ReturnType<typeof useLayout>["view"]>
  layout: ReturnType<typeof useLayout>
  tabs: ReturnType<ReturnType<typeof useLayout>["tabs"]>
}) {
  args.view.reviewPanel.open(args.view.reviewPanel.opened() ? "other" : "context-button")
  if (args.layout.fileTree.opened() && args.layout.fileTree.tab() !== "all") args.layout.fileTree.setTab("all")
  void args.tabs.open("context")
  args.tabs.setActive("context")
}

export function SessionContextUsage(props: SessionContextUsageProps) {
  const sync = useSync()
  const file = useFile()
  const layout = useLayout()
  const language = useLanguage()
  const sdk = useSDK()
  const settings = useSettings()
  const providers = useProviders(() => sdk().directory)
  const { params, tabs, view } = useSessionLayout()
  const isDesktop = createMediaQuery("(min-width: 768px)")

  const variant = createMemo(() => props.variant ?? "button")
  const buttonAppearance = createMemo(() => props.buttonAppearance ?? "default")
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
    fileBrowser: () => settings.general.newLayoutDesigns() && isDesktop() && !!params.id,
  })
  const messages = createMemo(() => (params.id ? (sync().data.message[params.id] ?? []) : []))
  const info = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const context = createMemo(() => getSessionContext(messages(), [...providers.all().values()]))
  const cost = createMemo(() => {
    return usd().format(info()?.cost ?? 0)
  })
  const contextVisible = createMemo(() => view().reviewPanel.opened() && tabState.activeTab() === "context")
  const hasOtherTabs = createMemo(() =>
    tabs()
      .all()
      .some((tab) => tab !== "context" && tab !== "review"),
  )

  const openContext = () => {
    if (!params.id) return

    const sessionView = view()
    if (contextVisible()) {
      tabs().close("context")
      if (sessionView.reviewPanel.source() === "context-button" && !hasOtherTabs()) sessionView.reviewPanel.close()
      return
    }

    openSessionContext({
      view: sessionView,
      layout,
      tabs: tabs(),
    })
  }

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle
        size={16}
        strokeWidth={2}
        percentage={context()?.usage ?? 0}
        style={
          variant() === "indicator"
            ? {
                "--progress-circle-background": "var(--v2-background-bg-layer-04, var(--border-weak-base))",
                "--progress-circle-background-overlay": "var(--v2-overlay-simple-overlay-pressed, transparent)",
                "--progress-circle-progress": "var(--v2-icon-icon-base, var(--icon-base))",
              }
            : undefined
        }
      />
    </div>
  )
  const circleV2 = () => (
    <div class="flex items-center justify-center">
      <ProgressCircleV2 percentage={context()?.usage ?? 0} />
    </div>
  )

  const tooltipValue = () => (
    <div class="flex w-[160px] flex-col gap-2">
      <ContextTooltipRow
        name={language.t("context.usage.tokens")}
        value={`${context()?.total.toLocaleString(language.intl()) ?? "0"} / ${context()?.limit?.toLocaleString(language.intl()) ?? "0"}`}
      />
      <ContextTooltipRow name={language.t("context.usage.usage")} value={`${context()?.usage ?? 0}%`} />
      <ContextTooltipRow name={language.t("context.usage.cost")} value={cost()} />
    </div>
  )

  // Simplified relative to session-context-tab.tsx's systemPrompt(): that one
  // stops at the most recent revert boundary, which matters for the full
  // detailed view but is unnecessary precision for a quick hover-triggered
  // preview -- this just wants the latest system prompt in the transcript.
  const systemPrompt = createMemo(() => {
    const msg = findLast(messages(), (m) => m.role === "user" && !!m.system)
    const system = msg && "system" in msg ? msg.system : undefined
    return system?.trim() || undefined
  })

  const breakdown = createMemo(() => {
    const input = context()?.input
    if (!input) return []
    return estimateSessionContextBreakdown({
      messages: messages(),
      parts: sync().data.part as Record<string, Part[] | undefined>,
      input,
      systemPrompt: systemPrompt(),
    })
  })

  const breakdownLabel = (key: SessionContextBreakdownKey) => language.t(`context.breakdown.${key}`)

  const [popoverOpen, setPopoverOpen] = createSignal(false)

  const popoverBody = () => (
    <div class="flex w-[260px] flex-col gap-3 rounded-xl bg-v2-background-bg-layer-01 p-3 shadow-[var(--v2-elevation-floating)]">
      <div class="flex items-center justify-between">
        <span class="text-13-medium text-v2-text-text-base">{language.t("context.breakdown.title")}</span>
        <span class="text-13-regular text-v2-text-text-muted">
          {context()?.total.toLocaleString(language.intl()) ?? "0"} / {context()?.limit?.toLocaleString(language.intl()) ?? "0"}
          {` (${context()?.usage ?? 0}%)`}
        </span>
      </div>
      <Show when={breakdown().length > 0}>
        <div class="flex flex-col gap-2">
          <div class="h-2 w-full overflow-hidden rounded-full bg-v2-background-bg-layer-03 flex">
            <For each={breakdown()}>
              {(segment) => (
                <div
                  class="h-full"
                  style={{ width: `${segment.width}%`, "background-color": BREAKDOWN_COLOR[segment.key] }}
                />
              )}
            </For>
          </div>
          <div class="flex flex-wrap gap-x-3 gap-y-1">
            <For each={breakdown()}>
              {(segment) => (
                <div class="flex items-center gap-1 text-12-regular text-v2-text-text-muted">
                  <div class="size-2 rounded-sm" style={{ "background-color": BREAKDOWN_COLOR[segment.key] }} />
                  <span>{breakdownLabel(segment.key)}</span>
                  <span class="text-v2-text-text-faint">{segment.percent.toLocaleString(language.intl())}%</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
      <ButtonV2
        variant="ghost"
        class="w-full justify-center"
        onClick={() => {
          setPopoverOpen(false)
          openContext()
        }}
      >
        {language.t("context.usage.openDetails")}
      </ButtonV2>
    </div>
  )

  return (
    <Show when={params.id}>
      <Switch>
        <Match when={variant() === "indicator"}>
          <TooltipV2 value={tooltipValue()} placement={props.placement ?? "top"} shift={-8}>
            {circle()}
          </TooltipV2>
        </Match>
        <Match when={buttonAppearance() === "v2"}>
          <TooltipV2 value={tooltipValue()} placement={props.placement ?? "top"} shift={-8}>
            <Popover
              open={popoverOpen()}
              onOpenChange={setPopoverOpen}
              placement="bottom-end"
              gutter={4}
              class="border-0 bg-transparent p-0 shadow-none [&_[data-slot=popover-body]]:p-0"
              triggerAs={IconButtonV2}
              triggerProps={{
                type: "button",
                variant: "ghost-muted",
                size: "large",
                icon: circleV2(),
                "aria-label": language.t("context.usage.view"),
              }}
            >
              {popoverBody()}
            </Popover>
          </TooltipV2>
        </Match>
        <Match when={true}>
          <TooltipV2 value={tooltipValue()} placement={props.placement ?? "top"} shift={-8}>
            <Popover
              open={popoverOpen()}
              onOpenChange={setPopoverOpen}
              placement="bottom-end"
              gutter={4}
              class="border-0 bg-transparent p-0 shadow-none [&_[data-slot=popover-body]]:p-0"
              triggerAs={Button}
              triggerProps={{
                type: "button",
                variant: "ghost",
                class: "size-6",
                "aria-label": language.t("context.usage.view"),
              }}
              trigger={circle()}
            >
              {popoverBody()}
            </Popover>
          </TooltipV2>
        </Match>
      </Switch>
    </Show>
  )
}
