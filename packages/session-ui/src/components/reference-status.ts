import type { LinkPreviewResult } from "@opencode/client/promise"
import { referenceKey, type Reference } from "./reference"

const TTL_MS = 60_000

// One lookup per reference: concurrent and repeated hovers share a promise, and results are reused for TTL_MS.
// `unavailable` is dropped at once so a later hover can retry after the user signs in to a CLI or connects an MCP.
// `refresh` skips the reuse but still joins a lookup that is already running, so repeated clicks make one request.
export function createReferenceStatusCache(fetch: (reference: Reference) => Promise<LinkPreviewResult>) {
  const entries = new Map<string, { at: number; pending: boolean; result: Promise<LinkPreviewResult> }>()

  const load = (reference: Reference, fresh: boolean) => {
    const key = referenceKey(reference)
    const existing = entries.get(key)

    if (existing && (existing.pending || (!fresh && Date.now() - existing.at < TTL_MS))) return existing.result

    const entry = {
      at: Date.now(),
      pending: true,
      result: fetch(reference)
        .catch((): LinkPreviewResult => ({ outcome: "unavailable" }))
        .then((value) => {
          entry.pending = false

          if (value.outcome === "unavailable" && entries.get(key) === entry) entries.delete(key)

          return value
        }),
    }

    entries.set(key, entry)

    return entry.result
  }

  return {
    lookup: (reference: Reference) => load(reference, false),
    refresh: (reference: Reference) => load(reference, true),
  }
}
