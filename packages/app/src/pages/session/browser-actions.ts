import type { SessionBrowserActCommand } from "@opencode-ai/sdk/v2/client"

type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>
type Target = { ref: string; backendNodeId: number; objectId: string }

// Errors written for the agent. Anything else that escapes a CDP call is replaced with a generic message so
// browser internals never reach the tool result.
class BrowserActionError extends Error {}

const MODIFIERS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  enter: { code: "Enter", keyCode: 13, text: "\r" },
  tab: { code: "Tab", keyCode: 9 },
  escape: { code: "Escape", keyCode: 27 },
  backspace: { code: "Backspace", keyCode: 8 },
  delete: { code: "Delete", keyCode: 46 },
  arrowup: { code: "ArrowUp", keyCode: 38 },
  arrowdown: { code: "ArrowDown", keyCode: 40 },
  arrowleft: { code: "ArrowLeft", keyCode: 37 },
  arrowright: { code: "ArrowRight", keyCode: 39 },
  home: { code: "Home", keyCode: 36 },
  end: { code: "End", keyCode: 35 },
  pageup: { code: "PageUp", keyCode: 33 },
  pagedown: { code: "PageDown", keyCode: 34 },
  space: { code: "Space", keyCode: 32, text: " " },
}

// Shortcuts Chromium only runs when the editing command is named explicitly.
const EDIT_COMMANDS: Record<string, string> = { a: "selectAll", c: "copy", x: "cut", v: "paste" }

const SELECT_ALL = `function () {
  if (typeof this.select === "function") this.select()
  else getSelection().selectAllChildren(this)
}`

const CARET_TO_END = `function () {
  if (typeof this.setSelectionRange === "function") {
    try {
      this.setSelectionRange(this.value.length, this.value.length)
    } catch {}
    return
  }
  const range = document.createRange()
  range.selectNodeContents(this)
  range.collapse(false)
  getSelection().removeAllRanges()
  getSelection().addRange(range)
}`

const IS_FOCUSED = `function () {
  return this === document.activeElement || this.contains(document.activeElement)
}`

const SELECT_OPTION = `function (wanted) {
  if (!(this instanceof HTMLSelectElement)) return { notSelect: true }
  const options = Array.from(this.options)
  const match = options.find((o) => o.value === wanted || o.label.trim() === wanted || o.text.trim() === wanted)
  if (!match) return { options: options.slice(0, 20).map((o) => o.label.trim() || o.value) }
  this.selectedIndex = match.index
  this.dispatchEvent(new Event("input", { bubbles: true }))
  this.dispatchEvent(new Event("change", { bubbles: true }))
  return { label: match.label.trim() || match.value }
}`

export async function runBrowserAction(
  send: Send,
  command: SessionBrowserActCommand,
  refs: Map<string, number> | undefined,
): Promise<string | undefined> {
  let target: Target | undefined
  try {
    await send("DOM.enable")
    await send("Emulation.setFocusEmulationEnabled", { enabled: true })
    target = command.ref ? await resolveTarget(send, command.ref, refs) : undefined
    return await perform(send, command, target)
  } catch (error) {
    if (error instanceof BrowserActionError) throw error
    console.warn("browser action failed", command.action, error)
    throw new BrowserActionError(`Browser action "${command.action}" failed on the page`)
  } finally {
    if (target) void send("Runtime.releaseObject", { objectId: target.objectId }).catch(() => undefined)
  }
}

async function perform(
  send: Send,
  command: SessionBrowserActCommand,
  target: Target | undefined,
): Promise<string | undefined> {
  if (command.action === "click" || command.action === "hover") {
    const point = await elementPoint(send, requireTarget(command, target))
    await mouse(send, "mouseMoved", point)
    if (command.action === "hover") return
    await click(send, point)
    return
  }

  if (command.action === "type") {
    if (target) {
      await focusByClick(send, target)
      await send("Runtime.callFunctionOn", { objectId: target.objectId, functionDeclaration: CARET_TO_END })
    }
    await send("Input.insertText", { text: command.text ?? "" })
    return
  }

  if (command.action === "fill") {
    const element = requireTarget(command, target)
    await focusByClick(send, element)
    await send("Runtime.callFunctionOn", { objectId: element.objectId, functionDeclaration: SELECT_ALL })
    if (command.value) await send("Input.insertText", { text: command.value })
    else await pressKey(send, "Backspace")
    return
  }

  if (command.action === "select") return selectOption(send, requireTarget(command, target), command.value ?? "")

  if (command.action === "press") {
    if (target) await send("DOM.focus", { backendNodeId: target.backendNodeId })
    await pressKey(send, command.key ?? "")
    return
  }

  await scroll(send, command.direction ?? "down", target)
}

async function resolveTarget(send: Send, ref: string, refs: Map<string, number> | undefined): Promise<Target> {
  const stale = () =>
    new BrowserActionError(
      `Ref "${ref}" is not on the current page. Run browser_read with format "interactive" to get fresh refs.`,
    )
  const backendNodeId = refs?.get(ref)
  if (backendNodeId === undefined) throw stale()
  // A node removed by an in-page update is still in the ref map but no longer resolves.
  const resolved = await send("DOM.resolveNode", { backendNodeId }).catch(() => undefined)
  const objectId = readString(resolved, "object", "objectId")
  if (!objectId) throw stale()
  return { ref, backendNodeId, objectId }
}

