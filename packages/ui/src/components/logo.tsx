import { For, type ComponentProps } from "solid-js"
import { FORGE_HEIGHT, FORGE_LETTERS, FORGE_PITCH, FORGE_WIDTH } from "./forge-letters"

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

// Wordmark reading "FORGE", drawn in the OpenCode pixel face.
export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${FORGE_WIDTH} ${FORGE_HEIGHT}`}
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <For each={FORGE_LETTERS}>
        {(letter, index) => (
          <g transform={`translate(${index() * FORGE_PITCH} 0)`}>
            {letter.shadow && <path d={letter.shadow} fill="var(--icon-weak-base)" />}
            <path d={letter.shape} fill={index() < 3 ? "var(--icon-base)" : "var(--icon-strong-base)"} />
          </g>
        )}
      </For>
    </svg>
  )
}
