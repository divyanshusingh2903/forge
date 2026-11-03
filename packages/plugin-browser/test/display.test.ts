import { expect, test } from "bun:test"
import { BrowserDisplay } from "../src/display.js"
import { Browser } from "../src/rpc.js"

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
const ref = (value: string) => Browser.Ref.make(value)

const tab = (url: string, title: string) => ({
  id: tabID,
  url,
  title,
  loading: false,
  canGoBack: true,
  canGoForward: false,
  generation: 1,
})

const snapshot = [
  '@e1 [RootWebArea] "Checkout"',
  '  @e2 [textbox] "Customer \\"name\\":" ',
  '  @e3 [button] "Place order" disabled=false',
  '  [paragraph] "Totals"',
  '  @e4 [link] ""',
].join("\n")

test("a snapshot names its elements for later calls and reports what it read", () => {
  const labels: BrowserDisplay.Labels = new Map()

  expect(
    BrowserDisplay.describe(
      { type: "snapshot", tabID },
      { tab: tab("https://shop.test/checkout", "Checkout"), content: snapshot, truncated: true },
      labels,
    ),
  ).toEqual({ elements: 4, truncated: true })

  expect(BrowserDisplay.describe({ type: "fill", tabID, ref: ref("e2"), text: "Ada" }, tab("", ""), labels)).toEqual({
    target: 'textbox "Customer "name":"',
  })
  expect(BrowserDisplay.describe({ type: "click", tabID, ref: ref("@e4") }, tab("", ""), labels)).toEqual({
    target: "link",
  })
  expect(BrowserDisplay.describe({ type: "hover", tabID, ref: ref("e9") }, tab("", ""), labels)).toEqual({})
  expect(
    BrowserDisplay.describe(
      {
        type: "fill_form",
        tabID,
        fields: [
          { ref: ref("e2"), type: "text", value: "Ada" },
          { ref: ref("e7"), type: "check", checked: true },
        ],
      },
      tab("", ""),
      labels,
    ),
  ).toEqual({ fields: 'textbox "Customer "name":", e7' })
  expect(BrowserDisplay.describe({ type: "drag", tabID, from: ref("e3"), to: ref("e4") }, tab("", ""), labels)).toEqual(
    {
      from: 'button "Place order"',
      to: "link",
    },
  )
})

test("find counts its matches, screenshots name their element, and navigation reports where it ended", () => {
  const labels: BrowserDisplay.Labels = new Map()

  expect(
    BrowserDisplay.describe(
      { type: "find", tabID, text: "order" },
      { tab: tab("", ""), content: '  @e3 [button] "Place order"', truncated: false },
      labels,
    ),
  ).toEqual({ elements: 1, matches: 1 })
  expect(
    BrowserDisplay.describe({ type: "screenshot", tabID, ref: ref("e3") }, { tab: tab("", ""), files: [] }, labels),
  ).toEqual({ target: 'button "Place order"' })
  expect(BrowserDisplay.describe({ type: "back", tabID }, tab("https://shop.test/cart", "Cart"), labels)).toEqual({
    url: "https://shop.test/cart",
    title: "Cart",
  })
  expect(
    BrowserDisplay.describe({ type: "screenshot", tabID, fullPage: true }, { tab: tab("", ""), files: [] }, labels, [
      { mime: "image/jpeg", path: "/tmp/opencode-browser-1/0/screenshot.jpeg" },
    ]),
  ).toEqual({ image: "/tmp/opencode-browser-1/0/screenshot.jpeg" })
  expect(BrowserDisplay.describe({ type: "tabs.list" }, { tabs: [], focusedTabID: null }, labels)).toEqual({})
})
