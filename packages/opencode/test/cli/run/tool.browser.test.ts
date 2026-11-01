import { describe, expect, test } from "bun:test"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { toolInlineInfo } from "@/cli/cmd/run/tool"

function part(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>): ToolPart {
  return {
    id: "part-1",
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool",
    callID: "call-1",
    tool,
    state: { status: "completed", input, output: "", title: "", metadata, time: { start: 0, end: 1 } },
  }
}

describe("run browser tool lines", () => {
  test("browser_act names the verb, the element and the input", () => {
    expect(
      toolInlineInfo(
        part(
          "browser_act",
          { action: "fill", ref: "e2", value: "Test User" },
          { role: "textbox", name: "Customer name:", input: "Test User", url: "https://httpbin.org/forms/post" },
        ),
      ).title,
    ).toBe('Browser fill textbox "Customer name:" "Test User" https://httpbin.org/forms/post')
  })

  test("browser_act falls back to the ref when the element has no label", () => {
    expect(toolInlineInfo(part("browser_act", { action: "click", ref: "e4" }, {})).title).toBe("Browser click e4")
  })

  test("browser_read says the source, the format and how many elements an interactive read listed", () => {
    const url = "https://httpbin.org/forms/post"
    expect(toolInlineInfo(part("browser_read", {}, { url, format: "interactive", source: "live", elements: 9 })).title).toBe(
      `Browser read ${url} (live, interactive, 9 elements)`,
    )
    expect(toolInlineInfo(part("browser_read", {}, { url, format: "interactive", source: "live", elements: 1 })).title).toBe(
      `Browser read ${url} (live, interactive, 1 element)`,
    )
    expect(toolInlineInfo(part("browser_read", {}, { url, format: "markdown", source: "fetched" })).title).toBe(
      `Browser read ${url} (fetched)`,
    )
  })

  test("browser_screenshot says whether it captured the page, an element or a labelled element", () => {
    const url = "https://httpbin.org/forms/post"
    expect(toolInlineInfo(part("browser_screenshot", {}, { url })).title).toBe(`Browser screenshot ${url}`)
    expect(toolInlineInfo(part("browser_screenshot", {}, { url, fullPage: true })).title).toBe(
      `Browser screenshot ${url} (full page)`,
    )
    expect(toolInlineInfo(part("browser_screenshot", {}, { url, ref: "e1" })).title).toBe(`Browser screenshot ${url} (e1)`)
    expect(
      toolInlineInfo(part("browser_screenshot", {}, { url, ref: "e1", role: "button", name: "Submit order" })).title,
    ).toBe(`Browser screenshot ${url} (button "Submit order")`)
  })
})
