import { describe, expect, test } from "bun:test"
import { parseWebSearchResults } from "./web-search-results"

describe("parseWebSearchResults", () => {
  test("reads each result's title, link, date and excerpt", () => {
    const output = [
      "## [Migrate from V1](https://opencode.ai/v2/docs/migrate-v1/)",
      "Published: 2026-10-30T00:00:00.000Z",
      "",
      "V2 has three intentional breaking changes.",
      "",
      "## [Releases · anomalyco/opencode](https://github.com/anomalyco/opencode/releases)",
      "",
      "Improvements",
      "## not a heading because it has no link",
    ].join("\n")

    expect(parseWebSearchResults(output)).toEqual([
      {
        title: "Migrate from V1",
        url: "https://opencode.ai/v2/docs/migrate-v1/",
        published: "2026-10-30T00:00:00.000Z",
        excerpt: "V2 has three intentional breaking changes.",
      },
      {
        title: "Releases · anomalyco/opencode",
        url: "https://github.com/anomalyco/opencode/releases",
        published: undefined,
        excerpt: "Improvements\n## not a heading because it has no link",
      },
    ])
  })

  test("keeps brackets in titles and allows results without an excerpt", () => {
    expect(parseWebSearchResults("## [[RFC] Plugins](https://example.com/rfc)")).toEqual([
      { title: "[RFC] Plugins", url: "https://example.com/rfc", published: undefined, excerpt: "" },
    ])
  })

  test("returns nothing for other formats", () => {
    expect(parseWebSearchResults("No search results found.")).toEqual([])
    expect(parseWebSearchResults("Title: Page\nURL: https://example.com\nText: body")).toEqual([])
    expect(parseWebSearchResults(undefined)).toEqual([])
  })
})
