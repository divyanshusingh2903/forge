import { describe, expect, test } from "bun:test"
import { normalizeBrowserUrl, resolveBrowserGotoTab, truncateToMaxBytes } from "./browser-panel"

describe("truncateToMaxBytes", () => {
  test("keeps strings within the limit untouched", () => {
    expect(truncateToMaxBytes("hello", 5)).toBe("hello")
  })

  test("cuts on a UTF-8 character boundary so the result never exceeds the limit", () => {
    // "é" is two bytes; cutting at 4 bytes would split the second one.
    const result = truncateToMaxBytes("aééé", 4)
    expect(result).toBe("aé")
    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(4)
    expect(result).not.toContain("�")
  })
})

describe("normalizeBrowserUrl", () => {
  test("adds http for local hosts and https for other hosts", () => {
    expect(normalizeBrowserUrl("localhost:3000/app")).toBe("http://localhost:3000/app")
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/")
  })

  test("returns nothing for empty input", () => {
    expect(normalizeBrowserUrl("   ")).toBeUndefined()
  })
})

describe("resolveBrowserGotoTab", () => {
  test("adopts the initial empty tab even when newTab is requested", () => {
    let created = false
    const addTab = () => {
      created = true
      return "tab-new"
    }

    const tabId = resolveBrowserGotoTab({
      url: "https://example.com",
      newTab: true,
      tabs: [{ id: "default", url: "" }],
      activeTab: { id: "default", url: "" },
      addTab,
    })

    expect(tabId).toBe("default")
    expect(created).toBe(false)
  })

  test("creates a new tab when newTab is requested and no tab is empty", () => {
    let created = false
    const addTab = () => {
      created = true
      return "tab-new"
    }

    const tabId = resolveBrowserGotoTab({
      url: "https://httpbin.org/html",
      newTab: true,
      tabs: [{ id: "default", url: "https://example.com" }],
      activeTab: { id: "default", url: "https://example.com" },
      addTab,
    })

    expect(tabId).toBe("tab-new")
    expect(created).toBe(true)
  })

  test("targets specific tabID if provided and open", () => {
    const tabId = resolveBrowserGotoTab({
      url: "https://example.com",
      tabID: "tab-2",
      tabs: [
        { id: "tab-1", url: "https://other.com" },
        { id: "tab-2", url: "https://another.com" },
      ],
      addTab: () => "tab-new",
    })

    expect(tabId).toBe("tab-2")
  })

  test("reuses tab with exact URL match when newTab is not requested", () => {
    const tabId = resolveBrowserGotoTab({
      url: "https://example.com",
      tabs: [
        { id: "tab-1", url: "https://other.com" },
        { id: "tab-2", url: "https://example.com" },
      ],
      addTab: () => "tab-new",
    })

    expect(tabId).toBe("tab-2")
  })

  test("reuses same origin tab when newTab is not requested", () => {
    const tabId = resolveBrowserGotoTab({
      url: "https://example.com/about",
      tabs: [{ id: "tab-1", url: "https://example.com/" }],
      addTab: () => "tab-new",
    })

    expect(tabId).toBe("tab-1")
  })
})
