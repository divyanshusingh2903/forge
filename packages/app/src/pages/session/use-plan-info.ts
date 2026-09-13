import { createMemo, createResource } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

export function usePlanInfo(sessionId: () => string | undefined) {
  const sdk = useSDK()
  const sync = useSync()

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

  return {
    exists: createMemo(() => planInfo()?.exists ?? false),
    path: createMemo(() => planInfo()?.path),
  }
}
