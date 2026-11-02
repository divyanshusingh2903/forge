import type { UiI18n } from "@opencode-ai/ui/context/i18n"

const ACTIONS = ["click", "hover", "type", "fill", "select", "press", "scroll"] as const
const DIRECTIONS = ["up", "down", "left", "right"] as const

type Action = (typeof ACTIONS)[number]

const isAction = (value: unknown): value is Action => ACTIONS.some((action) => action === value)
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined)

// Describes a browser_act call, e.g. verb "Fill", target `textbox "Customer name:"`, input `"Test User"`.
// Reads the tool metadata first (it carries the element's role and name) and falls back to the call's input.
export function browserActLabel(
  i18n: Pick<UiI18n, "t">,
  metadata: Record<string, unknown> | undefined,
  input: Record<string, unknown> | undefined,
) {
  const action = metadata?.action ?? input?.action
  const ref = text(metadata?.ref) ?? text(input?.ref)
  const role = text(metadata?.role)
  const name = typeof metadata?.name === "string" ? metadata.name : undefined
  const detail = text(metadata?.input)

  return {
    verb: isAction(action) ? i18n.t(`ui.tool.browser.act.${action}`) : i18n.t("ui.tool.browser.act"),
    target: role ? `${role} "${name ?? ""}"` : ref,
    input: inputLabel(i18n, isAction(action) ? action : undefined, detail),
  }
}

function inputLabel(i18n: Pick<UiI18n, "t">, action: Action | undefined, detail: string | undefined) {
  if (!detail) return
  if (action === "press") return detail
  if (action === "scroll") {
    const direction = DIRECTIONS.find((item) => item === detail)
    return direction ? i18n.t(`ui.tool.browser.act.direction.${direction}`) : detail
  }
  return `"${detail}"`
}
