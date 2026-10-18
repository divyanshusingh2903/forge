import { describe, expect, test } from "bun:test"
import type { VcsInfo } from "@opencode-ai/sdk/v2/client"
import { createStore } from "solid-js/store"
import { createVcsSync } from "./vcs"

function setup(read: (directory: string) => Promise<VcsInfo | undefined>) {
  const [store, set] = createStore({ vcs: { branch: "old", default_branch: "main" } as VcsInfo })
  const [cache, persist] = createStore({ value: store.vcs })
  const targets = new Map<string, { identity: object; apply: (info: VcsInfo) => void }>([
    [
      "/repo",
      {
        identity: store,
        apply: (info) => {
          set("vcs", info)
          persist("value", info)
        },
      },
    ],
  ])
  const sync = createVcsSync({
    read,
    target: (directory) => targets.get(directory),
    missingResponseMessage: "VCS metadata response is missing",
  })
  return { store, cache, targets, sync }
}

describe("directory VCS metadata", () => {
  test("refreshes shared state and cache, clearing absent branch and default branch", async () => {
    const state = setup(async () => ({}))
    await state.sync.refresh("/repo")
    expect(state.store.vcs).toEqual({ branch: undefined, default_branch: undefined })
    expect(state.cache.value).toEqual(state.store.vcs)
  })

  test("preserves metadata on failed or missing responses and recovers on another event", async () => {
    const responses = [
      () => Promise.reject(new Error("offline")),
      () => Promise.resolve(undefined),
      () => Promise.resolve({ branch: "new" }),
    ]
    const state = setup(() => responses.shift()!())
    await expect(state.sync.refresh("/repo")).rejects.toThrow("offline")
    await expect(state.sync.refresh("/repo")).rejects.toThrow("response is missing")
    expect(state.store.vcs.branch).toBe("old")
    expect(state.cache.value.branch).toBe("old")
    await state.sync.refresh("/repo")
    expect(state.store.vcs.branch).toBe("new")
    expect(state.cache.value.default_branch).toBeUndefined()
  })

  test("rejects stale reads and coalesces a burst into one awaited successor", async () => {
    const first = Promise.withResolvers<VcsInfo>()
    const started = Promise.withResolvers<void>()
    const second = Promise.withResolvers<VcsInfo>()
    const trailing = Promise.withResolvers<void>()
    const calls: string[] = []
    const state = setup((directory) => {
      calls.push(directory)
      if (calls.length === 1) {
        started.resolve()
        return first.promise
      }
      trailing.resolve()
      return second.promise
    })
    const initial = state.sync.refresh("/repo")
    await started.promise
    const events = Array.from({ length: 10 }, () => state.sync.refresh("/repo"))
    first.resolve({ branch: "stale" })
    await trailing.promise
    expect(state.store.vcs.branch).toBe("old")
    second.resolve({ branch: "current", default_branch: "trunk" })
    await Promise.all([initial, ...events])
    expect(calls).toEqual(["/repo", "/repo"])
    expect(state.store.vcs.branch).toBe("current")
    expect(state.cache.value.default_branch).toBe("trunk")
  })

  test("a failed pending read still allows its queued successor to apply", async () => {
    const first = Promise.withResolvers<VcsInfo>()
    const started = Promise.withResolvers<void>()
    const calls: string[] = []
    const state = setup((directory) => {
      calls.push(directory)
      if (calls.length > 1) return Promise.resolve({ branch: "recovered" })
      started.resolve()
      return first.promise
    })
    const initial = state.sync.refresh("/repo")
    await started.promise
    const event = state.sync.refresh("/repo")
    first.reject(new Error("offline"))
    await Promise.allSettled([initial, event])
    expect(state.store.vcs.branch).toBe("recovered")
  })

  test("ignores unknown directories without reading", async () => {
    const calls: string[] = []
    const state = setup(async (directory) => {
      calls.push(directory)
      return {}
    })
    await state.sync.refresh("/unknown")
    expect(calls).toEqual([])
  })

  test("disposed and recreated directories reject responses from old lifetimes", async () => {
    const response = Promise.withResolvers<VcsInfo>()
    const started = Promise.withResolvers<void>()
    const state = setup(() => {
      started.resolve()
      return response.promise
    })
    const pending = state.sync.refresh("/repo")
    await started.promise
    state.sync.clear("/repo")
    const applied: VcsInfo[] = []
    state.targets.set("/repo", {
      identity: {},
      apply: (info) => { applied.push(info) },
    })
    response.resolve({ branch: "stale" })
    await pending
    expect(applied).toEqual([])
    expect(state.store.vcs.branch).toBe("old")
    await state.sync.refresh("/repo")
    expect(applied).toEqual([{ branch: "stale", default_branch: undefined }])
  })

  test("server disposal invalidates pending metadata", async () => {
    const response = Promise.withResolvers<VcsInfo>()
    const state = setup(() => response.promise)
    const pending = state.sync.refresh("/repo")
    state.sync.dispose()
    response.resolve({ branch: "stale" })
    await pending
    await state.sync.refresh("/repo")
    expect(state.store.vcs.branch).toBe("old")
  })

  test("different directories and server contexts cannot overwrite each other", async () => {
    const one = setup(async (directory) => ({ branch: directory }))
    const two = setup(async () => ({ branch: "other-server" }))
    const applied: VcsInfo[] = []
    one.targets.set("/other", {
      identity: {},
      apply: (info) => { applied.push(info) },
    })
    await Promise.all([one.sync.refresh("/repo"), one.sync.refresh("/other"), two.sync.refresh("/repo")])
    expect(one.store.vcs.branch).toBe("/repo")
    expect(two.store.vcs.branch).toBe("other-server")
    expect(applied[0]?.branch).toBe("/other")
  })
})
