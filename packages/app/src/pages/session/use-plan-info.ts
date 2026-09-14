import { createEffect, createMemo, createResource } from "solid-js"
import type { Part, QuestionRequest } from "@opencode-ai/sdk/v2"
import { useFile } from "@/context/file"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { sessionQuestionRequest } from "@/pages/session/composer/session-request-tree"

export function usePlanInfo(sessionId: () => string | undefined) {
  const sdk = useSDK()
  const sync = useSync()
  const file = useFile()

  const pendingTool = createMemo(() => {
    const id = sessionId()
    if (!id) return undefined
    const messages = sync().data.message[id] ?? []
    for (const message of messages) {
      const parts = (sync().data.part[message.id] ?? []) as Part[]
      for (const part of parts) {
        if (part.type === "tool" && part.tool === "present_plan" && part.state.status === "running")
          return { messageID: message.id, callID: part.callID }
      }
    }
    return undefined
  })

  const pending = createMemo(() => !!pendingTool())

  const planKey = createMemo(() => {
    const id = sessionId()
    if (!id) return undefined
    const count = sync().data.message[id]?.length ?? 0
    // present_plan is only ever called after the plan file has already been written
    // (same assistant message, no new message in between), so message count alone
    // doesn't change when the file first appears -- fold in the pending tool's
    // callID so the resource refetches the instant the decision dock shows up,
    // instead of waiting for the next message (which only arrives once the user
    // has already answered).
    const tool = pendingTool()
    return `${id}:${count}:${tool?.callID ?? ""}`
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

  // The present_plan question awaiting a decision, if any -- lets callers (e.g. a
  // plan-tab comment) answer "Revise" on the user's behalf instead of requiring a
  // separate click on the question dock.
  const pendingRequest = createMemo<QuestionRequest | undefined>(() => {
    const id = sessionId()
    const tool = pendingTool()
    if (!id || !tool) return undefined
    return sessionQuestionRequest(
      sync().data.session,
      sync().data.question,
      id,
      (request) => request.tool?.callID === tool.callID && request.tool?.messageID === tool.messageID,
    )
  })

  return {
    // planKey changes on every new message, so this resource refetches constantly
    // during normal chat activity. Reading it as `.latest` (rather than calling it
    // directly) keeps those refetches from re-tripping the app's top-level Suspense
    // boundary -- which has no fallback, so every refetch would otherwise blank the
    // whole session view for a frame.
    exists: createMemo(() => {
      const key = planKey()
      if (!key || !key.startsWith(`${sessionId()}:`)) return false
      return planInfo.latest?.exists ?? false
    }),
    path: createMemo(() => {
      const key = planKey()
      if (!key || !key.startsWith(`${sessionId()}:`)) return undefined
      return planInfo.latest?.path
    }),
    pending,
    pendingRequest,
  }
}
