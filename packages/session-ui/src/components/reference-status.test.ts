import { describe, expect, test } from "bun:test"
import type { LinkPreviewResult } from "@opencode/client/promise"
import type { Reference } from "./reference"
import { createReferenceStatusCache } from "./reference-status"

const pull: Reference = { kind: "github-pr", repository: "o/r", number: 1 }

function lookups(answer: (count: number) => LinkPreviewResult) {
  const calls: number[] = []
  const gates: (() => void)[] = []

  const cache = createReferenceStatusCache(
    (_reference) =>
      new Promise<LinkPreviewResult>((resolve) => {
        calls.push(calls.length + 1)
        const count = calls.length
        gates.push(() => resolve(answer(count)))
      }),
  )

  return { cache, calls, release: () => gates.splice(0).forEach((gate) => gate()) }
}

describe("createReferenceStatusCache", () => {
  test("repeated lookups share one request", async () => {
    const { cache, calls, release } = lookups(() => ({ outcome: "ok", title: "A" }))
    const first = cache.lookup(pull)
    const second = cache.lookup(pull)
    release()
    expect(await first).toEqual(await second)
    expect(calls).toHaveLength(1)
    await cache.lookup(pull)
    expect(calls).toHaveLength(1)
  })

  test("a refresh bypasses the settled result but joins a request already running", async () => {
    const { cache, calls, release } = lookups((count) => ({ outcome: "ok", title: `Title ${count}` }))
    const first = cache.lookup(pull)
    release()
    await first

    const refreshed = cache.refresh(pull)
    const again = cache.refresh(pull)
    expect(calls).toHaveLength(2)
    release()
    expect((await refreshed).title).toBe("Title 2")
    expect((await again).title).toBe("Title 2")
    expect((await cache.lookup(pull)).title).toBe("Title 2")
  })

  test("an unavailable answer is not remembered", async () => {
    const { cache, calls, release } = lookups((count) => (count === 1 ? { outcome: "unavailable" } : { outcome: "ok" }))
    const first = cache.lookup(pull)
    release()
    expect((await first).outcome).toBe("unavailable")

    const second = cache.lookup(pull)
    release()
    expect((await second).outcome).toBe("ok")
    expect(calls).toHaveLength(2)
  })
})
