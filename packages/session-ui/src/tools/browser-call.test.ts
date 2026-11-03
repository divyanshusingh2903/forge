import { describe, expect, test } from "bun:test"
import { dict } from "@opencode/ui/i18n/en"
import type { ExecuteToolCall } from "../message/current-tool-state"
import { browserCallImage, browserCallSummary } from "./browser-call"

const strings = new Map(Object.entries(dict))

const i18n = {
  t: (key: string) => strings.get(key) ?? key,
  plural: (key: string, count: number) =>
    (strings.get(`${key}.${count === 1 ? "one" : "other"}`) ?? key).replace("{{count}}", String(count)),
}

const summary = (tool: string, input: ExecuteToolCall["input"], display: ExecuteToolCall["display"] = {}) =>
  browserCallSummary({ tool, status: "completed", input, display }, i18n)

describe("browserCallSummary", () => {
  test("names the element by role and name, falling back to its ref", () => {
    expect(summary("browser.click", { tabID: "tab_1", ref: "e3" }, { target: 'button "Place order"' })).toBe(
      'button "Place order"',
    )
    expect(summary("browser.click", { tabID: "tab_1", ref: "e3", count: 2 })).toBe("e3 · double-click")
    expect(
      summary("browser.fill", { tabID: "tab_1", ref: "e2", text: "Ada\nLovelace" }, { target: 'textbox "Name"' }),
    ).toBe('textbox "Name" · "Ada Lovelace"')
    expect(summary("browser.check", { tabID: "tab_1", ref: "e5", checked: false })).toBe("e5 · unchecked")
    expect(summary("browser.drag", { tabID: "tab_1", from: "e1", to: "e2" }, { from: "row 1", to: "row 2" })).toBe(
      "row 1 → row 2",
    )
  })

  test("shows where navigation ended and what a read returned", () => {
    expect(summary("browser.navigate", { tabID: "tab_1", url: "shop.test" }, { url: "https://shop.test/" })).toBe(
      "https://shop.test/",
    )
    expect(summary("browser.snapshot", { tabID: "tab_1" }, { elements: 42, truncated: true })).toBe(
      "42 elements · truncated",
    )
    expect(summary("browser.find", { tabID: "tab_1", text: "order" }, { elements: 1, matches: 1 })).toBe(
      '"order" · 1 match',
    )
    expect(summary("browser.screenshot", { tabID: "tab_1", fullPage: true })).toBe("full page")
    expect(summary("browser.screenshot", { tabID: "tab_1" })).toBe("visible area")
    expect(summary("browser.scroll", { tabID: "tab_1", deltaY: -400 })).toBe("up")
  })

  test("finds the saved image of a finished screenshot", () => {
    const path = "/tmp/opencode-browser-1/0/screenshot.jpeg"

    expect(browserCallImage({ tool: "browser.screenshot", status: "completed", display: { image: path } })).toBe(path)
    expect(
      browserCallImage({ tool: "browser.screenshot", status: "running", display: { image: path } }),
    ).toBeUndefined()
    expect(browserCallImage({ tool: "browser.click", status: "completed", display: { image: path } })).toBeUndefined()
  })

  test("leaves other calls to their argument list", () => {
    expect(summary("browser.tabs.list", {})).toBeUndefined()
    expect(summary("github.get_file_contents", { owner: "a" })).toBeUndefined()
  })
})
