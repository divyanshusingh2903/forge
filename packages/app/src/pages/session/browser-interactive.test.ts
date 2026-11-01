import { describe, expect, test } from "bun:test"
import { formatInteractiveElements } from "./browser-interactive"

const node = (role: string, name: string, backendDOMNodeId: number | undefined, extra: Record<string, unknown> = {}) => ({
  role: { value: role },
  name: { value: name },
  ...(backendDOMNodeId === undefined ? {} : { backendDOMNodeId }),
  ...extra,
})

describe("formatInteractiveElements", () => {
  test("keeps only actionable, visible nodes that have a DOM id", () => {
    const result = formatInteractiveElements({
      nodes: [
        node("StaticText", "Hello", 1),
        node("button", "Save", 2),
        node("generic", "wrapper", 3),
        node("button", "Hidden", 4, { ignored: true }),
        node("button", "No DOM node", undefined),
        node("link", "Docs", 5),
      ],
    })
    expect(result.text).toBe('[e1] button "Save"\n[e2] link "Docs"')
    expect([...result.refs]).toEqual([
      ["e1", 2],
      ["e2", 5],
    ])
  })

  test("prints value and state flags", () => {
    const prop = (name: string, value: unknown) => ({ name, value: { value } })
    const result = formatInteractiveElements({
      nodes: [
        node("textbox", "Email", 1, { value: { value: "a@b.co" }, properties: [prop("required", true), prop("readonly", true)] }),
        node("button", "Send", 2, { properties: [prop("disabled", true)] }),
        node("checkbox", "Agree", 3, { properties: [prop("checked", "true")] }),
        node("checkbox", "Some", 4, { properties: [prop("checked", "mixed")] }),
        node("option", "One", 5, { properties: [prop("selected", true)] }),
        node("button", "Menu", 6, { properties: [prop("expanded", true)] }),
        node("button", "More", 7, { properties: [prop("expanded", false)] }),
        node("textbox", "Same", 8, { value: { value: "Same" } }),
      ],
    })
    expect(result.text.split("\n")).toEqual([
      '[e1] textbox "Email" value="a@b.co" required readonly',
      '[e2] button "Send" disabled',
      '[e3] checkbox "Agree" checked',
      '[e4] checkbox "Some" checked=mixed',
      '[e5] option "One" selected',
      '[e6] button "Menu" expanded',
      '[e7] button "More" collapsed',
      '[e8] textbox "Same"',
    ])
  })

  test("collapses whitespace, truncates long text and escapes quotes", () => {
    const result = formatInteractiveElements({
      nodes: [
        node("button", `  say   "hi"\n there `, 1),
        node("link", "x".repeat(200), 2),
        node("textbox", "Field", 3, { value: { value: "y".repeat(200) } }),
      ],
    })
    const [first, second, third] = result.text.split("\n")
    expect(first).toBe('[e1] button "say \\"hi\\" there"')
    expect(second).toBe(`[e2] link "${"x".repeat(80)}…"`)
    expect(third).toBe(`[e3] textbox "Field" value="${"y".repeat(80)}…"`)
  })

  test("caps the list and says how many elements were left out", () => {
    const result = formatInteractiveElements({
      nodes: Array.from({ length: 305 }, (_, index) => node("textbox", `Field ${index}`, index + 1)),
    })
    const lines = result.text.split("\n")
    expect(lines).toHaveLength(301)
    expect(lines[299]).toStartWith("[e300] ")
    expect(lines[300]).toBe("… 5 more interactive elements not shown")
    expect(result.refs.size).toBe(300)
    expect(result.refs.get("e300")).toBe(300)
  })

  test("returns each ref's role and name for labelling actions", () => {
    const result = formatInteractiveElements({
      nodes: [
        node("generic", "wrapper", 1),
        node("textbox", "Customer name:", 2),
        node("button", `say "hi"`, 3),
        node("link", "x".repeat(200), 4),
      ],
    })
    expect(result.elements).toEqual([
      { ref: "e1", role: "textbox", name: "Customer name:" },
      { ref: "e2", role: "button", name: 'say "hi"' },
      { ref: "e3", role: "link", name: `${"x".repeat(80)}…` },
    ])
  })

  test("reports an empty page", () => {
    const result = formatInteractiveElements({ nodes: [node("StaticText", "Just text", 1)] })
    expect(result.text).toBe("No interactive elements found on this page.")
    expect(result.refs.size).toBe(0)
    expect(result.elements).toEqual([])
  })

  test("rejects a missing tree and skips malformed entries", () => {
    expect(() => formatInteractiveElements({})).toThrow("Invalid accessibility tree")
    expect(() => formatInteractiveElements(undefined)).toThrow("Invalid accessibility tree")
    const result = formatInteractiveElements({ nodes: [null, "oops", 3, {}, { role: "button" }, node("button", "Ok", 9)] })
    expect(result.text).toBe('[e1] button "Ok"')
  })
})
