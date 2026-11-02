import { describe, expect, test } from "bun:test"
import type { Debugger } from "electron"
import { sendBrowserCdpCommand } from "./browser-debugger"

// Electron cannot load under bun, so this is the minimum stand-in for the parts of Debugger the module uses.
function fakeDebugger(options: { attachError?: Error; commandError?: Error; result?: unknown } = {}) {
  let isAttached = false
  const detachListeners: (() => void)[] = []
  const calls = { attach: [] as string[], send: [] as { method: string; params: unknown }[] }
  const api = {
    isAttached: () => isAttached,
    attach: (version: string) => {
      if (options.attachError) throw options.attachError
      calls.attach.push(version)
      isAttached = true
    },
    sendCommand: async (method: string, params: unknown) => {
      calls.send.push({ method, params })
      if (options.commandError) throw options.commandError
      return options.result
    },
    once: (_event: string, listener: () => void) => {
      detachListeners.push(listener)
    },
  } as unknown as Debugger
  return {
    api,
    calls,
    detach: () => {
      isAttached = false
      detachListeners.splice(0).forEach((listener) => listener())
    },
  }
}

describe("sendBrowserCdpCommand", () => {
  test("attaches once and forwards an allowed command", async () => {
    const fake = fakeDebugger({ result: { visualViewport: {} } })
    const result = await sendBrowserCdpCommand(fake.api, "Page.getLayoutMetrics", { a: 1 })
    expect(result).toEqual({ visualViewport: {} })
    expect(fake.calls.attach).toEqual(["1.3"])
    expect(fake.calls.send).toEqual([{ method: "Page.getLayoutMetrics", params: { a: 1 } }])
  })

  test("allows focus emulation, which text input needs in an unfocused webview", async () => {
    const fake = fakeDebugger()
    await sendBrowserCdpCommand(fake.api, "Emulation.setFocusEmulationEnabled", { enabled: true })
    expect(fake.calls.send).toEqual([{ method: "Emulation.setFocusEmulationEnabled", params: { enabled: true } }])
    await expect(sendBrowserCdpCommand(fake.api, "Emulation.setDeviceMetricsOverride", {})).rejects.toThrow("is not allowed")
  })

  test("does not reattach while attached", async () => {
    const fake = fakeDebugger()
    await sendBrowserCdpCommand(fake.api, "DOM.enable", undefined)
    await sendBrowserCdpCommand(fake.api, "DOM.getDocument", undefined)
    expect(fake.calls.attach).toHaveLength(1)
    expect(fake.calls.send).toHaveLength(2)
  })

  test("reattaches after the debugger detaches", async () => {
    const fake = fakeDebugger()
    await sendBrowserCdpCommand(fake.api, "DOM.enable", undefined)
    fake.detach()
    await sendBrowserCdpCommand(fake.api, "DOM.enable", undefined)
    expect(fake.calls.attach).toHaveLength(2)
  })

  test("sends empty params when none are given", async () => {
    const fake = fakeDebugger()
    await sendBrowserCdpCommand(fake.api, "DOM.enable", undefined)
    expect(fake.calls.send[0]?.params).toEqual({})
  })

  test("rejects disallowed methods before attaching", async () => {
    const fake = fakeDebugger()
    for (const method of ["Runtime.evaluate", "Network.getCookies", "Target.createTarget", "Page.navigate", 42, undefined]) {
      await expect(sendBrowserCdpCommand(fake.api, method, undefined)).rejects.toThrow("is not allowed")
    }
    expect(fake.calls.attach).toHaveLength(0)
    expect(fake.calls.send).toHaveLength(0)
  })

  test("rejects invalid or oversized params", async () => {
    const fake = fakeDebugger()
    for (const params of [[], null, "text", 1]) {
      await expect(sendBrowserCdpCommand(fake.api, "DOM.enable", params)).rejects.toThrow("Invalid browser command params")
    }
    await expect(sendBrowserCdpCommand(fake.api, "Input.insertText", { text: "x".repeat(300 * 1024) })).rejects.toThrow(
      "too large",
    )
    expect(fake.calls.attach).toHaveLength(0)
  })

  test("hides the electron attach error", async () => {
    const fake = fakeDebugger({ attachError: new Error("Another debugger is already attached") })
    const error = await sendBrowserCdpCommand(fake.api, "DOM.enable", undefined).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("Browser debugger is unavailable (DevTools may be open on this tab)")
  })

  test("prefixes command failures with the method", async () => {
    const fake = fakeDebugger({ commandError: new Error("No node with given id") })
    await expect(sendBrowserCdpCommand(fake.api, "DOM.getBoxModel", { nodeId: 1 })).rejects.toThrow(
      "DOM.getBoxModel failed: No node with given id",
    )
  })
})
