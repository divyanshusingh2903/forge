import { describe, expect, test } from "bun:test"
import type { LinkPreviewResult } from "@opencode-ai/sdk/v2"
import { parseReference } from "./reference"
import { createReferenceStatusCache } from "./reference-status"

const issue = parseReference("https://github.com/acme/forge/issues/6")!
const other = parseReference("https://github.com/acme/forge/issues/7")!

describe("createReferenceStatusCache", () => {
  test("shares one request between concurrent and repeated lookups", async () => {
    let calls = 0
    const get = createReferenceStatusCache(async () => {
      calls++
      return { outcome: "ok", title: "Bug", state: "open" }
    })
    const results = await Promise.all([get(issue), get(issue), get(issue)])
    await get(issue)
    expect(calls).toBe(1)
    expect(results.every((item) => item.state === "open")).toBe(true)
  })

  test("keeps separate entries per reference", async () => {
    let calls = 0
    const get = createReferenceStatusCache(async () => {
      calls++
      return { outcome: "ok" }
    })
    await get(issue)
    await get(other)
    expect(calls).toBe(2)
  })

  test("retries after an unavailable result or a thrown error", async () => {
    const outcomes: Array<LinkPreviewResult | Error> = [
      { outcome: "unavailable" },
      new Error("network"),
      { outcome: "ok", state: "closed" },
    ]
    let calls = 0
    const get = createReferenceStatusCache(async () => {
      const next = outcomes[calls++]!
      if (next instanceof Error) throw next
      return next
    })
    expect((await get(issue)).outcome).toBe("unavailable")
    expect((await get(issue)).outcome).toBe("unavailable")
    expect((await get(issue)).state).toBe("closed")
    expect(calls).toBe(3)
  })

  test("caches forbidden results", async () => {
    let calls = 0
    const get = createReferenceStatusCache(async () => {
      calls++
      return { outcome: "forbidden" }
    })
    await get(issue)
    await get(issue)
    expect(calls).toBe(1)
  })
})
