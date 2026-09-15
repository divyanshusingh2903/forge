import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createEffect, createMemo, createRoot, on, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK, type DirectorySDK } from "./sdk"
import type { Platform } from "./platform"
import { useServerSDK } from "./server-sdk"
import { defaultTitle, titleNumber } from "./terminal-title"
import { Persist, persisted, removePersisted } from "@/utils/persist"
import { ScopedKey, ServerScope, type ServerScope as ServerScopeValue } from "@/utils/server-scope"

export type LocalPTY = {
  id: string
  title: string
  titleNumber: number
  rows?: number
  cols?: number
  buffer?: string
  scrollY?: number
  cursor?: number
}

const MAX_TERMINAL_SESSIONS = 60

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function numberFromTitle(title: string) {
  return titleNumber(title, MAX_TERMINAL_SESSIONS)
}

function pty(value: unknown): LocalPTY | undefined {
  if (!record(value)) return

  const id = text(value.id)
  if (!id) return

  const title = text(value.title) ?? ""
  const number = num(value.titleNumber)
  const rows = num(value.rows)
  const cols = num(value.cols)
  const buffer = text(value.buffer)
  const scrollY = num(value.scrollY)
  const cursor = num(value.cursor)

  return {
    id,
    title,
    titleNumber: number && number > 0 ? number : (numberFromTitle(title) ?? 0),
    ...(rows !== undefined ? { rows } : {}),
    ...(cols !== undefined ? { cols } : {}),
    ...(buffer !== undefined ? { buffer } : {}),
    ...(scrollY !== undefined ? { scrollY } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  }
}

export function migrateTerminalState(value: unknown) {
  if (!record(value)) return value

  const seen = new Set<string>()
  const all = (Array.isArray(value.all) ? value.all : []).flatMap((item) => {
    const next = pty(item)
    if (!next || seen.has(next.id)) return []
    seen.add(next.id)
    return [next]
  })

  const active = text(value.active)

  return {
    active: active && seen.has(active) ? active : all[0]?.id,
    all,
  }
}

export function getSessionTerminalCacheKey(
  dir: string,
  sessionID: string,
  scope: ServerScopeValue = ServerScope.local,
) {
  return ScopedKey.from(scope, dir, sessionID)
}

export function getLegacyTerminalStorageKeys(dir: string, legacySessionID?: string) {
  if (!legacySessionID) return [`${dir}/terminal.v1`]
  return [`${dir}/terminal/${legacySessionID}.v1`, `${dir}/terminal.v1`]
}

type TerminalSession = ReturnType<typeof createSessionTerminalSession>

type TerminalCacheEntry = {
  value: TerminalSession
  dispose: VoidFunction
}

const caches = new Set<Map<string, TerminalCacheEntry>>()

const trimTerminal = (pty: LocalPTY) => {
  if (!pty.buffer && pty.cursor === undefined && pty.scrollY === undefined) return pty
  return {
    ...pty,
    buffer: undefined,
    cursor: undefined,
    scrollY: undefined,
  }
}

function terminalPersistTarget(scope: ServerScopeValue, dir: string, sessionID: string, legacy?: string[]) {
  return Persist.serverSession(scope, dir, sessionID, "terminal", legacy)
}

// Only the pieces needed for a best-effort pty.remove -- deliberately not the
// full DirectorySDK, since a caller's sdk may be bound to a different
// directory than the one being cleaned up (location is always built from
// input.dir below, never from the sdk).
type PtyRemovalSDK = Pick<DirectorySDK, "protocol" | "client" | "api">

// Clears a single session's cached + persisted terminals. Best-effort backend
// pty.remove when an sdk is available; always safe to call more than once for
// the same session (empty cache/already-removed keys/404 pty.remove are all
// no-ops) since archive/delete and the backend-pushed session.deleted event
// can both race to call this for the same session.
export async function destroySessionTerminals(input: {
  dir: string
  sessionID: string
  scope?: ServerScopeValue
  platform?: Platform
  sdk?: PtyRemovalSDK
}) {
  const scope = input.scope ?? ServerScope.local
  const key = getSessionTerminalCacheKey(input.dir, input.sessionID, scope)

  const ptyIDs = new Set<string>()
  for (const cache of caches) {
    const entry = cache.get(key)
    if (!entry) continue
    for (const pty of entry.value.all()) ptyIDs.add(pty.id)
    entry.value.clear()
    entry.dispose()
    cache.delete(key)
  }

  void removePersisted(terminalPersistTarget(scope, input.dir, input.sessionID), input.platform)
  if (scope === ServerScope.local) {
    for (const legacyKey of getLegacyTerminalStorageKeys(input.dir, input.sessionID)) {
      void removePersisted({ key: legacyKey }, input.platform)
    }
  }

  if (!input.sdk || ptyIDs.size === 0) return

  // Use input.dir, not input.sdk.directory: a caller may pass an sdk bound to
  // a different directory than the one being cleaned up (e.g. the home page
  // archiving a session in a project that isn't the currently focused one).
  const location = { directory: input.dir }
  await Promise.all(
    Array.from(ptyIDs, async (ptyID) => {
      const removePromise =
        (await input.sdk!.protocol) === "v1"
          ? input.sdk!.client.pty.remove({ ptyID })
          : input.sdk!.api.pty.remove({ ptyID, location })
      await removePromise.catch(() => {
        // Already gone (this client's own delete, or another client's) -- fine.
      })
    }),
  ).catch(() => {})
}

// Compatibility shim for callers that only have a directory (e.g. resetting a
// whole workspace on drop/rename): clears every cached/persisted terminal
// entry for that directory, one session at a time. No backend pty.remove --
// callers of this path historically didn't do one either.
export function clearWorkspaceTerminals(
  dir: string,
  sessionIDs?: string[],
  platform?: Platform,
  scope: ServerScopeValue = ServerScope.local,
) {
  for (const id of sessionIDs ?? []) {
    const key = getSessionTerminalCacheKey(dir, id, scope)
    for (const cache of caches) {
      const entry = cache.get(key)
      entry?.value.clear()
    }
    void removePersisted(terminalPersistTarget(scope, dir, id), platform)
  }

  if (scope !== ServerScope.local) return
  const legacy = new Set(getLegacyTerminalStorageKeys(dir))
  for (const id of sessionIDs ?? []) {
    for (const key of getLegacyTerminalStorageKeys(dir, id)) {
      legacy.add(key)
    }
  }
  for (const key of legacy) {
    void removePersisted({ key }, platform)
  }
}

function createSessionTerminalSession(
  sdk: DirectorySDK,
  dir: string,
  sessionID: string,
  scope: ServerScopeValue,
  legacy: string[],
) {
  const location = { directory: sdk.directory }

  const [store, setStore, _, ready] = persisted(
    {
      ...terminalPersistTarget(scope, dir, sessionID, legacy),
      migrate: migrateTerminalState,
    },
    createStore<{
      active?: string
      all: LocalPTY[]
    }>({
      all: [],
    }),
  )

  const [ui, setUi] = createStore({
    focus: undefined as { request: number; id?: string; pending: boolean } | undefined,
  })
  const focus = { request: 0 }

  const requestFocus = (id?: string, pending = false) => {
    focus.request += 1
    setUi("focus", { request: focus.request, id, pending })
    return focus.request
  }

  const focusRequested = (id?: string) => {
    if (!id) return false
    if (!ui.focus || ui.focus.pending) return false
    const result = !ui.focus.id || ui.focus.id === id
    return result
  }

  const consumeFocus = (id: string) => {
    if (!focusRequested(id)) return
    setUi("focus", undefined)
  }

  const cancelFocus = (request?: number) => {
    if (request !== undefined && ui.focus?.request !== request) return
    setUi("focus", undefined)
  }

  if (typeof document !== "undefined") {
    const cancelOnOutsideFocus = (event: FocusEvent) => {
      if (!ui.focus) return
      if (!(event.target instanceof Element)) return
      if (event.target.closest("#terminal-panel")) return
      cancelFocus()
    }
    document.addEventListener("focusin", cancelOnOutsideFocus)
    onCleanup(() => document.removeEventListener("focusin", cancelOnOutsideFocus))
  }

  const pickNextTerminalNumber = () => {
    const existingTitleNumbers = new Set(
      store.all.flatMap((pty) => {
        const direct = Number.isFinite(pty.titleNumber) && pty.titleNumber > 0 ? pty.titleNumber : undefined
        if (direct !== undefined) return [direct]
        const parsed = numberFromTitle(pty.title)
        if (parsed === undefined) return []
        return [parsed]
      }),
    )

    return (
      Array.from({ length: existingTitleNumbers.size + 1 }, (_, index) => index + 1).find(
        (number) => !existingTitleNumbers.has(number),
      ) ?? 1
    )
  }

  const removeExited = (id: string) => {
    const all = store.all
    const index = all.findIndex((x) => x.id === id)
    if (index === -1) return
    const active = store.active === id ? (index === 0 ? all[1]?.id : all[0]?.id) : store.active
    batch(() => {
      setStore("active", active)
      setStore(
        "all",
        produce((draft) => {
          draft.splice(index, 1)
        }),
      )
    })
  }

  const unsub = sdk.event.on("pty.exited", (event: { properties: { id: string } }) => {
    removeExited(event.properties.id)
  })
  onCleanup(unsub)

  const update = (pty: Partial<LocalPTY> & { id: string }) => {
    const index = store.all.findIndex((x) => x.id === pty.id)
    const previous = index >= 0 ? store.all[index] : undefined
    if (index >= 0) {
      setStore("all", index, (item) => ({ ...item, ...pty }))
    }
    const doUpdate = async () => {
      if ((await sdk.protocol) === "v1") {
        await sdk.client.pty.update({
          ptyID: pty.id,
          title: pty.title,
          size: pty.cols && pty.rows ? { rows: pty.rows, cols: pty.cols } : undefined,
        })
      } else {
        await sdk.api.pty.update({
          ptyID: pty.id,
          location,
          title: pty.title,
          size: pty.cols && pty.rows ? { rows: pty.rows, cols: pty.cols } : undefined,
        })
      }
    }
    doUpdate().catch((error: unknown) => {
      if (previous) {
        const currentIndex = store.all.findIndex((item) => item.id === pty.id)
        if (currentIndex >= 0) setStore("all", currentIndex, previous)
      }
      console.error("Failed to update terminal", error)
    })
  }

  const clone = async (id: string) => {
    const index = store.all.findIndex((x) => x.id === id)
    const pty = store.all[index]
    if (!pty) return
    const data = await (async () => {
      if ((await sdk.protocol) === "v1") {
        return (await sdk.client.pty.create({ title: pty.title })).data
      }
      return (
        await sdk.api.pty.create({
          location,
          title: pty.title,
        })
      ).data
    })().catch((error: unknown) => {
      console.error("Failed to clone terminal", error)
      return undefined
    })
    if (!data?.id) return

    const active = store.active === pty.id

    batch(() => {
      setStore("all", index, {
        id: data.id,
        title: data.title ?? pty.title,
        titleNumber: pty.titleNumber,
        buffer: undefined,
        cursor: undefined,
        scrollY: undefined,
        rows: undefined,
        cols: undefined,
      })
      if (active) {
        setStore("active", data.id)
      }
    })
  }

  return {
    ready,
    all: createMemo(() => store.all),
    active: createMemo(() => store.active),
    clear() {
      batch(() => {
        setStore("active", undefined)
        setStore("all", [])
      })
    },
    new(options?: { focus?: boolean }) {
      const nextNumber = pickNextTerminalNumber()
      const focusRequest = options?.focus ? requestFocus(undefined, true) : undefined

      const doCreate = async () => {
        if ((await sdk.protocol) === "v1") {
          return (await sdk.client.pty.create({ title: defaultTitle(nextNumber) })).data
        }
        return (await sdk.api.pty.create({ location, title: defaultTitle(nextNumber) })).data
      }
      doCreate()
        .then((data) => {
          const id = data?.id
          if (!id) {
            if (focusRequest !== undefined) cancelFocus(focusRequest)
            return
          }
          const newTerminal = {
            id,
            title: data?.title ?? defaultTitle(nextNumber),
            titleNumber: nextNumber,
          }
          batch(() => {
            setStore("all", store.all.length, newTerminal)
            setStore("active", id)
            if (focusRequest !== undefined && ui.focus?.request === focusRequest) {
              setUi("focus", { request: focusRequest, id, pending: false })
            }
          })
        })
        .catch((error: unknown) => {
          if (focusRequest !== undefined) cancelFocus(focusRequest)
          console.error("Failed to create terminal", error)
        })
    },
    update(pty: Partial<LocalPTY> & { id: string }) {
      update(pty)
    },
    trim(id: string) {
      const index = store.all.findIndex((x) => x.id === id)
      if (index === -1) return
      setStore("all", index, (pty) => trimTerminal(pty))
    },
    trimAll() {
      setStore("all", (all) => {
        const next = all.map(trimTerminal)
        if (next.every((pty, index) => pty === all[index])) return all
        return next
      })
    },
    async clone(id: string) {
      await clone(id)
    },
    bind() {
      return {
        trim(id: string) {
          const index = store.all.findIndex((x) => x.id === id)
          if (index === -1) return
          setStore("all", index, (pty) => trimTerminal(pty))
        },
        update(pty: Partial<LocalPTY> & { id: string }) {
          update(pty)
        },
        async clone(id: string) {
          await clone(id)
        },
      }
    },
    open(id: string) {
      setStore("active", id)
    },
    requestFocus(id?: string) {
      requestFocus(id)
    },
    focusRequested(id?: string) {
      return focusRequested(id)
    },
    consumeFocus(id: string) {
      consumeFocus(id)
    },
    cancelFocus() {
      cancelFocus()
    },
    next() {
      const index = store.all.findIndex((x) => x.id === store.active)
      if (index === -1) return
      const nextIndex = (index + 1) % store.all.length
      setStore("active", store.all[nextIndex]?.id)
    },
    previous() {
      const index = store.all.findIndex((x) => x.id === store.active)
      if (index === -1) return
      const prevIndex = index === 0 ? store.all.length - 1 : index - 1
      setStore("active", store.all[prevIndex]?.id)
    },
    async close(id: string) {
      const index = store.all.findIndex((f) => f.id === id)
      if (index !== -1) {
        batch(() => {
          if (store.active === id) {
            const next = index > 0 ? store.all[index - 1]?.id : store.all[1]?.id
            setStore("active", next)
          }
          setStore(
            "all",
            produce((all) => {
              all.splice(index, 1)
            }),
          )
        })
      }

      const removePromise =
        (await sdk.protocol) === "v1"
          ? sdk.client.pty.remove({ ptyID: id })
          : sdk.api.pty.remove({ ptyID: id, location })
      await removePromise.catch((error: unknown) => {
        console.error("Failed to close terminal", error)
      })
    },
    move(id: string, to: number) {
      const index = store.all.findIndex((f) => f.id === id)
      if (index === -1) return
      setStore(
        "all",
        produce((all) => {
          all.splice(to, 0, all.splice(index, 1)[0])
        }),
      )
    },
  }
}

// Sentinel session id for terminals opened before a session exists yet (a
// draft/new-session route with no params.id). Ordinary cache/persist key,
// just scoped to "no session" instead of a real session id.
export const NO_SESSION_ID = "__nosession__"

export const { use: useTerminal, provider: TerminalProvider } = createSimpleContext({
  name: "Terminal",
  gate: false,
  init: () => {
    const sdk = useSDK()
    const serverSDK = useServerSDK()
    const params = useParams()
    const cache = new Map<string, TerminalCacheEntry>()
    const scope = () => serverSDK().scope
    const directory = createMemo(() => sdk().directory)
    const sessionID = createMemo(() => params.id ?? NO_SESSION_ID)

    caches.add(cache)
    onCleanup(() => caches.delete(cache))

    const disposeAll = () => {
      for (const entry of cache.values()) {
        entry.dispose()
      }
      cache.clear()
    }

    onCleanup(disposeAll)

    const prune = (activeKey: string) => {
      if (cache.size <= MAX_TERMINAL_SESSIONS) return
      for (const key of cache.keys()) {
        if (cache.size <= MAX_TERMINAL_SESSIONS) return
        if (key === activeKey) continue
        const entry = cache.get(key)
        entry?.dispose()
        cache.delete(key)
      }
    }

    const loadSession = (dir: string, id: string, serverScope: ServerScopeValue) => {
      const key = getSessionTerminalCacheKey(dir, id, serverScope)
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      const entry = createRoot((dispose) => ({
        value: createSessionTerminalSession(sdk(), dir, id, serverScope, getLegacyTerminalStorageKeys(dir, id)),
        dispose,
      }))

      cache.set(key, entry)
      prune(key)
      return entry.value
    }

    const session = createMemo(() => loadSession(directory(), sessionID(), scope()))

    createEffect(
      on(
        () => ({ dir: directory(), id: sessionID(), scope: scope() }),
        (next, prev) => {
          if (!prev?.dir) return
          if (next.dir === prev.dir && next.id === prev.id && next.scope === prev.scope) return
          loadSession(prev.dir, prev.id, prev.scope).trimAll()
        },
        { defer: true },
      ),
    )

    return {
      ready: () => session().ready(),
      all: () => session().all(),
      active: () => session().active(),
      new: (options?: { focus?: boolean }) => session().new(options),
      update: (pty: Partial<LocalPTY> & { id: string }) => session().update(pty),
      trim: (id: string) => session().trim(id),
      trimAll: () => session().trimAll(),
      clone: (id: string) => session().clone(id),
      bind: () => session(),
      open: (id: string) => session().open(id),
      requestFocus: (id?: string) => session().requestFocus(id),
      focusRequested: (id?: string) => session().focusRequested(id),
      consumeFocus: (id: string) => session().consumeFocus(id),
      cancelFocus: () => session().cancelFocus(),
      close: (id: string) => session().close(id),
      move: (id: string, to: number) => session().move(id, to),
      next: () => session().next(),
      previous: () => session().previous(),
    }
  },
})
