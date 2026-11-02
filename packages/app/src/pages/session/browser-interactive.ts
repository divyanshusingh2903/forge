const MAX_INTERACTIVE_ELEMENTS = 300
const MAX_LABEL_CHARS = 80

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
])

type AXValue = { value?: unknown }
type AXNode = {
  ignored?: boolean
  role?: AXValue
  name?: AXValue
  value?: AXValue
  backendDOMNodeId?: number
  properties?: Array<{ name?: string; value?: AXValue }>
}

// Turns a CDP Accessibility.getFullAXTree result into one line per actionable element. `refs` maps each
// printed ref (e1, e2, …) to the element's backend DOM node id so later actions can resolve it.
export function formatInteractiveElements(tree: unknown) {
  if (!tree || typeof tree !== "object" || !("nodes" in tree) || !Array.isArray(tree.nodes)) {
    throw new Error("Invalid accessibility tree")
  }
  const elements = tree.nodes.filter(isInteractive)
  const shown = elements.slice(0, MAX_INTERACTIVE_ELEMENTS)
  const refs = new Map(shown.map((node, index) => [`e${index + 1}`, node.backendDOMNodeId] as const))
  if (shown.length === 0) return { text: "No interactive elements found on this page.", refs }

  const lines = shown.map((node, index) => {
    const name = label(node.name?.value)
    const value = label(node.value?.value)
    return [
      `[e${index + 1}] ${node.role?.value} "${quote(name)}"`,
      ...(value && value !== name ? [`value="${quote(value)}"`] : []),
      ...flags(node),
    ].join(" ")
  })
  const hidden = elements.length - shown.length
  return {
    text: [...lines, ...(hidden > 0 ? [`… ${hidden} more interactive elements not shown`] : [])].join("\n"),
    refs,
  }
}

function isInteractive(node: unknown): node is AXNode & { backendDOMNodeId: number } {
  if (!node || typeof node !== "object") return false
  const candidate = node as AXNode
  return (
    !candidate.ignored &&
    typeof candidate.role?.value === "string" &&
    INTERACTIVE_ROLES.has(candidate.role.value) &&
    typeof candidate.backendDOMNodeId === "number"
  )
}

function label(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return ""
  const text = String(value).replace(/\s+/g, " ").trim()
  return text.length > MAX_LABEL_CHARS ? `${text.slice(0, MAX_LABEL_CHARS)}…` : text
}

function quote(text: string) {
  return text.replaceAll('"', '\\"')
}

function flags(node: AXNode) {
  const properties = new Map((node.properties ?? []).map((item) => [item.name, item.value?.value] as const))
  const checked = properties.get("checked")
  const expanded = properties.get("expanded")
  return [
    ...(properties.get("disabled") === true ? ["disabled"] : []),
    ...(properties.get("required") === true ? ["required"] : []),
    ...(properties.get("readonly") === true ? ["readonly"] : []),
    ...(checked === true || checked === "true" ? ["checked"] : []),
    ...(checked === "mixed" ? ["checked=mixed"] : []),
    ...(properties.get("selected") === true ? ["selected"] : []),
    ...(expanded === true ? ["expanded"] : expanded === false ? ["collapsed"] : []),
  ]
}
