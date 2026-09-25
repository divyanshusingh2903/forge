import WebSocket from "ws"
// import { existsSync } from "node:fs"
// import { appendFile } from "node:fs/promises"
// import path from "node:path"
// import { Global } from "@opencode-ai/core/global"
import { ProviderError } from "@/provider/error"
import { isRecord } from "@/util/record"
import { OpenAIWebSocket } from "./ws"

export const TITLE_HEADER = "x-opencode-title"
export const CONTINUATION_HEADER = "x-openai-oauth-continuation"

// Diagnostic for verifying the continuation mechanism against a real backend.
// Enable via OPENCODE_DEBUG_CONTINUATION=1, or (desktop dev builds don't
// forward env vars to the sidecar) by touching
// <Global.Path.data>/debug-continuation.
// const CONTINUATION_DEBUG =
//   process.env.OPENCODE_DEBUG_CONTINUATION === "1" || existsSync(path.join(Global.Path.data, "debug-continuation"))
const CONTINUATION_DEBUG = false

// function debugLog(sessionKey: string, message: string, detail?: Record<string, unknown>) {
//   if (!CONTINUATION_DEBUG) return
//   const suffix = detail
//     ? " " +
//       Object.entries(detail)
//         .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
//         .join(" ")
//     : ""
//   const line = `${new Date().toISOString()} level=INFO run=continuation message="openai-continuation: ${message}" session=${sessionKey}${suffix}\n`
//   appendFile(path.join(Global.Path.log, "opencode.log"), line).catch(() => {})
// }
function debugLog(_sessionKey: string, _message: string, _detail?: Record<string, unknown>) {}

export interface CreateWebSocketFetchOptions {
  httpFetch?: typeof globalThis.fetch
  url?: string
  connectTimeout?: number
  idleTimeout?: number
  maxConnectionAge?: number
  streamRetries?: number
}

interface PoolEntry {
  socket?: WebSocket
  connectedAt?: number
  lastUsedAt: number
  busy: boolean
  fallback: boolean
  streamFailures: number
  // Continuation checkpoint for this connection's last completed turn.
  lastResponseId?: string
  lastInvariant?: unknown
  lastInputItems?: unknown[]
  lastOutputItems?: unknown[]
}

const DEFAULT_CONNECT_TIMEOUT = 15_000
const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1000
const DEFAULT_MAX_CONNECTION_AGE = 55 * 60 * 1000
const CONNECTION_LIMIT_REACHED_CODE = "websocket_connection_limit_reached"

