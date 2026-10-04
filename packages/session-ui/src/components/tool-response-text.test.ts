import { describe, expect, test } from "bun:test"
import { formatToolResponse, previewToolResponse, TOOL_RESPONSE_PREVIEW } from "./tool-response-text"

describe("formatToolResponse", () => {
  test("pretty-prints JSON objects and arrays", () => {
    expect(formatToolResponse('{"a":1,"b":[true]}')).toBe('{\n  "a": 1,\n  "b": [\n    true\n  ]\n}')
    expect(formatToolResponse("[1,2]")).toBe("[\n  1,\n  2\n]")
  })

  test("formats JSON surrounded by whitespace", () => {
    expect(formatToolResponse('\n  {"a":1}\n')).toBe('{\n  "a": 1\n}')
  })

  test("returns plain text unchanged", () => {
    expect(formatToolResponse("# Heading\n\nbody")).toBe("# Heading\n\nbody")
  })

  test("returns text that only looks like JSON unchanged", () => {
    expect(formatToolResponse("[not json")).toBe("[not json")
    expect(formatToolResponse('{"a":')).toBe('{"a":')
  })

  test("does not reformat bare JSON scalars", () => {
    expect(formatToolResponse('"quoted"')).toBe('"quoted"')
    expect(formatToolResponse("42")).toBe("42")
  })

  test("treats missing output as empty", () => {
    expect(formatToolResponse(undefined)).toBe("")
  })
})

describe("previewToolResponse", () => {
  test("returns short text untouched", () => {
    expect(previewToolResponse("short", false)).toEqual({ truncated: false, visible: "short" })
  })

  test("does not truncate text exactly at the limit", () => {
    const text = "x".repeat(TOOL_RESPONSE_PREVIEW)
    expect(previewToolResponse(text, false)).toEqual({ truncated: false, visible: text })
  })

  test("cuts long text to the preview length until expanded", () => {
    const text = "x".repeat(TOOL_RESPONSE_PREVIEW + 5)
    const collapsed = previewToolResponse(text, false)
    expect(collapsed.truncated).toBe(true)
    expect(collapsed.visible).toHaveLength(TOOL_RESPONSE_PREVIEW)

    const expanded = previewToolResponse(text, true)
    expect(expanded.truncated).toBe(true)
    expect(expanded.visible).toBe(text)
  })
})
