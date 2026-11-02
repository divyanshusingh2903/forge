import { describe, expect, test } from "bun:test"
import type { SessionBrowserActCommand } from "@opencode-ai/sdk/v2/client"
import { captureScreenshot, runBrowserAction } from "./browser-actions"

type Call = { method: string; params?: Record<string, unknown> }

// Scripted stand-in for the CDP channel: records every call and answers from `replies`, keyed by method.
function fakeCdp(replies: Record<string, unknown | ((params?: Record<string, unknown>) => unknown)> = {}) {
  const calls: Call[] = []
  const defaults: Record<string, unknown> = {
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getContentQuads": { quads: [[10, 20, 30, 20, 30, 40, 10, 40]] },
    // Answers the post-click focus check; tests that need other results override it.
    "Runtime.callFunctionOn": { result: { value: true } },
    "Page.captureScreenshot": { data: "AAAA" },
    "Page.getLayoutMetrics": { cssVisualViewport: { clientWidth: 1000, clientHeight: 500 } },
  }
  const send = async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params })
    const reply = method in replies ? replies[method] : defaults[method]
    if (typeof reply === "function") return (reply as (params?: Record<string, unknown>) => unknown)(params)
    return reply ?? {}
  }
  return { send, calls, methods: () => calls.map((call) => call.method) }
}

const refs = new Map([["e1", 101]])
const act = (command: Omit<SessionBrowserActCommand, "type">): SessionBrowserActCommand => ({ type: "act", ...command })