export function createWebSocketFetch(options?: CreateWebSocketFetchOptions) {
  const httpFetch = options?.httpFetch ?? globalThis.fetch
  const pool = new Map<string, PoolEntry>()
  const connectTimeout = options?.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT
  const idleTimeout = options?.idleTimeout ?? DEFAULT_IDLE_TIMEOUT
  const maxConnectionAge = options?.maxConnectionAge ?? DEFAULT_MAX_CONNECTION_AGE
  const streamRetries = options?.streamRetries ?? 5
  const pruneTimer = setInterval(() => prune(), Math.min(idleTimeout, 60_000))
  if (typeof pruneTimer === "object" && "unref" in pruneTimer && typeof pruneTimer.unref === "function") {
    pruneTimer.unref()
  }

  async function websocketFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url
    const internalHeaders = OpenAIWebSocket.normalizeHeaders(init?.headers)
    const httpInit = withoutInternalHeaders(init)

    if (CONTINUATION_DEBUG)
      debugLog("n/a", "websocketFetch invoked", {
        method: init?.method,
        pathname: (() => {
          try {
            return new URL(url).pathname
          } catch {
            return url
          }
        })(),
        has_continuation_header: internalHeaders[CONTINUATION_HEADER] === "true",
      })

    if (init?.method !== "POST" || !new URL(url).pathname.endsWith("/responses")) {
      debugLog("n/a", "http fallback: not a POST /responses request")
      return httpFetch(input, httpInit)
    }

    const body = (() => {
      try {
        if (typeof init?.body !== "string") return undefined
        const parsed = JSON.parse(init.body)
        return typeof parsed === "object" && parsed !== null ? parsed : undefined
      } catch {
        return undefined
      }
    })()
    if (!body?.stream) {
      debugLog("n/a", "http fallback: body.stream is not true")
      return httpFetch(input, httpInit)
    }
    if (internalHeaders[TITLE_HEADER] === "true") {
      debugLog("n/a", "http fallback: title-generation request")
      return httpFetch(input, httpInit)
    }

    const sessionID = internalHeaders["x-session-affinity"] ?? internalHeaders["session-id"]
    if (!sessionID) {
      debugLog("n/a", "http fallback: no session id header")
      return httpFetch(input, httpInit)
    }
    const key = `${sessionID}:conversation`

    const entry = pool.get(key) ?? { lastUsedAt: Date.now(), busy: false, fallback: false, streamFailures: 0 }
    pool.set(key, entry)

    if (entry.fallback) {
      debugLog(key, "http fallback: entry already in permanent HTTP fallback")
      return httpFetch(input, httpInit)
    }
    if (entry.busy) {
      debugLog(key, "http fallback: entry busy with another in-flight request")
      return httpFetch(input, httpInit)
    }

    const continuation = internalHeaders[CONTINUATION_HEADER] === "true"
    const fullInput = continuation && Array.isArray(body?.input) ? [...body.input] : undefined

    entry.busy = true
    entry.lastUsedAt = Date.now()
    try {
      // Must resolve before eligibility is computed below: rotating the
      // socket clears the checkpoint, so a rotation has to happen first.
      entry.socket = await socket(
        entry,
        options?.url ?? url,
        OpenAIWebSocket.normalizeHeaders(httpInit?.headers),
        connectTimeout,
        maxConnectionAge,
        init?.signal,
      )

      if (continuation && fullInput) {
        const baseline = [...(entry.lastInputItems ?? []), ...(entry.lastOutputItems ?? [])]
        const hasCheckpoint = entry.lastResponseId !== undefined && entry.lastInvariant !== undefined
        const invariantMatches = hasCheckpoint && deepEqual(invariantOf(body), entry.lastInvariant)
        const eligible = invariantMatches && startsWithBaseline(fullInput, baseline)

        if (eligible) {
          body.input = fullInput.slice(baseline.length)
          body.previous_response_id = entry.lastResponseId
          debugLog(key, "incremental send", {
            previous_response_id: entry.lastResponseId,
            new_items: body.input.length,
            baseline_items: baseline.length,
          })
        } else {
          delete body.previous_response_id
          if (CONTINUATION_DEBUG) {
            const reason = !hasCheckpoint ? "no-checkpoint" : !invariantMatches ? "invariant-mismatch" : "prefix-mismatch"
            debugLog(key, "full send", { reason, input_items: fullInput.length })
            if (reason === "prefix-mismatch") {
              const mismatchIndex = baseline.findIndex((item, i) => !isSubset(fullInput[i], item))
              debugLog(key, "prefix-mismatch detail", {
                mismatch_index: mismatchIndex,
                baseline_item: JSON.stringify(baseline[mismatchIndex]),
                new_input_item: JSON.stringify(fullInput[mismatchIndex]),
              })
            }
          }
        }
        // Do not touch body.store here: the live Codex backend rejects
        // `store: true` outright, unlike the public Responses API.
      }

      let resolveFirstEvent: (event: boolean | OpenAIWebSocket.WrappedError) => void = () => {}
      let rejectFirstEvent: (error: Error) => void = () => {}
      const firstEvent = new Promise<boolean | OpenAIWebSocket.WrappedError>((resolve, reject) => {
        resolveFirstEvent = resolve
        rejectFirstEvent = reject
      })
      let started = false
      let continuationRetried = false
      const streamedOutputItems: Record<string, unknown>[] = []
      const response = OpenAIWebSocket.streamResponsesWebSocket({
        socket: entry.socket,
        body,
        idleTimeout,
        signal: init?.signal ?? undefined,
        onFirstEvent: (error) => {
          started = true
          resolveFirstEvent(error ?? true)
        },
        onOutputItem: (item) => {
          if (continuation) streamedOutputItems.push(item)
        },
        onComplete: (event) => {
          if (!continuation) return
          const completion = isRecord(event.response) ? event.response : undefined
          const responseId = typeof completion?.id === "string" ? completion.id : undefined
          // The Codex backend's terminal event routinely omits or empties
          // `output` (confirmed live), so the streamed output_item.done items
          // are the primary source; a non-empty terminal `output` is preferred
          // when present.
          const terminalOutput = Array.isArray(completion?.output) ? completion.output : undefined
          const output =
            terminalOutput && terminalOutput.length > 0
              ? terminalOutput
              : streamedOutputItems.length > 0
                ? streamedOutputItems
                : undefined
          if (!responseId || !output) {
            if (CONTINUATION_DEBUG) debugLog(key, "dropping checkpoint (no usable output)", { responseId })
            entry.lastResponseId = undefined
            return
          }
          debugLog(key, "checkpoint saved", {
            responseId,
            output_items: output.length,
            source: terminalOutput && terminalOutput.length > 0 ? "terminal" : "streamed",
          })
          entry.lastResponseId = responseId
          entry.lastInvariant = invariantOf(body)
          entry.lastInputItems = Array.isArray(body.input) ? body.input : []
          entry.lastOutputItems = output
        },
        onTerminal: (event) => {
          entry.busy = false
          entry.lastUsedAt = Date.now()
          entry.streamFailures = 0
          if (event.type !== "response.completed" && event.type !== "response.done") {
            invalidate(entry)
          }
        },
        onConnectionInvalid: (_error, closeCode) => {
          entry.busy = false
          entry.lastUsedAt = Date.now()
          if (closeCode === OpenAIWebSocket.MESSAGE_TOO_BIG_CLOSE_CODE) entry.fallback = true
          else if (!entry.fallback) recordStreamFailure(entry)
          invalidate(entry)
          resolveFirstEvent(false)
        },
        onAbort: (error) => {
          entry.busy = false
          entry.lastUsedAt = Date.now()
          entry.streamFailures = 0
          invalidate(entry)
          rejectFirstEvent(error)
        },
        onRetryableTerminal: async (event) => {
          const limitError = connectionLimitError(event)
          if (limitError) throw limitError

          // Codex rejects a stale previous_response_id with a plain
          // invalid_request_error and no distinguishing code, so any
          // unhandled rejection of a continuation attempt is treated as
          // staleness: drop the checkpoint and retry once in full.
          if (!continuation || continuationRetried || started || body.previous_response_id === undefined || !fullInput)
            return undefined

          debugLog(key, "stale previous_response_id rejected, retrying in full", {
            rejected_previous_response_id: body.previous_response_id,
          })
          continuationRetried = true
          entry.lastResponseId = undefined
          body.input = fullInput
          delete body.previous_response_id
          invalidate(entry)
          entry.socket = await socket(
            entry,
            options?.url ?? url,
            OpenAIWebSocket.normalizeHeaders(httpInit?.headers),
            connectTimeout,
            maxConnectionAge,
            init?.signal,
          )
          return entry.socket
        },
      })
      const first = await firstEvent
      if (first !== false) {
        if (first === true || first.status < 200 || first.status > 599) return response
        return new Response(first.body, {
          status: first.status,
          headers: { "content-type": "application/json", ...first.headers },
        })
      }
      if (!entry.fallback) return response
      return httpFetch(input, httpInit)
    } catch (error) {
      entry.busy = false
      entry.lastUsedAt = Date.now()
      if (OpenAIWebSocket.isAbortError(error)) {
        entry.streamFailures = 0
        invalidate(entry)
        throw error
      }

      recordStreamFailure(entry)
      invalidate(entry)
      if (entry.fallback) return httpFetch(input, httpInit)
      return failedResponse(
        new ProviderError.ResponseStreamError(error instanceof Error ? error.message : String(error), {
          cause: error,
        }),
      )
    }
  }

  function recordStreamFailure(entry: PoolEntry) {
    entry.streamFailures++
    // Codex counts retries after the initial failed WebSocket attempt.
    if (entry.streamFailures > streamRetries) entry.fallback = true
  }

  function prune() {
    const now = Date.now()
    for (const [key, entry] of pool) {
      if (entry.busy) continue
      if (entry.fallback) continue
      if (now - entry.lastUsedAt < idleTimeout) continue
      invalidate(entry)
      pool.delete(key)
    }
  }

  function close() {
    clearInterval(pruneTimer)
    for (const entry of pool.values()) invalidate(entry)
    pool.clear()
  }

  function remove(sessionID: string) {
    const key = `${sessionID}:conversation`
    const entry = pool.get(key)
    if (!entry) return
    invalidate(entry)
    pool.delete(key)
  }

  return Object.assign(websocketFetch, { close, remove })
}

