import { For } from "solid-js"

export type Slice = { key: string; value: number }

// The ring plus half its stroke must stay inside the viewBox, or the outer edge is clipped.
const RADIUS = 14.5

const SIZE = 36

// A donut of proportions. It is decorative: the counts are always written out beside it, in a legend whose entries
// each have their own glyph, so it is hidden from assistive technology and colour is never the only signal.
// `pathLength` makes a slice's dash length its percentage whatever the radius.
export function Donut(props: { slices: Slice[] }) {
  const total = () => props.slices.reduce((sum, slice) => sum + slice.value, 0)

  const arcs = () => {
    const sum = total()
    const visible = props.slices.filter((slice) => slice.value > 0)

    return visible.map((slice, index) => ({
      key: slice.key,
      length: (slice.value / sum) * 100,
      offset: (visible.slice(0, index).reduce((used, item) => used + item.value, 0) / sum) * 100,
    }))
  }

  return (
    <svg data-component="reference-donut" viewBox={`0 0 ${SIZE} ${SIZE}`} width="36" height="36" aria-hidden="true">
      <circle data-slot="reference-donut-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" />
      <For each={arcs()}>
        {(arc) => (
          <circle
            data-slice={arc.key}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            pathLength="100"
            stroke-dasharray={`${arc.length} ${100 - arc.length}`}
            stroke-dashoffset={-arc.offset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        )}
      </For>
    </svg>
  )
}
