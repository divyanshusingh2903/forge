import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import type { ServerConnection } from "@/context/server"

type HomeSession = {
  id: string
  directory: string
}

export async function archiveHomeSession(input: {
  server: ServerConnection.Key
  session: HomeSession
  archive: (sessionID: string) => Promise<unknown>
  remove: () => void
  // Runs before the notify below on purpose: notify synchronously fires
  // tabs.removeSessions via a window event, which also clears this session's
  // terminal cache/persist entry but without a live sdk (no pty.remove) --
  // whichever clears the cache first wins, so the real cleanup goes first.
  destroy?: () => unknown
  onError?: (error: unknown) => void
}) {
  await input
    .archive(input.session.id)
    .then(() => {
      input.remove()
      input.destroy?.()
      notifySessionTabsRemoved({
        server: input.server,
        directory: input.session.directory,
        sessionIDs: [input.session.id],
      })
    })
    .catch((error) => input.onError?.(error))
}