function connectionLimitError(event: Record<string, unknown>) {
  if (event.type !== "error" || !isRecord(event.error) || event.error.code !== CONNECTION_LIMIT_REACHED_CODE) return
  return new Error(typeof event.error.message === "string" ? event.error.message : CONNECTION_LIMIT_REACHED_CODE)
}

function failedResponse(error: ProviderError.ResponseStreamError) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(error)
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  )
}

async function socket(
  entry: PoolEntry,
  url: string,
  headers: Record<string, string>,
  connectTimeout: number,
  maxConnectionAge: number,
  signal?: AbortSignal | null,
) {
  if (
    entry.socket?.readyState === WebSocket.OPEN &&
    entry.connectedAt &&
    Date.now() - entry.connectedAt < maxConnectionAge
  ) {
    return entry.socket
  }

  invalidate(entry)
  const next = await OpenAIWebSocket.connectResponsesWebSocket({
    url: OpenAIWebSocket.toWebSocketUrl(url),
    headers,
    timeout: connectTimeout,
    signal: signal ?? undefined,
  })
  entry.connectedAt = Date.now()
  return next
}

function invalidate(entry: PoolEntry) {
  if (entry.socket) {
    entry.socket.on("error", () => {})
    entry.socket.terminate()
    entry.socket = undefined
  }
  entry.connectedAt = undefined
  entry.lastResponseId = undefined
  entry.lastInvariant = undefined
  entry.lastInputItems = undefined
  entry.lastOutputItems = undefined
}

