import { type ComponentProps } from "solid-js"

// Minimalist anvil mark: the forge's namesake tool, reduced to three blocks.
export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-waist" d="M10 8H6V12H10V8Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-logo-mark-body" d="M0 2H16V8H10V12H16V20H0V12H6V8H0V2Z" fill="var(--icon-strong-base)" />
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
      <path d="M50 40H30V60H50V40Z" fill="var(--icon-base)" />
      <path d="M0 10H80V40H50V60H80V100H0V60H30V40H0V10Z" fill="var(--icon-strong-base)" />
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
