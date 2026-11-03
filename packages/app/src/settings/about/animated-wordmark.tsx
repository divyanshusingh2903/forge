import { createEffect, For, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { prefersReducedMotion } from "@opencode/ui/motion"
import { FORGE_HEIGHT, FORGE_LETTERS, FORGE_PITCH, FORGE_WIDTH } from "@opencode/ui/forge-letters"

const target = FORGE_LETTERS.map((letter) => letter.id)

export function AnimatedWordmark(props: { active: boolean }) {
  // SAFETY: the letter IDs are literal strings; this only widens them so the letters can be shuffled.
  const [state, setState] = createStore({ letters: [...target] as string[] })
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const random = () => target[Math.floor(Math.random() * target.length)]

  createEffect(
    on(
      () => props.active,
      (active) => {
        timers.forEach(clearTimeout)
        timers.clear()

        if (!active || prefersReducedMotion()) {
          setState("letters", [...target])

          return
        }

        const settles = target.map(() => 6 + Math.floor(Math.random() * 8))
        const last = Math.max(...settles)
        setState(
          "letters",
          target.map(() => random()),
        )

        Array.from({ length: last }, (_, index) => index + 1).forEach((tick) => {
          const timer = setTimeout(() => {
            setState(
              "letters",
              target.map((letter, index) => (tick >= settles[index] ? letter : random())),
            )
            timers.delete(timer)
          }, tick * 75)

          timers.add(timer)
        })
      },
    ),
  )

  onCleanup(() => timers.forEach(clearTimeout))

  return (
    <svg class="settings-about-wordmark" viewBox={`0 0 ${FORGE_WIDTH} ${FORGE_HEIGHT}`} aria-hidden="true">
      <defs>
        <For each={FORGE_LETTERS}>
          {(letter) => (
            <symbol id={`settings-about-letter-${letter.id}`} viewBox={`0 0 24 ${FORGE_HEIGHT}`}>
              {letter.shadow && <path class="settings-about-letter-shadow" d={letter.shadow} />}
              <path d={letter.outline} />
            </symbol>
          )}
        </For>
      </defs>
      <For each={state.letters}>
        {(letter, index) => (
          <use href={`#settings-about-letter-${letter}`} x={index() * FORGE_PITCH} width="24" height={FORGE_HEIGHT} />
        )}
      </For>
    </svg>
  )
}