export function withoutInternalHeaders<T extends { headers?: HeadersInit }>(init: T | undefined): T | undefined {
  if (!init?.headers) return init
  const internal = new Set([TITLE_HEADER, CONTINUATION_HEADER])
  if (init.headers instanceof Headers) {
    const headers = new Headers(init.headers)
    for (const name of internal) headers.delete(name)
    return { ...init, headers }
  }

  if (Array.isArray(init.headers)) {
    return { ...init, headers: init.headers.filter((item) => !internal.has(item[0].toLowerCase())) }
  }

  return {
    ...init,
    headers: Object.fromEntries(Object.entries(init.headers).filter(([key]) => !internal.has(key.toLowerCase()))),
  }
}

// Request config that must stay identical across turns to safely continue.
function invariantOf(body: Record<string, unknown>) {
  const { input: _input, previous_response_id: _previousResponseId, store: _store, ...rest } = body
  return canonicalize(rest)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([entryKey, entryValue]) => [entryKey, canonicalize(entryValue)]),
    )
  }
  return value
}

function deepEqual(a: unknown, b: unknown) {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))
}

function startsWithBaseline(input: unknown[], baseline: unknown[]) {
  if (input.length < baseline.length) return false
  for (let i = 0; i < baseline.length; i++) {
    if (!isSubset(input[i], baseline[i])) return false
  }
  return true
}

// Matches `actual` against `expected` on every field `actual` carries,
// ignoring extras in `expected` -- confirmed live that Forge's reconstructed
// history is a strict subset of the raw item the provider streamed back
// (e.g. it omits `id`/`type`/`status`), so full deep-equality never matches.
function isSubset(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    return Array.isArray(expected) && actual.length === expected.length && actual.every((item, i) => isSubset(item, expected[i]))
  }
  if (actual && typeof actual === "object") {
    if (!expected || typeof expected !== "object" || Array.isArray(expected)) return false
    return Object.entries(actual as Record<string, unknown>).every(([entryKey, entryValue]) =>
      isSubset(entryValue, (expected as Record<string, unknown>)[entryKey]),
    )
  }
  return actual === expected
}

export * as OpenAIWebSocketPool from "./ws-pool"
