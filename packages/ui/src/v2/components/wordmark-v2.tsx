import { createUniqueId, type ComponentProps } from "solid-js"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.6">
        <g mask={`url(#${mask})`}>
          <g opacity="0.16">
            <rect opacity="0.7" x="36" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="63" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="90" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="117" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="36" y="24" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="36" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="63" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="90" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="36" y="64" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="36" y="84" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="36" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="171" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="198" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="225" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="252" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="171" y="24" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="252" y="24" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="171" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="252" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="171" y="64" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="252" y="64" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="171" y="84" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="252" y="84" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="171" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="198" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="225" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="252" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="306" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="333" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="360" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="306" y="24" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="387" y="24" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="306" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="333" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="360" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="306" y="64" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="360" y="64" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="306" y="84" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="387" y="84" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="306" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="387" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="441" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="468" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="495" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="522" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="441" y="24" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="441" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="495" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="522" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="441" y="64" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="522" y="64" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="441" y="84" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="522" y="84" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="441" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="468" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="495" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="522" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="576" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="603" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="630" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="657" y="4" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="576" y="24" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="576" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="603" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="630" y="44" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="576" y="64" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="576" y="84" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="576" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="603" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="630" y="104" width="27" height="20" fill="currentColor" />
            <rect opacity="0.7" x="657" y="104" width="27" height="20" fill="currentColor" />
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="129">
          <rect width="720" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="360" y1="68" x2="360" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
