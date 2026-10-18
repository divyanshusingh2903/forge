import { createEffect, on, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { VcsChangeStatus, VcsRemoteStatus } from "@opencode-ai/sdk/v2"
import type { Vcs } from "@opencode-ai/schema/vcs"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useServerSDK } from "@/context/server-sdk"
import { formatServerError } from "@/utils/server-errors"
import { createGitRefresh } from "./review-panel-v2-git-refresh"

export function createReviewGit(input: { enabled: () => boolean; changed: () => void }) {
  const sdk = useSDK()
  const sync = useSync()
  const serverSDK = useServerSDK()
  const [state, set] = createStore({
    message: "",
    busy: false,
    error: "",
    loadError: "",
    choicesError: "",
    stashError: "",
    changes: [] as VcsChangeStatus[],
    remote: { upstream: false, ahead: 0, behind: 0 } as VcsRemoteStatus,
    get info() {
      return sync().data.vcs ?? {}
    },
    targets: { remotes: [], branches: [] } as Vcs.Targets,
    stashes: [] as readonly Vcs.Stash[],
  })
  let generation = 0
  let choicesRevision = 0
  let stashRevision = 0
  let choicesLoaded = false
  let stashesLoaded = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const loadTargets = async () => {
    choicesLoaded = true
    const run = generation
    const version = ++choicesRevision
    const current = sdk()
    await current.client.instance.vcsTargets({ directory: current.directory }, { throwOnError: true }).then(
      (result) => {
        if (run === generation && version === choicesRevision && result.data)
          set({ targets: result.data, choicesError: "" })
      },
      (error) => {
        if (run === generation && version === choicesRevision) set("choicesError", formatServerError(error))
      },
    )
  }
  const loadStashes = async () => {
    stashesLoaded = true
    const run = generation
    const version = ++stashRevision
    const current = sdk()
    await current.client.instance.vcsStashes({ directory: current.directory }, { throwOnError: true }).then(
      (result) => {
        if (run === generation && version === stashRevision) {
          set("stashes", reconcile(result.data ?? [], { key: "oid" }))
          set("stashError", "")
        }
      },
      (error) => {
        if (run === generation && version === stashRevision) set("stashError", formatServerError(error))
      },
    )
  }
  const refresh = createGitRefresh(async (accept) => {
    const current = sdk()
    const errors: string[] = []
    const receive = <T>(request: Promise<T>, apply: (result: T) => void) =>
      request.then(
        (result) => {
          if (accept()) apply(result)
        },
        (error) => {
          errors.push(formatServerError(error))
        },
      )
    await Promise.all([
      receive(current.client.instance.vcsChanges({ directory: current.directory }, { throwOnError: true }), (result) =>
        set("changes", reconcile(result.data ?? [], { key: "file" })),
      ),
      receive(current.client.instance.vcsRemote({ directory: current.directory }, { throwOnError: true }), (result) => {
        if (result.data) set("remote", reconcile(result.data))
      }),
      receive(sync().vcs.refresh(), () => {}),
      ...(choicesLoaded ? [loadTargets()] : []),
      ...(stashesLoaded ? [loadStashes()] : []),
    ])
    if (accept()) set("loadError", errors.join("\n"))
  })
  const load = () => {
    const scope = generation
    return refresh.load().catch((error) => {
      if (scope === generation) set("loadError", formatServerError(error))
    })
  }
  const request = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!input.enabled()) return
      input.changed()
      void load()
    }, 100)
  }
  const run = async (operation: () => Promise<unknown>, options?: { optimistic?: () => void; refresh?: boolean }) => {
    if (state.busy) return false
    const scope = generation
    set({ busy: true, error: "" })
    refresh.invalidate()
    const success = await Promise.resolve()
      .then(() => {
        options?.optimistic?.()
        return operation()
      })
      .then(
        (result) => {
          if (
            typeof result === "object" &&
            result !== null &&
            "data" in result &&
            typeof result.data === "object" &&
            result.data !== null &&
            "success" in result.data &&
            result.data.success === false
          ) {
            if (scope === generation)
              set(
                "error",
                "output" in result.data && typeof result.data.output === "string"
                  ? result.data.output
                  : formatServerError(result),
              )
            return false
          }
          return true
        },
        (error) => {
          if (scope === generation) set("error", formatServerError(error))
          return false
        },
      )
    if (scope !== generation) return false
    if (options?.refresh !== false) {
      await Promise.resolve()
        .then(input.changed)
        .catch((error) => set("loadError", formatServerError(error)))
      await load()
    }
    if (scope !== generation) return false
    set("busy", false)
    return success
  }
  createEffect(
    on(
      () => [sdk().scope, sdk().directory] as const,
      () => {
        generation++
        clearTimeout(timer)
        refresh.reset()
        choicesLoaded = false
        stashesLoaded = false
        set({
          message: "",
          busy: false,
          error: "",
          loadError: "",
          choicesError: "",
          stashError: "",
          changes: [],
          remote: { upstream: false, ahead: 0, behind: 0 },
          targets: { remotes: [], branches: [] },
          stashes: [],
        })
        const off = sdk().event.on("vcs.changed", request)
        const connected = serverSDK().event.on("global", (event) => {
          if (event.type === "server.connected") request()
        })
        onCleanup(() => {
          generation++
          refresh.reset()
          off()
          connected()
          clearTimeout(timer)
        })
        if (input.enabled()) void load()
      },
    ),
  )
  createEffect(
    on(
      input.enabled,
      (enabled) => {
        if (enabled) void load()
      },
      { defer: true },
    ),
  )
  return { state, set, load, run, loadTargets, loadStashes }
}

export type ReviewGit = ReturnType<typeof createReviewGit>
