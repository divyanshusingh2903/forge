import { describe, expect, test } from "bun:test"
import { parseWebSearchResults } from "./web-search-results"

describe("parseWebSearchResults", () => {
  test("parses Parallel JSON results and joins excerpts", () => {
    const output = JSON.stringify({
      search_id: "search_1",
      results: [
        { url: "https://a.dev/docs", title: "Docs", publish_date: null, excerpts: ["first", "second"] },
        { url: "https://b.dev", title: null, excerpts: [] },
      ],
    })
    expect(parseWebSearchResults(output)).toEqual([
      { url: "https://a.dev/docs", title: "Docs", text: "first\n\nsecond" },
      { url: "https://b.dev", title: undefined, text: "" },
    ])
  })

  test("skips Parallel results without a url", () => {
    const output = JSON.stringify({ results: [{ title: "No link", excerpts: ["x"] }, { url: "https://ok.dev" }] })
    expect(parseWebSearchResults(output)?.map((item) => item.url)).toEqual(["https://ok.dev"])
  })

  test("parses Exa title/url/text blocks", () => {
    const output = [
      "Title: createStore | SolidJS Docs",
      "URL: https://solidjs.com/docs/latest/api#createstore",
      "Text: Stores are proxy objects.",
      "More detail on a second line.",
      "",
      "Title: Understanding reactivity",
      "URL: https://dev.to/solidjs/understanding-solid-reactivity",
      "Highlights: Signals track subscribers.",
    ].join("\n")
    expect(parseWebSearchResults(output)).toEqual([
      {
        url: "https://solidjs.com/docs/latest/api#createstore",
        title: "createStore | SolidJS Docs",
        text: "Stores are proxy objects.\nMore detail on a second line.",
      },
      {
        url: "https://dev.to/solidjs/understanding-solid-reactivity",
        title: "Understanding reactivity",
        text: "Signals track subscribers.",
      },
    ])
  })

  test("returns undefined for unrecognised output", () => {
    expect(parseWebSearchResults(undefined)).toBeUndefined()
    expect(parseWebSearchResults("")).toBeUndefined()
    expect(parseWebSearchResults("No search results found. Please try a different query.")).toBeUndefined()
    expect(parseWebSearchResults("{not json")).toBeUndefined()
    expect(parseWebSearchResults(JSON.stringify({ results: [] }))).toBeUndefined()
    expect(parseWebSearchResults("Title: no url here\nsome text")).toBeUndefined()
  })
})
