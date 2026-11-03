import type { ParentProps } from "solid-js"
import { Splash } from "@opencode/ui/logo"
import { useLanguage } from "@/runtime/i18n/language"

export function SessionRouteFrame(props: ParentProps<{ padded?: boolean }>) {
  return (
    <div
      class="relative flex size-full flex-col"
      classList={{
        "px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]":
          props.padded,
      }}
    >
      {props.children}
    </div>
  )
}

export function SessionPanelFrame(props: ParentProps<{ raised?: boolean }>) {
  return (
    <div
      class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-v2-background-bg-base"
      classList={{
        "shadow-[var(--v2-elevation-raised)]": props.raised,
      }}
    >
      {props.children}
    </div>
  )
}

/**
 * The startup splash's mark, pulsing in the middle of a session panel that has nothing to show yet. The session screen
 * shows the same mark while its history loads, so it stays in place from the first frame until the chat appears.
 */
export function SessionLoadingMark() {
  const language = useLanguage()

  return (
    <div
      role="status"
      aria-label={language.t("common.loading")}
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <Splash class="w-16 h-20 opacity-50 animate-pulse" />
    </div>
  )
}
