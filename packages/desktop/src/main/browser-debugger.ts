import type { Debugger } from "electron"

// Only what the session browser tools need. Deliberately excludes Runtime.evaluate, Network, Storage, Target and
// Page.navigate: navigation goes through the webview, and nothing here should reach cookies or arbitrary script.
export const browserCdpMethods = new Set([
  "Accessibility.enable",
  "Accessibility.getFullAXTree",
  "DOM.enable",
  "DOM.getDocument",
  "DOM.describeNode",
  "DOM.resolveNode",
  "DOM.getBoxModel",
  "DOM.getContentQuads",
  "DOM.scrollIntoViewIfNeeded",
  "DOM.focus",
  "Runtime.callFunctionOn",
  "Runtime.releaseObject",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
  // The embedded webview is never the focused OS surface, and Chromium drops text insertion for a page that
  // reports no focus; emulation makes the page behave as focused without taking focus from the app.
  "Emulation.setFocusEmulationEnabled",
  "Page.getLayoutMetrics",
  "Page.captureScreenshot",
])

const maxParamsBytes = 256 * 1024
const attached = new WeakSet<Debugger>()

export async function sendBrowserCdpCommand(debuggerApi: Debugger, method: unknown, params: unknown) {
  if (typeof method !== "string" || !browserCdpMethods.has(method)) {
    throw new Error(`Browser command "${String(method)}" is not allowed`)
  }
  if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) {
    throw new Error("Invalid browser command params")
  }
  const payload = params ?? {}
  if (JSON.stringify(payload).length > maxParamsBytes) throw new Error("Browser command params are too large")

  if (!debuggerApi.isAttached()) {
    try {
      debuggerApi.attach("1.3")
    } catch {
      throw new Error("Browser debugger is unavailable (DevTools may be open on this tab)")
    }
  }
  if (!attached.has(debuggerApi)) {
    attached.add(debuggerApi)
    debuggerApi.once("detach", () => attached.delete(debuggerApi))
  }

  const result: unknown = await debuggerApi.sendCommand(method, payload).catch((error: unknown) => {
    throw new Error(`${method} failed: ${error instanceof Error ? error.message : String(error)}`)
  })
  return result
}
