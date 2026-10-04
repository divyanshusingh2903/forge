// Rendering megabytes of MCP output in one <pre> stalls the timeline; show a prefix until the user asks for all of it.
export const TOOL_RESPONSE_PREVIEW = 20_000

// Pretty-prints output that is a JSON object or array; anything else is returned untouched.
export function formatToolResponse(output: string | undefined) {
  const text = output ?? ""
  const trimmed = text.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return text
  }
}

export function previewToolResponse(text: string, expanded: boolean) {
  const truncated = text.length > TOOL_RESPONSE_PREVIEW
  return { truncated, visible: truncated && !expanded ? text.slice(0, TOOL_RESPONSE_PREVIEW) : text }
}
