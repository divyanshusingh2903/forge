import { createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { Mark } from "./logo"

// Forge mark with a shimmer sweep + soft pulse. The animation lives on the
// wrapper so the logo's own rect fills are never touched.
export function ForgeMarkLoader(props: { class?: string }) {
  return (
    <div data-component="forge-loading" class="inline-flex items-center justify-center" aria-hidden="true">
      <span data-slot="forge-loading-mark">
        <Mark class={props.class ?? "h-10 w-8"} />
      </span>
    </div>
  )
}

// Shared startup loading state: shimmering forge mark over placeholder rows.
// Interactive content must be replaced by (not overlaid with) this while
// loading, so there is nothing clickable until data arrives. Pass `mark={false}`
// for small/nested spots (e.g. an expanded project's session list) where a
// full-size logo per instance would be too heavy -- just the pulsing rows.
export function SessionLoadingState(props: {
  label: string
  rows?: number
  rowClass?: string
  class?: string
  mark?: boolean
  markClass?: string
  gap?: string
  children?: JSX.Element
}) {
  const rows = () => Array.from({ length: props.rows ?? 4 }, (_, index) => index)
  return (
    <div
      data-component="session-loading"
      role="status"
      aria-live="polite"
      aria-label={props.label}
      class={`flex min-w-0 flex-col items-center ${props.gap ?? "gap-6 px-4 py-10"} ${props.class ?? ""}`}
    >
      <Show when={props.mark ?? true}>
        <ForgeMarkLoader class={props.markClass ?? "h-10 w-8"} />
      </Show>
      <div aria-hidden="true" class="flex w-full min-w-0 flex-col gap-px">
        <For each={rows()}>
          {() => (
            <div
              data-component="loading-block"
              class={props.rowClass ?? "h-10 rounded-[6px] bg-v2-background-bg-deep opacity-70 animate-pulse"}
            />
          )}
        </For>
      </div>
      {props.children}
    </div>
  )
}

// Click-blocking veil for content that stays mounted while its data loads
// (e.g. the new-session composer). Render inside a relative parent under
// `<Show when={loading()}>`; the overlay itself captures all pointer input.
export function LoadingVeil(props: { label: string; class?: string }) {
  return (
    <div
      data-component="loading-veil"
      role="status"
      aria-live="polite"
      aria-label={props.label}
      class={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 bg-v2-background-bg-base/60 backdrop-blur-[1px] ${props.class ?? ""}`}
    >
      <ForgeMarkLoader class="h-10 w-8" />
    </div>
  )
}

// Suspense fallback that stays invisible for a short grace period before
// showing the skeleton, so a load that resolves quickly never flashes it.
export function DelayedLoadingState(props: { label: string; delay?: number; rows?: number; class?: string }) {
  const [show, setShow] = createSignal(false)
  const timer = setTimeout(() => setShow(true), props.delay ?? 150)
  onCleanup(() => clearTimeout(timer))
  return (
    <Show when={show()}>
      <SessionLoadingState label={props.label} rows={props.rows} class={props.class} />
    </Show>
  )
}
