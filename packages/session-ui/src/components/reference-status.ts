import type { LinkPreviewResult } from "@opencode-ai/sdk/v2"
import { referenceKey, type Reference } from "./reference"

const TTL_MS = 60_000

// One lookup per reference: concurrent and repeated hovers share a promise, and results are reused for TTL_MS.
// `unavailable` is dropped immediately so a later hover can retry after the user fixes `gh` or connects Linear.
export function createReferenceStatusCache(fetch: (reference: Reference) => Promise<LinkPreviewResult>) {
  const entries = new Map<string, { at: number; result: Promise<LinkPreviewResult> }>()

  return (reference: Reference) => {
    const key = referenceKey(reference)
    const existing = entries.get(key)
    if (existing && Date.now() - existing.at < TTL_MS) return existing.result
    const result = fetch(reference)
      .catch((): LinkPreviewResult => ({ outcome: "unavailable" }))
      .then((value) => {
        if (value.outcome === "unavailable" && entries.get(key)?.result === result) entries.delete(key)
        return value
      })
    entries.set(key, { at: Date.now(), result })
    return result
  }
}
