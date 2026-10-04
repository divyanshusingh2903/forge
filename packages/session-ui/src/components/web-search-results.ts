export type WebSearchResult = {
  url: string
  title?: string
  text: string
}

// Returns undefined when the output is not a recognised provider format, so callers can fall back to the raw text.
export function parseWebSearchResults(output: string | undefined): WebSearchResult[] | undefined {
  if (!output) return
  const trimmed = output.trim()
  const results = trimmed.startsWith("{") ? parallel(trimmed) : exa(trimmed)
  if (!results?.length) return
  return results
}

// Parallel: { results: [{ url, title, excerpts: string[] }] }
function parallel(output: string): WebSearchResult[] | undefined {
  const data = parseJson(output)
  if (!record(data) || !Array.isArray(data.results)) return
  return data.results.flatMap((item): WebSearchResult[] => {
    if (!record(item) || typeof item.url !== "string" || !item.url) return []
    const excerpts = Array.isArray(item.excerpts)
      ? item.excerpts.filter((excerpt): excerpt is string => typeof excerpt === "string")
      : []
    return [
      {
        url: item.url,
        title: typeof item.title === "string" && item.title ? item.title : undefined,
        text: excerpts.join("\n\n").trim(),
      },
    ]
  })
}

// Exa: blocks that start with a "Title:" line followed by a "URL:" line and the page text.
function exa(output: string): WebSearchResult[] | undefined {
  const blocks = output.split(/^(?=Title: )/m).filter((block) => block.startsWith("Title: "))
  return blocks.flatMap((block): WebSearchResult[] => {
    const url = block.match(/^URL: (\S+)\s*$/m)?.[1]
    if (!url) return []
    const title = block.match(/^Title: (.*)$/m)?.[1]?.trim()
    const text = block
      .replace(/^Title: .*$/m, "")
      .replace(/^URL: .*$/m, "")
      .replace(/^(Text|Highlights): ?/m, "")
      .trim()
    return [{ url, title: title || undefined, text }]
  })
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}