function requireTarget(command: SessionBrowserActCommand, target: Target | undefined) {
  if (!target) throw new BrowserActionError(`Action "${command.action}" needs a ref from browser_read interactive`)
  return target
}

async function elementPoint(send: Send, target: Target) {
  await send("DOM.scrollIntoViewIfNeeded", { backendNodeId: target.backendNodeId }).catch(() => undefined)
  const result = await send("DOM.getContentQuads", { backendNodeId: target.backendNodeId })
  const quad = (isRecord(result) && Array.isArray(result.quads) ? result.quads : []).find(
    (item): item is number[] => Array.isArray(item) && item.length >= 8 && item.every((n) => typeof n === "number"),
  )
  if (!quad) throw new BrowserActionError(`Element ${target.ref} is not visible on the page`)
  return {
    x: (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4,
    y: (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4,
  }
}

async function click(send: Send, point: { x: number; y: number }) {
  await mouse(send, "mousePressed", point, { button: "left", clickCount: 1 })
  await mouse(send, "mouseReleased", point, { button: "left", clickCount: 1 })
}

// Text insertion needs a caret, which DOM.focus alone does not place; a real click does, as it does for a user.
// The check keeps text from going to whatever else is focused when something covers the element.
async function focusByClick(send: Send, target: Target) {
  const point = await elementPoint(send, target)
  await mouse(send, "mouseMoved", point)
  await click(send, point)
  const result = await send("Runtime.callFunctionOn", {
    objectId: target.objectId,
    functionDeclaration: IS_FOCUSED,
    returnByValue: true,
  })
  const focused = isRecord(result) && isRecord(result.result) && result.result.value === true
  if (!focused) {
    throw new BrowserActionError(`Element ${target.ref} could not be focused; something may be covering it`)
  }
}

function mouse(send: Send, type: string, point: { x: number; y: number }, extra: Record<string, unknown> = {}) {
  return send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, ...extra })
}

async function selectOption(send: Send, target: Target, value: string) {
  const result = await send("Runtime.callFunctionOn", {
    objectId: target.objectId,
    functionDeclaration: SELECT_OPTION,
    arguments: [{ value }],
    returnByValue: true,
  })
  const outcome = isRecord(result) && isRecord(result.result) && isRecord(result.result.value) ? result.result.value : {}
  if (outcome.notSelect) {
    throw new BrowserActionError(`Element ${target.ref} is not a <select>; use click for custom dropdowns`)
  }
  if (typeof outcome.label === "string") return `Selected "${outcome.label}"`
  const options = Array.isArray(outcome.options) ? outcome.options.join(", ") : ""
  throw new BrowserActionError(`No option "${value}" in ${target.ref}. Options: ${options}`)
}

async function pressKey(send: Send, key: string) {
  const parts = key === "+" ? [key] : key.split("+")
  const name = parts.pop() ?? ""
  const modifiers = parts.reduce((bits, part) => bits | (MODIFIERS[part] ?? 0), 0)
  if (parts.some((part) => !(part in MODIFIERS))) throw new BrowserActionError(`Unsupported key "${key}"`)

  const named = KEYS[name.toLowerCase()]
  if (!named && name.length !== 1) throw new BrowserActionError(`Unsupported key "${key}"`)
  const info = named ?? { code: "", keyCode: name.toUpperCase().charCodeAt(0), text: name }
  const base = {
    modifiers,
    windowsVirtualKeyCode: info.keyCode,
    key: named ? info.code : name,
    ...(info.code ? { code: info.code } : {}),
  }
  // Ctrl/Alt/Meta chords produce no text, so they go out as raw key events.
  const text = info.text && !(modifiers & (MODIFIERS.Alt! | MODIFIERS.Control! | MODIFIERS.Meta!)) ? info.text : undefined
  const command = modifiers & (MODIFIERS.Control! | MODIFIERS.Meta!) ? EDIT_COMMANDS[name.toLowerCase()] : undefined
  await send("Input.dispatchKeyEvent", {
    ...base,
    type: text ? "keyDown" : "rawKeyDown",
    ...(text ? { text } : {}),
    ...(command ? { commands: [command] } : {}),
  })
  await send("Input.dispatchKeyEvent", { ...base, type: "keyUp" })
}

async function scroll(send: Send, direction: "up" | "down" | "left" | "right", target: Target | undefined) {
  const metrics = await send("Page.getLayoutMetrics")
  const viewport = isRecord(metrics) && isRecord(metrics.cssVisualViewport) ? metrics.cssVisualViewport : {}
  const width = typeof viewport.clientWidth === "number" ? viewport.clientWidth : 800
  const height = typeof viewport.clientHeight === "number" ? viewport.clientHeight : 600
  const point = target ? await elementPoint(send, target) : { x: width / 2, y: height / 2 }
  await mouse(send, "mouseWheel", point, {
    deltaX: direction === "left" ? -width * 0.8 : direction === "right" ? width * 0.8 : 0,
    deltaY: direction === "up" ? -height * 0.8 : direction === "down" ? height * 0.8 : 0,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(value: unknown, ...path: string[]) {
  const found = path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value)
  return typeof found === "string" ? found : undefined
}
