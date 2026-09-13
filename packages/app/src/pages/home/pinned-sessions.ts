import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

// Cross-window/global, not scoped to a workspace or session -- pinning a
// session should be visible from any project or window, so this uses
// Persist.global rather than Persist.window (what tabs.tsx uses for
// per-window state).
const key = (server: string, id: string) => `${server}\0${id}`

export function createPinnedSessions() {
  const [store, setStore] = persisted(Persist.global("pinned-sessions"), createStore<{ entries: string[] }>({ entries: [] }))

  return {
    isPinned: (server: string, id: string) => store.entries.includes(key(server, id)),
    toggle: (server: string, id: string) => {
      const target = key(server, id)
      setStore("entries", (entries) =>
        entries.includes(target) ? entries.filter((entry) => entry !== target) : [...entries, target],
      )
    },
    remove: (server: string, id: string) => {
      const target = key(server, id)
      setStore("entries", (entries) => entries.filter((entry) => entry !== target))
    },
    entries: () =>
      store.entries.map((entry) => {
        const [server, id] = entry.split("\0")
        return { server: server!, id: id! }
      }),
  }
}

export type PinnedSessions = ReturnType<typeof createPinnedSessions>
