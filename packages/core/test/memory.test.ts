import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Memory } from "@opencode-ai/core/memory"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(Memory.node))

const scopedTmp = Effect.acquireRelease(
  Effect.promise(() => tmpdir()),
  (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
)

async function initRepo(dir: string) {
  await $`git init`.cwd(dir).quiet()
  await $`git config core.fsmonitor false`.cwd(dir).quiet()
  await $`git config commit.gpgsign false`.cwd(dir).quiet()
  await $`git config user.email test@opencode.test`.cwd(dir).quiet()
  await $`git config user.name Test`.cwd(dir).quiet()
  await $`git commit --allow-empty -m root`.cwd(dir).quiet()
}

describe("Memory.directory", () => {
  it.live("shares one directory across subdirectories and linked worktrees", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmp
      const repo = path.join(tmp.path, "repo")
      const linked = path.join(tmp.path, "linked")
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(repo, "nested", "deeper"), { recursive: true })
        await initRepo(repo)
        await $`git worktree add --detach ${linked} HEAD`.cwd(repo).quiet()
      })
      const memory = yield* Memory.Service

      const root = yield* memory.directory(AbsolutePath.make(repo))

      expect(yield* memory.directory(AbsolutePath.make(path.join(repo, "nested", "deeper")))).toBe(root)
      expect(yield* memory.directory(AbsolutePath.make(linked))).toBe(root)
      expect(path.basename(root)).toMatch(/-repo-[0-9a-f]{6}$/)
    }),
  )

  it.live("isolates independent clones and non-Git folders", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmp
      const first = path.join(tmp.path, "first")
      const second = path.join(tmp.path, "second")
      const plainA = path.join(tmp.path, "plain-a")
      const plainB = path.join(tmp.path, "plain-b")
      yield* Effect.promise(async () => {
        await Promise.all([first, plainA, plainB].map((dir) => fs.mkdir(dir, { recursive: true })))
        await initRepo(first)
        await $`git clone --quiet ${first} ${second}`.quiet()
      })
      const memory = yield* Memory.Service

      const dirs = yield* Effect.all([first, second, plainA, plainB].map((dir) => memory.directory(AbsolutePath.make(dir))))

      expect(new Set(dirs).size).toBe(4)
    }),
  )
})

describe("Memory.index", () => {
  it.live("reports a missing index without creating it", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmp
      const memory = yield* Memory.Service

      expect(yield* memory.index(AbsolutePath.make(path.join(tmp.path, "nope")))).toEqual({ status: "missing" })
      expect(yield* Effect.promise(() => fs.readdir(tmp.path))).toEqual([])
    }),
  )

  it.live("reports an unreadable index", () =>
    Effect.gen(function* () {
      if (process.platform === "win32" || process.getuid?.() === 0) return
      const tmp = yield* scopedTmp
      const file = path.join(tmp.path, Memory.INDEX_FILE)
      yield* Effect.promise(async () => {
        await fs.writeFile(file, "- secret\n")
        await fs.chmod(file, 0o000)
      })
      const memory = yield* Memory.Service

      expect(yield* memory.index(AbsolutePath.make(tmp.path))).toEqual({ status: "unreadable" })
      yield* Effect.promise(() => fs.chmod(file, 0o600))
    }),
  )

  it.live("truncates by lines without modifying the file", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmp
      const file = path.join(tmp.path, Memory.INDEX_FILE)
      const content = Array.from({ length: Memory.MAX_LINES + 1 }, (_, i) => `- note ${i}`).join("\n") + "\n"
      yield* Effect.promise(() => fs.writeFile(file, content))
      const memory = yield* Memory.Service

      const result = yield* memory.index(AbsolutePath.make(tmp.path))

      expect(result.status).toBe("ok")
      if (result.status !== "ok") return
      expect(result.truncated).toBe(true)
      expect(result.text.split("\n")).toHaveLength(Memory.MAX_LINES)
      expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe(content)
    }),
  )
})

describe("Memory.bound", () => {
  test("keeps an index at exactly the line limit", () => {
    const text = Array.from({ length: Memory.MAX_LINES }, (_, i) => `- ${i}`).join("\n")
    expect(Memory.bound(text + "\n")).toEqual({ text, truncated: false })
  })

  test("drops the partial line when over the byte limit", () => {
    const line = "x".repeat(1000)
    const result = Memory.bound(Array.from({ length: 20 }, () => line).join("\n"))
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(Memory.MAX_BYTES)
    expect(result.text.split("\n").every((item) => item === line)).toBe(true)
  })

  test("never splits a multibyte character in a single oversized line", () => {
    const result = Memory.bound("é😀".repeat(5000))
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(Memory.MAX_BYTES)
    expect(result.text).not.toContain("�")
    expect(Buffer.from(result.text).toString("utf8")).toBe(result.text)
    expect(/[\uD800-\uDBFF]$/.test(result.text)).toBe(false)
  })
})
