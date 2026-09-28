import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { parsePatch } from "diff"
import { Deferred, Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import {
  disposeAllInstances,
  provideInstance,
  testInstanceStoreLayer,
  TestInstance,
  tmpdirScoped,
} from "../fixture/fixture"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Git } from "../../src/git"
import { Vcs } from "@/project/vcs"
import { testEffect } from "../lib/effect"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const weird = process.platform === "win32" ? "space file.txt" : "tab\tfile.txt"

const layer = LayerNode.compile(
  LayerNode.group([Vcs.node, Git.node, EventV2Bridge.node, FSUtil.node, CrossSpawnSpawner.node]),
)
const it = testEffect(layer)
const worktreeIt = testEffect(Layer.mergeAll(layer, testInstanceStoreLayer))

const git = Effect.fn("VcsTest.git")(function* (cwd: string, args: string[]) {
  const result = yield* Git.Service.use((git) => git.run(args, { cwd }))
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString("utf8")}`)
})

const write = Effect.fn("VcsTest.write")(function* (file: string, content: string) {
  yield* FSUtil.Service.use((fs) => fs.writeWithDirs(file, content))
})

const remove = Effect.fn("VcsTest.remove")(function* (file: string) {
  yield* FSUtil.Service.use((fs) => fs.remove(file))
})

const symlink = (target: string, file: string) => Effect.promise(() => fs.symlink(target, file))

const init = Effect.fn("VcsTest.init")(function* () {
  const vcs = yield* Vcs.Service
  yield* vcs.init()
  return vcs
})

const nextBranchUpdate = Effect.fn("VcsTest.nextBranchUpdate")(function* () {
  const events = yield* EventV2Bridge.Service
  const updated = yield* Deferred.make<string | undefined>()

  const off = yield* events.listen((event) => {
    if (event.type === Vcs.Event.BranchUpdated.type)
      Deferred.doneUnsafe(updated, Effect.succeed((event.data as typeof Vcs.Event.BranchUpdated.data.Type).branch))
    return Effect.void
  })
  yield* Effect.addFinalizer(() => off)

  return updated
})

const publishHeadChangeUntil = Effect.fn("VcsTest.publishHeadChangeUntil")(function* (
  pending: Deferred.Deferred<string | undefined>,
  head: string,
) {
  const events = yield* EventV2Bridge.Service
  for (let i = 0; i < 50; i++) {
    yield* events.publish(Watcher.Event.Updated, { file: head, event: "change" })
    if (yield* Deferred.isDone(pending)) return
    yield* Effect.sleep("10 millis")
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Vcs", () => {
  afterEach(async () => {
    await disposeAllInstances()
  })

  it.instance(
    "branch() returns current branch name",
    () =>
      Effect.gen(function* () {
        const vcs = yield* init()
        const branch = yield* vcs.branch()

        expect(branch).toBeDefined()
        expect(typeof branch).toBe("string")
      }),
    { git: true },
  )

  it.instance("branch() returns undefined for non-git directories", () =>
    Effect.gen(function* () {
      const vcs = yield* init()
      const branch = yield* vcs.branch()

      expect(branch).toBeUndefined()
    }),
  )

  it.instance(
    "publishes BranchUpdated when .git/HEAD changes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const branch = `test-${Math.random().toString(36).slice(2)}`
        yield* git(test.directory, ["branch", branch])

        const vcs = yield* init()
        yield* vcs.branch()
        const pending = yield* nextBranchUpdate()

        const head = path.join(test.directory, ".git", "HEAD")
        yield* write(head, `ref: refs/heads/${branch}\n`)
        yield* publishHeadChangeUntil(pending, head)

        const updated = yield* Deferred.await(pending).pipe(Effect.timeout("2 seconds"))
        expect(updated).toBe(branch)
      }),
    { git: true },
  )

  it.instance(
    "branch() reflects the new branch after HEAD change",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const branch = `test-${Math.random().toString(36).slice(2)}`
        yield* git(test.directory, ["branch", branch])

        const vcs = yield* init()
        yield* vcs.branch()
        const pending = yield* nextBranchUpdate()

        const head = path.join(test.directory, ".git", "HEAD")
        yield* write(head, `ref: refs/heads/${branch}\n`)
        yield* publishHeadChangeUntil(pending, head)
        yield* Deferred.await(pending).pipe(Effect.timeout("2 seconds"))

        const current = yield* vcs.branch()
        expect(current).toBe(branch)
      }),
    { git: true },
  )
})

describe("Vcs diff", () => {
  afterEach(async () => {
    await disposeAllInstances()
  })

  it.instance(
    "defaultBranch() falls back to main",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* git(test.directory, ["branch", "-M", "main"])

        const vcs = yield* init()
        const branch = yield* vcs.defaultBranch()

        expect(branch).toBe("main")
      }),
    { git: true },
  )

  it.instance(
    "defaultBranch() uses init.defaultBranch when available",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* git(test.directory, ["branch", "-M", "trunk"])
        yield* git(test.directory, ["config", "init.defaultBranch", "trunk"])

        const vcs = yield* init()
        const branch = yield* vcs.defaultBranch()

        expect(branch).toBe("trunk")
      }),
    { git: true },
  )

  worktreeIt.live("detects current branch from the active worktree", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const wt = yield* tmpdirScoped()
      yield* git(tmp, ["branch", "-M", "main"])
      const dir = path.join(wt, "feature")
      yield* git(tmp, ["worktree", "add", "-b", "feature/test", dir, "HEAD"])

      const [branch, base] = yield* Effect.gen(function* () {
        const vcs = yield* init()
        return yield* Effect.all([vcs.branch(), vcs.defaultBranch()], { concurrency: 2 })
      }).pipe(provideInstance(dir))

      expect(branch).toBeDefined()
      expect(branch).toBe("feature/test")
      expect(base).toBe("main")
    }),
  )

  it.instance(
    "diff('git') returns uncommitted changes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* write(path.join(test.directory, "file.txt"), "original\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "add file"])
        yield* write(path.join(test.directory, "file.txt"), "changed\n")

        const vcs = yield* init()
        const diff = yield* vcs.diff("git")

        expect(diff).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file: "file.txt",
              status: "modified",
            }),
          ]),
        )
        expect(diff.find((item) => item.file === "file.txt")?.patch).toContain("diff --git")
      }),
    { git: true },
  )

  it.instance(
    "diff('git') handles special filenames",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* write(path.join(test.directory, weird), "hello\n")

        const vcs = yield* init()
        const diff = yield* vcs.diff("git")

        expect(diff).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file: weird,
              status: "added",
            }),
          ]),
        )
      }),
    { git: true },
  )

  it.instance(
    "diff('git') keeps batched patches aligned for type changes",
    () =>
      Effect.gen(function* () {
        if (process.platform === "win32") return

        const test = yield* TestInstance
        yield* write(path.join(test.directory, "a.txt"), "old\n")
        yield* write(path.join(test.directory, "b.txt"), "old\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "add files"])
        yield* remove(path.join(test.directory, "a.txt"))
        yield* symlink("target", path.join(test.directory, "a.txt"))
        yield* write(path.join(test.directory, "b.txt"), "new\n")

        const vcs = yield* init()
        const diff = yield* vcs.diff("git")
        const a = diff.find((item) => item.file === "a.txt")
        const b = diff.find((item) => item.file === "b.txt")

        expect(a?.patch).toContain("deleted file mode")
        expect(a?.patch).toContain("new file mode")
        expect(b?.patch).toContain("+new")
      }),
    { git: true },
  )

  it.instance(
    "diff('git') keeps carriage returns inside patch hunks",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* write(path.join(test.directory, "file.txt"), "keep\nsame\rdiff --git inside\ndelete\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "add file"])
        yield* write(path.join(test.directory, "file.txt"), "keep\nadd\nsame\rdiff --git inside\n")

        const vcs = yield* init()
        const diff = yield* vcs.diff("git")
        const file = diff.find((item) => item.file === "file.txt")

        expect(file?.patch).toContain(" same\rdiff --git inside")
        expect(file?.patch).toContain("-delete")
        expect(() => parsePatch(file?.patch ?? "")).not.toThrow()
      }),
    { git: true },
    20_000,
  )

  it.instance(
    "diff('branch') returns changes against default branch",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* git(test.directory, ["branch", "-M", "main"])
        yield* git(test.directory, ["checkout", "-b", "feature/test"])
        yield* write(path.join(test.directory, "branch.txt"), "hello\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "branch file"])

        const vcs = yield* init()
        const diff = yield* vcs.diff("branch")

        expect(diff).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file: "branch.txt",
              status: "added",
            }),
          ]),
        )
      }),
    { git: true },
  )

  it.instance(
    "tracks staged and unstaged file changes separately and discard preserves the index",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* write(path.join(test.directory, "file.txt"), "base\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "base"])
        yield* write(path.join(test.directory, "file.txt"), "staged\n")
        const vcs = yield* init()
        expect((yield* vcs.stage({ file: "file.txt" })).success).toBe(true)
        yield* write(path.join(test.directory, "file.txt"), "unstaged\n")

        expect(yield* vcs.changes()).toEqual([{ file: "file.txt", staged: true, unstaged: true, untracked: false }])
        expect(yield* vcs.stagedDiff()).toContain("+staged")
        expect(yield* vcs.stagedDiff()).not.toContain("+unstaged")
        expect((yield* vcs.discard({ file: "file.txt" })).success).toBe(true)
        expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "file.txt")).text())).toBe("staged\n")
        expect(yield* vcs.changes()).toEqual([{ file: "file.txt", staged: true, unstaged: false, untracked: false }])
      }),
    { git: true },
  )

  it.instance(
    "stages literal filenames, unstages them, and rejects committing without staged changes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const vcs = yield* init()
        yield* write(path.join(test.directory, "[draft].txt"), "draft\n")
        yield* write(path.join(test.directory, "d.txt"), "other\n")

        expect((yield* vcs.stage({ file: "[draft].txt" })).success).toBe(true)
        expect(yield* vcs.changes()).toEqual(
          expect.arrayContaining([
            { file: "[draft].txt", staged: true, unstaged: false, untracked: false },
            { file: "d.txt", staged: false, unstaged: true, untracked: true },
          ]),
        )
        expect((yield* vcs.stagedDiff()).includes("draft")).toBe(true)
        expect((yield* vcs.unstage({ file: "[draft].txt" })).success).toBe(true)
        expect((yield* Effect.exit(vcs.commit({ message: "not yet" })))._tag).toBe("Failure")
        expect((yield* Effect.exit(vcs.stage({ file: "../outside" })))._tag).toBe("Failure")
        expect((yield* vcs.discard({ file: "[draft].txt" })).success).toBe(true)
        expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "[draft].txt")).exists())).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "commits staged changes and reports remote failures without an upstream",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const vcs = yield* init()
        yield* write(path.join(test.directory, "commit.txt"), "saved\n")
        yield* vcs.stage({ file: "commit.txt" })
        expect((yield* vcs.commit({ message: "Save changes" })).success).toBe(true)
        expect(yield* vcs.changes()).toEqual([])
        expect((yield* Effect.exit(vcs.push()))._tag).toBe("Failure")
        expect((yield* Effect.exit(vcs.pull()))._tag).toBe("Failure")
      }),
    { git: true },
  )

  it.instance(
    "bulk staging ignores plans and keeps mixed worktree changes when unstaging",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const vcs = yield* init()
        yield* write(path.join(test.directory, "a [literal].txt"), "first\n")
        yield* write(path.join(test.directory, "b.txt"), "second\n")
        yield* write(path.join(test.directory, ".opencode/plans/draft.md"), "not included\n")
        expect((yield* vcs.stageAll()).success).toBe(true)
        expect(yield* vcs.changes()).toEqual(
          expect.arrayContaining([
            { file: "a [literal].txt", staged: true, unstaged: false, untracked: false },
            { file: "b.txt", staged: true, unstaged: false, untracked: false },
          ]),
        )
        const staged = yield* Git.Service.use((git) =>
          git.run(["diff", "--cached", "--name-only"], { cwd: test.directory }),
        )
        expect(staged.text()).toContain("a [literal].txt")
        expect(staged.text()).not.toContain("draft.md")
        yield* write(path.join(test.directory, "b.txt"), "worktree only\n")
        expect((yield* vcs.unstageAll()).success).toBe(true)
        expect((yield* vcs.stagedDiff().pipe(Effect.exit))._tag).toBe("Failure")
        expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "b.txt")).text())).toBe("worktree only\n")
        expect((yield* vcs.stageAll()).success).toBe(true)
        expect((yield* vcs.unstageAll()).success).toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "summarizes very large staged diffs instead of rejecting them",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const vcs = yield* init()
        yield* write(path.join(test.directory, "huge.lock"), "entry\n".repeat(200_000))
        yield* write(path.join(test.directory, "small.ts"), "export const small = 1\n")
        expect((yield* vcs.stageAll()).success).toBe(true)

        const summary = yield* vcs.stagedDiff()
        expect(summary).toContain("huge.lock")
        expect(summary).toContain("+export const small = 1")
        expect(summary).toContain("[... diff truncated]")
        expect(summary.length).toBeLessThan(80_000)
      }),
    { git: true },
  )
})
