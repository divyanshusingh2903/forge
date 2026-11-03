import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Document, Info } from "@opencode/schema/config"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { Memory } from "@opencode/core/memory"
import { MemoryInstructions } from "@opencode/core/memory/instructions"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { readInitial, readUpdate } from "./lib/instructions"

const scopedTmp = Effect.acquireRelease(
  Effect.promise(() => tmpdir()),
  (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
)

/** Provides Memory and its instructions for one Location; `store` stands in for the Git common directory. */
const provide = (input: { data: string; directory: string; store?: string; memory?: boolean }) =>
  Effect.provide(
    AppNodeBuilder.build(LayerNode.group([Memory.node, MemoryInstructions.node]), [
      Location.node.replace(
        Layer.succeed(
          Location.Service,
          Location.Service.of(
            location(
              { directory: AbsolutePath.make(input.directory) },
              input.store ? { vcs: { type: "git", store: AbsolutePath.make(input.store) } } : {},
            ),
          ),
        ),
      ),
      Config.node.replace(
        Config.testLayer(
          input.memory === undefined
            ? []
            : [new Document({ type: "document", info: new Info({ memory: input.memory }) })],
        ),
      ),
      Global.node.replace(Global.layerWith({ data: input.data })),
    ]),
  )

const directory = (input: Parameters<typeof provide>[0]) =>
  Effect.gen(function* () {
    return yield* (yield* Memory.Service).directory()
  }).pipe(provide(input))

const instructions = (input: Parameters<typeof provide>[0], subagent = false) =>
  Effect.gen(function* () {
    return yield* (yield* MemoryInstructions.Service).load(subagent)
  }).pipe(provide(input))

describe("Memory.directory", () => {
  it.live("shares one directory across Locations of the same repository", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmp
      const repo = path.join(tmp.path, "repo")
      const linked = path.join(tmp.path, "linked")
      const store = path.join(repo, ".git")
      yield* Effect.promise(() => Promise.all([repo, linked, store].map((dir) => fs.mkdir(dir, { recursive: true }))))

      const root = yield* directory({ data: tmp.path, directory: repo, store })

      expect(yield* directory({ data: tmp.path, directory: linked, store })).toBe(root)
      expect(path.dirname(root!)).toBe(path.join(tmp.path, "memory"))
      expect(path.basename(root!)).toMatch(/-repo-[0-9a-f]{6}$/)
    }),
  )

  it.live("isolates separate repositories and non-Git folders", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmp
      const folders = ["first", "second", "plain-a", "plain-b"].map((name) => path.join(tmp.path, name))
      yield* Effect.promise(() => Promise.all(folders.map((dir) => fs.mkdir(path.join(dir, ".git"), { recursive: true }))))

      const dirs = yield* Effect.all([
        directory({ data: tmp.path, directory: folders[0], store: path.join(folders[0], ".git") }),
        directory({ data: tmp.path, directory: folders[1], store: path.join(folders[1], ".git") }),
        directory({ data: tmp.path, directory: folders[2] }),
        directory({ data: tmp.path, directory: folders[3] }),
      ])

      expect(new Set(dirs).size).toBe(4)
    }),
  )

  it.live("is off when config sets memory: false", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmp

      expect(yield* directory({ data: tmp.path, directory: tmp.path, memory: false })).toBeUndefined()
      expect(yield* directory({ data: tmp.path, directory: tmp.path, memory: true })).toBeDefined()
    }),
  )
})

describe("Memory.index", () => {
  const index = (dir: string) =>
    Effect.gen(function* () {
      return yield* (yield* Memory.Service).index(AbsolutePath.make(dir))
    })

  it.live("reports a missing index without creating it", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmp

      expect(yield* index(path.join(tmp.path, "nope")).pipe(provide({ data: tmp.path, directory: tmp.path }))).toEqual({
        status: "missing",
      })
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

      expect(yield* index(tmp.path).pipe(provide({ data: tmp.path, directory: tmp.path }))).toEqual({
        status: "unreadable",
      })
      yield* Effect.promise(() => fs.chmod(file, 0o600))
    }),
  )

  it.live("truncates by lines without modifying the file", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmp
      const file = path.join(tmp.path, Memory.INDEX_FILE)
      const content = Array.from({ length: Memory.MAX_LINES + 1 }, (_, i) => `- note ${i}`).join("\n") + "\n"
      yield* Effect.promise(() => fs.writeFile(file, content))

      const result = yield* index(tmp.path).pipe(provide({ data: tmp.path, directory: tmp.path }))

      expect(result.status).toBe("ok")
      if (result.status !== "ok") return
      expect(result.truncated).toBe(true)
      expect(result.text.split("\n")).toHaveLength(Memory.MAX_LINES)
      expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe(content)
    }),
  )
})

describe("MemoryInstructions", () => {
  it.live("loads the guidance and index, then only the changed index", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmp
      const input = { data: tmp.path, directory: tmp.path }
      const notes = (yield* directory(input))!

      const initial = yield* readInitial(yield* instructions(input))

      expect(initial.text).toContain(`You have a persistent, file-based memory for this repository at \`${notes}\``)
      expect(initial.text).toContain("(empty: MEMORY.md does not exist yet)")

      yield* Effect.promise(async () => {
        await fs.mkdir(notes, { recursive: true })
        await fs.writeFile(path.join(notes, Memory.INDEX_FILE), "- [Tabs](tabs.md) — prefers tabs\n")
      })
      const updated = yield* readUpdate(yield* instructions(input), initial)

      expect(updated.text).toBe(
        [
          "MEMORY.md has changed. This index supersedes the previous memory index:",
          "<memory_index>",
          "- [Tabs](tabs.md) — prefers tabs",
          "</memory_index>",
        ].join("\n"),
      )
    }),
  )

  it.live("gives subagents read-only guidance", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmp

      const initial = yield* readInitial(yield* instructions({ data: tmp.path, directory: tmp.path }, true))

      expect(initial.text).toContain("Memory is read-only for you as a subagent")
      expect(initial.text).not.toContain("## What to save")
    }),
  )

  it.live("tells the model to stop using memory once it is turned off", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmp
      const initial = yield* readInitial(yield* instructions({ data: tmp.path, directory: tmp.path }))

      const updated = yield* readUpdate(
        yield* instructions({ data: tmp.path, directory: tmp.path, memory: false }),
        initial,
      )

      expect(updated.text).toContain("Local memory is now turned off.")
      expect((yield* readInitial(yield* instructions({ data: tmp.path, directory: tmp.path, memory: false }))).text).toBe(
        "",
      )
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