describe("runBrowserAction", () => {
  test("click moves, presses and releases the left button at the element center", async () => {
    const cdp = fakeCdp()
    await runBrowserAction(cdp.send, act({ action: "click", ref: "e1" }), refs)
    const mouse = cdp.calls.filter((call) => call.method === "Input.dispatchMouseEvent").map((call) => call.params)
    expect(mouse).toEqual([
      { type: "mouseMoved", x: 20, y: 30 },
      { type: "mousePressed", x: 20, y: 30, button: "left", clickCount: 1 },
      { type: "mouseReleased", x: 20, y: 30, button: "left", clickCount: 1 },
    ])
    expect(cdp.calls.find((call) => call.method === "DOM.scrollIntoViewIfNeeded")?.params).toEqual({ backendNodeId: 101 })
    expect(cdp.calls.at(-1)).toEqual({ method: "Runtime.releaseObject", params: { objectId: "obj-1" } })
  })

  test("hover only moves the mouse", async () => {
    const cdp = fakeCdp()
    await runBrowserAction(cdp.send, act({ action: "hover", ref: "e1" }), refs)
    expect(cdp.calls.filter((call) => call.method === "Input.dispatchMouseEvent").map((call) => call.params?.type)).toEqual([
      "mouseMoved",
    ])
  })

  test("reports an unknown or unresolvable ref as stale without sending input", async () => {
    const unknown = fakeCdp()
    await expect(runBrowserAction(unknown.send, act({ action: "click", ref: "e9" }), refs)).rejects.toThrow(
      'Ref "e9" is not on the current page. Run browser_read with format "interactive"',
    )
    await expect(runBrowserAction(unknown.send, act({ action: "click", ref: "e1" }), undefined)).rejects.toThrow(
      "is not on the current page",
    )
    expect(unknown.methods()).not.toContain("Input.dispatchMouseEvent")

    const removed = fakeCdp({
      "DOM.resolveNode": () => {
        throw new Error("No node with given id found")
      },
    })
    await expect(runBrowserAction(removed.send, act({ action: "click", ref: "e1" }), refs)).rejects.toThrow(
      "is not on the current page",
    )
    expect(removed.methods()).not.toContain("Input.dispatchMouseEvent")
  })

  test("reports an element without a box as not visible", async () => {
    const cdp = fakeCdp({ "DOM.getContentQuads": { quads: [] } })
    await expect(runBrowserAction(cdp.send, act({ action: "click", ref: "e1" }), refs)).rejects.toThrow(
      "Element e1 is not visible on the page",
    )
    expect(cdp.methods()).not.toContain("Input.dispatchMouseEvent")
  })

  test("type clicks the element, puts the caret at the end and inserts text without clearing", async () => {
    const withRef = fakeCdp()
    await runBrowserAction(withRef.send, act({ action: "type", ref: "e1", text: "hello" }), refs)
    const sequence = withRef.methods().filter((method) => !["DOM.enable", "DOM.resolveNode", "DOM.scrollIntoViewIfNeeded", "DOM.getContentQuads"].includes(method))
    expect(sequence).toEqual([
      "Emulation.setFocusEmulationEnabled",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Runtime.callFunctionOn",
      "Runtime.callFunctionOn",
      "Input.insertText",
      "Runtime.releaseObject",
    ])
    expect(withRef.calls.find((call) => call.method === "Input.insertText")?.params).toEqual({ text: "hello" })
    expect(withRef.methods()).not.toContain("DOM.focus")

    const withoutRef = fakeCdp()
    await runBrowserAction(withoutRef.send, act({ action: "type", text: "hi" }), refs)
    expect(withoutRef.methods()).not.toContain("Input.dispatchMouseEvent")
    expect(withoutRef.methods()).toContain("Input.insertText")
  })

  test("does not insert text when the click left the element unfocused", async () => {
    for (const action of [act({ action: "fill", ref: "e1", value: "Ada" }), act({ action: "type", ref: "e1", text: "Ada" })]) {
      const cdp = fakeCdp({ "Runtime.callFunctionOn": { result: { value: false } } })
      await expect(runBrowserAction(cdp.send, action, refs)).rejects.toThrow(
        "Element e1 could not be focused; something may be covering it",
      )
      expect(cdp.methods()).not.toContain("Input.insertText")
    }
  })

  test("fill selects the existing text and replaces it, or deletes it for an empty value", async () => {
    const filled = fakeCdp()
    await runBrowserAction(filled.send, act({ action: "fill", ref: "e1", value: "Ada" }), refs)
    // Focus emulation must be on before text goes in, or the unfocused webview page drops it.
    expect(filled.methods().filter((method) => !["DOM.enable", "DOM.resolveNode", "DOM.scrollIntoViewIfNeeded", "DOM.getContentQuads"].includes(method))).toEqual([
      "Emulation.setFocusEmulationEnabled",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Runtime.callFunctionOn",
      "Runtime.callFunctionOn",
      "Input.insertText",
      "Runtime.releaseObject",
    ])
    expect(filled.calls.find((call) => call.method === "Input.insertText")?.params).toEqual({ text: "Ada" })

    const cleared = fakeCdp()
    await runBrowserAction(cleared.send, act({ action: "fill", ref: "e1", value: "" }), refs)
    expect(cleared.methods()).not.toContain("Input.insertText")
    const keys = cleared.calls.filter((call) => call.method === "Input.dispatchKeyEvent").map((call) => call.params)
    expect(keys[0]).toMatchObject({ type: "rawKeyDown", key: "Backspace", windowsVirtualKeyCode: 8 })
    expect(keys[1]).toMatchObject({ type: "keyUp", key: "Backspace" })
  })

  test("turns focus emulation on before every action", async () => {
    const cdp = fakeCdp()
    await runBrowserAction(cdp.send, act({ action: "press", key: "Tab" }), refs)
    expect(cdp.calls.find((call) => call.method === "Emulation.setFocusEmulationEnabled")?.params).toEqual({ enabled: true })
    expect(cdp.methods().indexOf("Emulation.setFocusEmulationEnabled")).toBeLessThan(
      cdp.methods().indexOf("Input.dispatchKeyEvent"),
    )
  })

  test("select reports the chosen option, the available options, or a non-select element", async () => {
    const matched = fakeCdp({ "Runtime.callFunctionOn": { result: { value: { label: "Large" } } } })
    expect(await runBrowserAction(matched.send, act({ action: "select", ref: "e1", value: "large" }), refs)).toBe(
      'Selected "Large"',
    )
    expect(matched.calls.find((call) => call.method === "Runtime.callFunctionOn")?.params).toMatchObject({
      arguments: [{ value: "large" }],
      returnByValue: true,
    })

    const missing = fakeCdp({ "Runtime.callFunctionOn": { result: { value: { options: ["Small", "Large"] } } } })
    await expect(runBrowserAction(missing.send, act({ action: "select", ref: "e1", value: "Huge" }), refs)).rejects.toThrow(
      'No option "Huge" in e1. Options: Small, Large',
    )

    const custom = fakeCdp({ "Runtime.callFunctionOn": { result: { value: { notSelect: true } } } })
    await expect(runBrowserAction(custom.send, act({ action: "select", ref: "e1", value: "x" }), refs)).rejects.toThrow(
      "Element e1 is not a <select>; use click for custom dropdowns",
    )
  })

  test("press sends named keys with text, chords as raw events, and rejects unknown keys", async () => {
    const enter = fakeCdp()
    await runBrowserAction(enter.send, act({ action: "press", key: "Enter" }), refs)
    const enterKeys = enter.calls.filter((call) => call.method === "Input.dispatchKeyEvent").map((call) => call.params)
    expect(enterKeys[0]).toMatchObject({ type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", modifiers: 0 })
    expect(enterKeys[1]).toMatchObject({ type: "keyUp", windowsVirtualKeyCode: 13 })

    const chord = fakeCdp()
    await runBrowserAction(chord.send, act({ action: "press", key: "Control+a" }), refs)
    const chordDown = chord.calls.find((call) => call.method === "Input.dispatchKeyEvent")?.params
    expect(chordDown).toMatchObject({ type: "rawKeyDown", modifiers: 2, key: "a", windowsVirtualKeyCode: 65, commands: ["selectAll"] })
    expect(chordDown).not.toHaveProperty("text")

    const typed = fakeCdp()
    await runBrowserAction(typed.send, act({ action: "press", key: "x" }), refs)
    expect(typed.calls.find((call) => call.method === "Input.dispatchKeyEvent")?.params).toMatchObject({ type: "keyDown", text: "x" })

    for (const key of ["F13", "Hyper+a", ""]) {
      await expect(runBrowserAction(fakeCdp().send, act({ action: "press", key }), refs)).rejects.toThrow(
        `Unsupported key "${key}"`,
      )
    }
  })

  test("scroll wheels at the viewport center, or over the element when given a ref", async () => {
    const down = fakeCdp()
    await runBrowserAction(down.send, act({ action: "scroll", direction: "down" }), refs)
    expect(down.calls.find((call) => call.method === "Input.dispatchMouseEvent")?.params).toEqual({
      type: "mouseWheel",
      x: 500,
      y: 250,
      deltaX: 0,
      deltaY: 400,
    })

    const left = fakeCdp()
    await runBrowserAction(left.send, act({ action: "scroll", direction: "left" }), refs)
    expect(left.calls.find((call) => call.method === "Input.dispatchMouseEvent")?.params).toMatchObject({ deltaX: -800, deltaY: 0 })

    const overElement = fakeCdp()
    await runBrowserAction(overElement.send, act({ action: "scroll", direction: "up", ref: "e1" }), refs)
    expect(overElement.calls.find((call) => call.method === "Input.dispatchMouseEvent")?.params).toMatchObject({
      x: 20,
      y: 30,
      deltaY: -400,
    })
  })

  test("replaces unexpected protocol failures with a generic message", async () => {
    const cdp = fakeCdp({
      "Input.dispatchMouseEvent": () => {
        throw new Error("Internal CDP detail: target crashed at 0xdeadbeef")
      },
    })
    const error = await runBrowserAction(cdp.send, act({ action: "click", ref: "e1" }), refs).catch((error: Error) => error)
    expect((error as Error).message).toBe('Browser action "click" failed on the page')
  })
})

// Layout metrics as CDP reports them: viewport and page offset in CSS px, `visualViewport` in device px.
const metrics = (input: { pageY?: number; dpr?: number; contentHeight?: number } = {}) => ({
  cssVisualViewport: { pageX: 0, pageY: input.pageY ?? 100, clientWidth: 1000, clientHeight: 500 },
  visualViewport: { clientWidth: 1000 * (input.dpr ?? 1) },
  cssContentSize: { width: 1000, height: input.contentHeight ?? 3000 },
})

describe("captureScreenshot", () => {
  const shotParams = (cdp: ReturnType<typeof fakeCdp>) =>
    cdp.calls.find((call) => call.method === "Page.captureScreenshot")?.params

  test("crops to the element with padding, in page coordinates", async () => {
    const cdp = fakeCdp({ "Page.getLayoutMetrics": metrics() })
    const shot = await captureScreenshot(cdp.send, { ref: "e1" }, refs)
    expect(shot).toEqual({ image: "AAAA", mime: "image/jpeg", detail: undefined })
    expect(shotParams(cdp)).toEqual({
      format: "jpeg",
      quality: 80,
      clip: { x: 2, y: 112, width: 36, height: 36, scale: 1 },
      captureBeyondViewport: false,
    })
    expect(cdp.calls.at(-1)).toEqual({ method: "Runtime.releaseObject", params: { objectId: "obj-1" } })
  })

  test("shrinks a large element on a high-density display to the size limit", async () => {
    const cdp = fakeCdp({
      "Page.getLayoutMetrics": metrics({ dpr: 2 }),
      "DOM.getContentQuads": { quads: [[0, 0, 1500, 0, 1500, 100, 0, 100]] },
    })
    await captureScreenshot(cdp.send, { ref: "e1" }, refs)
    const clip = (shotParams(cdp)?.clip ?? {}) as { width: number; scale: number }
    expect(clip.width).toBe(1516)
    expect(clip.scale).toBeCloseTo(1920 / (1516 * 2), 6)
  })

  test("rejects a stale or invisible element without capturing", async () => {
    const stale = fakeCdp()
    await expect(captureScreenshot(stale.send, { ref: "e9" }, refs)).rejects.toThrow("is not on the current page")
    expect(stale.methods()).not.toContain("Page.captureScreenshot")

    const hidden = fakeCdp({ "DOM.getContentQuads": { quads: [[10, 20, 10, 20, 10, 20, 10, 20]] }, "Page.getLayoutMetrics": metrics() })
    await expect(captureScreenshot(hidden.send, { ref: "e1" }, refs)).rejects.toThrow("Element e1 is not visible on the page")
    expect(hidden.methods()).not.toContain("Page.captureScreenshot")
  })

  test("captures the whole page beyond the viewport when it fits the height cap", async () => {
    const cdp = fakeCdp({ "Page.getLayoutMetrics": metrics() })
    const shot = await captureScreenshot(cdp.send, { fullPage: true }, undefined)
    expect(shot.detail).toBeUndefined()
    expect(shotParams(cdp)).toMatchObject({
      clip: { x: 0, y: 0, width: 1000, height: 3000, scale: 0.64 },
      captureBeyondViewport: true,
    })
  })

  test("caps a tall page and says how much was captured", async () => {
    const cdp = fakeCdp({ "Page.getLayoutMetrics": metrics({ contentHeight: 9500 }) })
    const shot = await captureScreenshot(cdp.send, { fullPage: true }, undefined)
    expect(shot.detail).toBe("Captured the top 4000px of a 9500px page")
    expect(shotParams(cdp)).toMatchObject({ clip: { x: 0, y: 0, width: 1000, height: 4000 } })
  })

  test("reports an empty or oversized capture", async () => {
    const empty = fakeCdp({ "Page.getLayoutMetrics": metrics(), "Page.captureScreenshot": {} })
    await expect(captureScreenshot(empty.send, { fullPage: true }, undefined)).rejects.toThrow("Screenshot did not return an image")

    const huge = fakeCdp({ "Page.getLayoutMetrics": metrics(), "Page.captureScreenshot": { data: "x".repeat(5 * 1024 * 1024 + 1) } })
    await expect(captureScreenshot(huge.send, { fullPage: true }, undefined)).rejects.toThrow("Screenshot is too large")

    const blank = fakeCdp({ "Page.getLayoutMetrics": { cssContentSize: { width: 0, height: 0 } } })
    await expect(captureScreenshot(blank.send, { fullPage: true }, undefined)).rejects.toThrow("The page has no content to capture")
  })

  test("replaces unexpected protocol failures with a generic message", async () => {
    const cdp = fakeCdp({
      "Page.getLayoutMetrics": metrics(),
      "Page.captureScreenshot": () => {
        throw new Error("Internal CDP detail: renderer gone")
      },
    })
    const error = await captureScreenshot(cdp.send, { fullPage: true }, undefined).catch((error: Error) => error)
    expect((error as Error).message).toBe("Browser screenshot failed on the page")
  })
})
