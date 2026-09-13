import { createEffect, createMemo, createResource } from "solid-js"
import type { Part } from "@opencode-ai/sdk/v2"
import { useFile } from "@/context/file"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

export function usePlanInfo(sessionId: () => string | undefined) {
  const sdk = useSDK()
  const sync = useSync()
  const file = useFile()

  const planKey = createMemo(() => {
    const id = sessionId()
    if (!id) return undefined
    const count = sync().data.message[id]?.length ?? 0
    return `${id}:${count}`
  })

  const [planInfo] = createResource(planKey, async (key) => {
    const id = key.split(":")[0]
    if (!id) return undefined
    return sdk()
      .client.session.plan({ sessionID: id })
      .then((result) => result.data)
      .catch(() => undefined)
  })

  // The file watcher's invalidation isn't reliable enough on its own to keep
  // the Plan tab fresh across edits (e.g. shell-appended writes), so force a
  // reload whenever this resolves again -- planKey already changes on every
  // new message, so this naturally re-checks each time the conversation
  // progresses rather than only once when the path first appears.
  createEffect(() => {
    const info = planInfo()
    if (!info?.exists) return
    void file.load(info.path, { force: true })
  })

  const pending = createMemo(() => {
    const id = sessionId()
    if (!id) return false
    const messages = sync().data.message[id] ?? []
    for (const message of messages) {
      const parts = (sync().data.part[message.id] ?? []) as Part[]
      for (const part of parts) {
        if (part.type === "tool" && part.tool === "present_plan" && part.state.status === "running") return true
      }
    }
    return false
  })

  return {
    exists: createMemo(() => planInfo()?.exists ?? false),
    path: createMemo(() => planInfo()?.path),
    pending,
  }
}
