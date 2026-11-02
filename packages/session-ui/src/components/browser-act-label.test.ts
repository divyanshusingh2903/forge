import { describe, expect, test } from "bun:test"
import { dict } from "@opencode-ai/ui/i18n/en"
import { browserActLabel } from "./browser-act-label"

const i18n = { t: (key: string) => dict[key] ?? key }

describe("browserActLabel", () => {
  test("names the verb, the element and the typed text", () => {
    expect(
      browserActLabel(
        i18n,
        { action: "fill", ref: "e2", role: "textbox", name: "Customer name:", input: "Test User" },
        { action: "fill", ref: "e2", value: "Test User" },
      ),
    ).toEqual({ verb: "Fill", target: 'textbox "Customer name:"', input: '"Test User"' })
  })

  test("falls back to the call's input and the ref while metadata is not there yet", () => {
    expect(browserActLabel(i18n, {}, { action: "click", ref: "e4" })).toEqual({
      verb: "Click",
      target: "e4",
      input: undefined,
    })
  })

  test("shows keys as typed and translates scroll directions", () => {
    expect(browserActLabel(i18n, { action: "press", input: "Control+a" }, undefined).input).toBe("Control+a")
    expect(browserActLabel(i18n, { action: "scroll", input: "down" }, undefined)).toEqual({
      verb: "Scroll",
      target: undefined,
      input: "down",
    })
  })

  test("uses the generic verb for an unknown action", () => {
    expect(browserActLabel(i18n, undefined, undefined).verb).toBe("Interact")
  })
})
