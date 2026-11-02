import { Logo } from "@opencode/ui/logo"
import "./wordmark.css"

/** The FORGE wordmark above the composer, with a single shimmer sweep when the page opens. */
export function NewSessionWordmark() {
  return (
    <div
      data-component="new-session-wordmark"
      aria-hidden="true"
      class="pointer-events-none mx-auto w-full max-w-[720px] text-v2-background-bg-inverse"
    >
      <div class="relative mx-auto aspect-[144/42] w-3/5">
        <div class="absolute inset-0 opacity-[0.16]">
          <Logo class="size-full" />
        </div>
        <Logo class="wordmark-shimmer absolute inset-0 size-full" />
      </div>
    </div>
  )
}
