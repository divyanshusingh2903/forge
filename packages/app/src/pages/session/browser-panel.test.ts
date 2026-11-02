import { describe, expect, test } from "bun:test"
import { normalizeBrowserUrl, truncateToMaxBytes } from "./browser-panel"

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
