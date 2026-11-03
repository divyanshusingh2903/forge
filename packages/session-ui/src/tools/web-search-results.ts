export interface WebSearchResult {
  readonly title: string
  readonly url: string
  readonly published: string | undefined
  readonly excerpt: string
}

// The websearch tool writes each result as `## [title](url)`, an optional `Published: <ISO date>` line and the page
// excerpt. Headings are matched on whole lines so a `## ` inside an excerpt does not start a new result.
const HEADING = /^## \[(.*)\]\((https?:\/\/[^\s)]+)\)$/gm

/** Results in the websearch tool's text output, or an empty list when the output is in another format. */
export function parseWebSearchResults(output: string | undefined): WebSearchResult[] {
  if (!output) return []

  const headings = Array.from(output.matchAll(HEADING))

  return headings.map((heading, index) => {
    const body = output.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? output.length)
    const published = body.match(/^\nPublished: (\S+)/)?.[1]

    return {
      title: heading[1].trim() || heading[2],
      url: heading[2],
      published,
      excerpt: (published ? body.replace(/^\nPublished: \S+/, "") : body).trim(),
    }
  })
}
