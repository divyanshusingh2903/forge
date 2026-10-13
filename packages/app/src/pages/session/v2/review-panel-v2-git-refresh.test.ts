import { expect, test } from "bun:test"
import { createGitRefresh } from "./review-panel-v2-git-refresh"

function gate() {
  const state = { resolve: () => {} }
  const promise = new Promise<void>((resolve) => {
    state.resolve = resolve
  })
  return { promise, resolve: () => state.resolve() }
}

test("coalesces in-flight invalidations, rejects stale data, and awaits the trailing read", async () => {
  const first = gate()
  const started = gate()
  const second = gate()
  const values: number[] = []
  let reads = 0
  const refresh = createGitRefresh(async (accept) => {
    const value = ++reads
    if (value === 1) {
      started.resolve()
      await first.promise
    }
    if (value === 2) await second.promise
    if (accept()) values.push(value)
  })
  const pending = refresh.load()
  await started.promise
  const again = refresh.load()
  expect(refresh.load()).toBe(pending)
  first.resolve()
  second.resolve()
  await again
  expect(reads).toBe(2)
  expect(values).toEqual([2])
})

test("old scope completions cannot overwrite the new scope or clear its pending read", async () => {
  const old = gate()
  const started = gate()
  const values: number[] = []
  let reads = 0
  const refresh = createGitRefresh(async (accept) => {
    const value = ++reads
    if (value === 1) {
      started.resolve()
      await old.promise
    }
    if (accept()) values.push(value)
  })
  const pending = refresh.load()
  await started.promise
  refresh.reset()
  await refresh.load()
  old.resolve()
  await pending
  expect(values).toEqual([2])
})

test("failed reads release the loader for a subsequent refresh", async () => {
  let reads = 0
  const refresh = createGitRefresh(async () => {
    if (++reads === 1) throw new Error("Read failed")
  })
  await expect(refresh.load()).rejects.toThrow("Read failed")
  await refresh.load()
  expect(reads).toBe(2)
})
