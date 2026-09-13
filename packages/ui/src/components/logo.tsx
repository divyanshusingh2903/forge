import { type ComponentProps } from "solid-js"

// Abstract mark: three flat bars, single tone, gaps only between rows.
export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect data-slot="logo-logo-mark-bar-top" x="0" y="0" width="16" height="4" fill="var(--icon-base)" />
      <rect data-slot="logo-logo-mark-bar-mid" x="4" y="6" width="8" height="4" fill="var(--icon-base)" />
      <rect data-slot="logo-logo-mark-bar-bottom" x="0" y="12" width="16" height="4" fill="var(--icon-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="0" y="10" width="80" height="20" fill="var(--icon-strong-base)" />
      <rect x="20" y="40" width="40" height="20" fill="var(--icon-strong-base)" />
      <rect x="0" y="70" width="80" height="20" fill="var(--icon-strong-base)" />
    </svg>
  )
}

// Pixel-block wordmark reading "FORGE", matching the mark's grid geometry.
export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 144 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g fill="var(--icon-base)">
        <rect x="0" y="3" width="6" height="6" />
        <rect x="6" y="3" width="6" height="6" />
        <rect x="12" y="3" width="6" height="6" />
        <rect x="18" y="3" width="6" height="6" />
        <rect x="0" y="9" width="6" height="6" />
        <rect x="0" y="15" width="6" height="6" />
        <rect x="6" y="15" width="6" height="6" />
        <rect x="12" y="15" width="6" height="6" />
        <rect x="0" y="21" width="6" height="6" />
        <rect x="0" y="27" width="6" height="6" />
        <rect x="0" y="33" width="6" height="6" />
        <rect x="30" y="3" width="6" height="6" />
        <rect x="36" y="3" width="6" height="6" />
        <rect x="42" y="3" width="6" height="6" />
        <rect x="48" y="3" width="6" height="6" />
        <rect x="30" y="9" width="6" height="6" />
        <rect x="48" y="9" width="6" height="6" />
        <rect x="30" y="15" width="6" height="6" />
        <rect x="48" y="15" width="6" height="6" />
        <rect x="30" y="21" width="6" height="6" />
        <rect x="48" y="21" width="6" height="6" />
        <rect x="30" y="27" width="6" height="6" />
        <rect x="48" y="27" width="6" height="6" />
        <rect x="30" y="33" width="6" height="6" />
        <rect x="36" y="33" width="6" height="6" />
        <rect x="42" y="33" width="6" height="6" />
        <rect x="48" y="33" width="6" height="6" />
        <rect x="60" y="3" width="6" height="6" />
        <rect x="66" y="3" width="6" height="6" />
        <rect x="72" y="3" width="6" height="6" />
        <rect x="60" y="9" width="6" height="6" />
        <rect x="78" y="9" width="6" height="6" />
        <rect x="60" y="15" width="6" height="6" />
        <rect x="66" y="15" width="6" height="6" />
        <rect x="72" y="15" width="6" height="6" />
        <rect x="60" y="21" width="6" height="6" />
        <rect x="72" y="21" width="6" height="6" />
        <rect x="60" y="27" width="6" height="6" />
        <rect x="78" y="27" width="6" height="6" />
        <rect x="60" y="33" width="6" height="6" />
        <rect x="78" y="33" width="6" height="6" />
        <rect x="90" y="3" width="6" height="6" />
        <rect x="96" y="3" width="6" height="6" />
        <rect x="102" y="3" width="6" height="6" />
        <rect x="108" y="3" width="6" height="6" />
        <rect x="90" y="9" width="6" height="6" />
        <rect x="90" y="15" width="6" height="6" />
        <rect x="102" y="15" width="6" height="6" />
        <rect x="108" y="15" width="6" height="6" />
        <rect x="90" y="21" width="6" height="6" />
        <rect x="108" y="21" width="6" height="6" />
        <rect x="90" y="27" width="6" height="6" />
        <rect x="108" y="27" width="6" height="6" />
        <rect x="90" y="33" width="6" height="6" />
        <rect x="96" y="33" width="6" height="6" />
        <rect x="102" y="33" width="6" height="6" />
        <rect x="108" y="33" width="6" height="6" />
        <rect x="120" y="3" width="6" height="6" />
        <rect x="126" y="3" width="6" height="6" />
        <rect x="132" y="3" width="6" height="6" />
        <rect x="138" y="3" width="6" height="6" />
        <rect x="120" y="9" width="6" height="6" />
        <rect x="120" y="15" width="6" height="6" />
        <rect x="126" y="15" width="6" height="6" />
        <rect x="132" y="15" width="6" height="6" />
        <rect x="120" y="21" width="6" height="6" />
        <rect x="120" y="27" width="6" height="6" />
        <rect x="120" y="33" width="6" height="6" />
        <rect x="126" y="33" width="6" height="6" />
        <rect x="132" y="33" width="6" height="6" />
        <rect x="138" y="33" width="6" height="6" />
      </g>
    </svg>
  )
}
