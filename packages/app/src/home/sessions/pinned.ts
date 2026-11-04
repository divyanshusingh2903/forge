import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"

const PinnedSessionsSchema = Persistence.struct({ entries: Schema.Array(Schema.String) })

const key = (server: string, id: string) => `${server}\0${id}`

// Pins follow the person, not a window or project, so they use the global store.
export function createPinnedSessions() {
  const [store, setStore] = persisted(Persist.global("pinned-sessions"), PinnedSessionsSchema, { entries: [] })

  return {
    isPinned: (server: string, id: string) => store.entries.includes(key(server, id)),
    toggle: (server: string, id: string) => {
      const target = key(server, id)
      setStore("entries", (entries) =>
        entries.includes(target) ? entries.filter((entry) => entry !== target) : [...entries, target],
      )
    },
    entries: () =>
      store.entries.map((entry) => {
        const [server, id] = entry.split("\0")

        return { server: server!, id: id! }
      }),
  }
}

export type PinnedSessions = ReturnType<typeof createPinnedSessions>
