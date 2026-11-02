import { ForgeMode } from "@opencode/schema/forge-mode"
import type { ComposerControls } from "./adapter"

const buildAgent = "build"

const planAgent = "plan"

/**
 * Forge folds the agent picker into one mode list: Manual, Accept edits and Auto run the build agent under that
 * permission mode, Plan runs the plan agent, and any custom agents follow by name. The composer's picker and the
 * agent cycle command both walk this list.
 */
export function createModeControl(controls: () => ComposerControls, label: (mode: ForgeMode.Mode | "plan") => string) {
  const options = () => {
    const agents = controls().agents

    return [
      ...ForgeMode.Mode.literals.map((mode) => ({ id: mode, label: label(mode) })),
      ...(agents.options.includes(planAgent) ? [{ id: planAgent, label: label("plan") }] : []),
      ...agents.options
        .filter((name) => name !== buildAgent && name !== planAgent)
        .map((name) => ({ id: name, label: name })),
    ]
  }

  const current = () => {
    const agent = controls().agents.current

    return agent === "" || agent === buildAgent ? controls().mode.current : agent
  }

  const select = (value: string) => {
    const mode = ForgeMode.Mode.literals.find((item) => item === value)

    if (!mode) return controls().agents.select(value)
    controls().mode.select(mode)

    if (controls().agents.current !== buildAgent) controls().agents.select(buildAgent)
  }

  const move = (step: 1 | -1) => {
    const list = options()
    const index = list.findIndex((option) => option.id === current())
    const next = list[(index + step + list.length) % list.length]

    if (next) select(next.id)
  }

  return { options, current, select, move }
}
