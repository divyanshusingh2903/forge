import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Fiber, Layer, Stream } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { FSUtil } from "@opencode/util/fs-util"
import { Bus } from "@opencode/core/bus"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Generate } from "@opencode/core/generate"
import { Git } from "@opencode/core/git"
import { GitActions } from "@opencode/core/git-actions"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Git as GitSchema } from "@opencode/schema/git"
import { initGit } from "./fixture/git"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const watcher = Watcher.testLayer
// Git on Windows checks files out with CRLF unless the user turned autocrlf off.
const lf = (text: string) => text.replaceAll("\r\n", "\n")

const provide = (directory: string, written = "feat(core): add greetings\n\n- greet in English") =>
  Effect.provide(
    Layer.mergeAll(
      LayerNode.compile(
        LayerNode.group([GitActions.node, Bus.node, Location.node, AppProcess.node, FSUtil.node, Git.node, Watcher.node]),
        {
          replacements: [
            Location.node.replace(
              Layer.succeed(
                Location.Service,
                Location.Service.of(
                  location(
                    { directory: AbsolutePath.make(directory) },
                    { vcs: { type: "git", store: AbsolutePath.make(path.join(directory, ".git")) } },
                  ),
                ),
              ),
            ),
            Watcher.node.replace(watcher),
            Generate.node.replace(
              Layer.succeed(
                Generate.Service,
                Generate.Service.of({
                  text: (input) =>
                    input.prompt.includes("Changed files:") ? Effect.succeed(written) : Effect.die("no diff in prompt"),
                  image: () => Effect.die("unused"),
                  decisions: () => Effect.die("unused"),
                }),
              ),
            ),
          ],
        },
      ),
      watcher,
    ),
  )

const withRepo = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.tap((tmp) =>
      Effect.promise(async () => {
        await initGit(tmp.path, "-b", "main")
        await fs.writeFile(path.join(tmp.path, "a.txt"), "one\n")
        await $`git add -A`.cwd(tmp.path).quiet()
        await $`git commit -m initial`.cwd(tmp.path).quiet()
      }),
    ),
    Effect.flatMap((tmp) => f(tmp.path)),
  )

const changes = (state: GitSchema.State) =>
  Object.fromEntries(state.changes.map((change) => [change.file, change]))

describe("GitActions", () => {
  it.live("stages, unstages and commits files", () =>
    withRepo((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "a.txt"), "two\n")
          await fs.writeFile(path.join(directory, "b [1].txt"), "new\n")
          await fs.mkdir(path.join(directory, ".opencode/plans"), { recursive: true })
          await fs.writeFile(path.join(directory, ".opencode/plans/plan.md"), "# Plan\n")
        })
        const git = yield* GitActions.Service

        const initial = yield* git.state()
        expect(initial.branch).toBe("main")
        expect(changes(initial)).toEqual({
          "a.txt": { file: "a.txt", staged: false, unstaged: true, untracked: false },
          "b [1].txt": { file: "b [1].txt", staged: false, unstaged: true, untracked: true },
        })

        yield* git.stage({ files: ["b [1].txt"] })
        expect(changes(yield* git.state())["b [1].txt"]).toMatchObject({ staged: true, unstaged: false })

        yield* git.stage({})
        expect((yield* git.state()).changes.every((change) => change.staged && !change.unstaged)).toBe(true)

        yield* git.unstage({ files: ["a.txt"] })
        expect(changes(yield* git.state())["a.txt"]).toMatchObject({ staged: false, unstaged: true })

        yield* git.commit({ message: "add b" })
        const after = yield* git.state()
        expect(after.changes.map((change) => change.file)).toEqual(["a.txt"])
        expect(yield* Effect.promise(() => $`git log -1 --format=%s`.cwd(directory).text())).toBe("add b\n")
        // The plan agent's notes were never staged.
        expect(yield* Effect.promise(() => $`git ls-files .opencode`.cwd(directory).text())).toBe("")
      }).pipe(provide(directory)),
    ),
  )

  it.live("commits everything at once and refuses an empty message", () =>
    withRepo((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "c.txt"), "c\n"))
        const git = yield* GitActions.Service
        const empty = yield* git.commit({ message: "  " }).pipe(Effect.flip)
        expect(empty).toMatchObject({ operation: "commit" })
        yield* git.commit({ message: "add c", all: true })
        expect((yield* git.state()).changes).toEqual([])
      }).pipe(provide(directory)),
    ),
  )

  it.live("discards only the unstaged part of a file", () =>
    withRepo((directory) =>
      Effect.gen(function* () {
        const file = path.join(directory, "a.txt")
        yield* Effect.promise(() => fs.writeFile(file, "staged\n"))
        const git = yield* GitActions.Service
        yield* git.stage({ files: ["a.txt"] })
        yield* Effect.promise(() => fs.writeFile(file, "unstaged\n"))
        yield* git.discard({ file: "a.txt" })
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8").then(lf))).toBe("staged\n")
        expect(yield* git.discard({ file: "../outside" }).pipe(Effect.flip)).toMatchObject({
          message: "Invalid file path",
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("writes a commit message from the staged diff", () =>
    withRepo((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "a.txt"), "hello\n"))
        const git = yield* GitActions.Service
        expect(yield* git.message({}).pipe(Effect.flip)).toMatchObject({ operation: "message" })
        expect(yield* git.message({ all: true })).toEqual({
          message: "feat(core): add greetings\n\n- greet in English",
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("pushes a new branch with upstream, then counts and pulls remote commits", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const origin = path.join(tmp.path, "origin.git")
        const local = path.join(tmp.path, "local")
        const other = path.join(tmp.path, "other")
        return Effect.promise(async () => {
          await $`git init --bare -b main ${origin}`.quiet()
          await initGit(local, "-b", "main")
          await fs.writeFile(path.join(local, "a.txt"), "one\n")
          await $`git add -A`.cwd(local).quiet()
          await $`git commit -m initial`.cwd(local).quiet()
          await $`git remote add origin ${pathToFileURL(origin).href}`.cwd(local).quiet()
        }).pipe(
          Effect.andThen(
            Effect.gen(function* () {
              const git = yield* GitActions.Service
              const before = yield* git.state()
              expect(before.remote).toEqual({ upstream: false, ahead: 1, behind: 0, remotes: true })

              yield* git.push({ remote: "origin", setUpstream: true })
              expect((yield* git.state()).remote).toEqual({
                upstream: true,
                ahead: 0,
                behind: 0,
                remotes: true,
                target: { remote: "origin", branch: "main" },
              })

              yield* Effect.promise(async () => {
                await $`git clone ${pathToFileURL(origin).href} ${other}`.quiet()
                await fs.appendFile(path.join(other, ".git", "config"), "[user]\n\temail = t@t\n\tname = T\n")
                await fs.writeFile(path.join(other, "b.txt"), "b\n")
                await $`git add -A`.cwd(other).quiet()
                await $`git commit -m remote`.cwd(other).quiet()
                await $`git push`.cwd(other).quiet()
              })
              yield* git.fetch()
              expect((yield* git.state()).remote).toMatchObject({ ahead: 0, behind: 1 })
              expect(yield* git.targets()).toEqual({
                remotes: ["origin"],
                branches: [{ remote: "origin", branch: "main" }],
                pull: "merge",
              })
              yield* git.pull({})
              expect((yield* git.state()).remote).toMatchObject({ ahead: 0, behind: 0 })
              expect(yield* git.push({ remote: "--upload-pack=evil" }).pipe(Effect.flip)).toMatchObject({
                message: "Select a configured Git remote",
              })

              // A new branch off pushed history counts only its own commits as unpushed, and offers to set upstream.
              yield* Effect.promise(async () => {
                await $`git switch -c feature`.cwd(local).quiet()
                await fs.writeFile(path.join(local, "c.txt"), "c\n")
                await $`git add -A`.cwd(local).quiet()
                await $`git commit -m feature`.cwd(local).quiet()
              })
              expect((yield* git.state()).remote).toEqual({ upstream: false, ahead: 1, behind: 0, remotes: true })
              yield* git.push({ remote: "origin", setUpstream: true })
              expect((yield* git.state()).remote).toEqual({
                upstream: true,
                ahead: 0,
                behind: 0,
                remotes: true,
                target: { remote: "origin", branch: "feature" },
              })
            }).pipe(provide(local)),
          ),
        )
      }),
    ),
  )

  it.live("creates, applies, pops and drops stashes by position and object", () =>
    withRepo((directory) =>
      Effect.gen(function* () {
        const file = path.join(directory, "a.txt")
        const git = yield* GitActions.Service
        yield* Effect.promise(() => fs.writeFile(file, "first\n"))
        yield* git.stashCreate({ message: "first" })
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "new.txt"), "new\n"))
        yield* git.stashCreate({ message: "second", includeUntracked: true })
        expect((yield* git.state()).changes).toEqual([])

        const list = yield* git.stashes()
        expect(list.map((stash) => [stash.ref, stash.message])).toEqual([
          ["stash@{0}", "On main: second"],
          ["stash@{1}", "On main: first"],
        ])
        expect(yield* git.stashDrop({ ref: "stash@{0}", oid: list[1].oid }).pipe(Effect.flip)).toMatchObject({
          operation: "stash-drop",
        })

        yield* git.stashApply(list[1])
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8").then(lf))).toBe("first\n")
        yield* git.stage({})
        yield* git.commit({ message: "first" })
        yield* git.stashDrop((yield* git.stashes())[1])
        yield* git.stashPop((yield* git.stashes())[0])
        expect(yield* git.stashes()).toEqual([])
        expect(changes(yield* git.state())["new.txt"]).toMatchObject({ untracked: true })
      }).pipe(provide(directory)),
    ),
  )

  it.live("announces changes to the index and working tree once the state is read", () =>
    withRepo((directory) =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const test = yield* Watcher.Test
        const git = yield* GitActions.Service
        const changed = yield* bus.subscribe(GitSchema.Changed).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
        yield* git.state()
        // Subscriptions start asynchronously; let them register before emitting.
        yield* Effect.sleep("50 millis")
        expect((yield* test.subscriptions()).map((item) => item.type)).toEqual([
          "entries",
          "entries",
          "directory",
          "directory",
        ])
        yield* test.emit({ path: path.join(directory, ".git", "index"), type: "update" })
        expect(Array.from(yield* Fiber.join(changed))).toHaveLength(1)
      }).pipe(provide(directory)),
    ),
  )
})

describe("conventionalCommit", () => {
  test("keeps a conforming subject and its bullets, dropping attribution", () => {
    expect(
      GitActions.conventionalCommit(
        "```\nFeature(App): Add panel.\n\n- stage files\n- Co-authored-by: Bot <b@b>\n- generated by Model\n```",
      ),
    ).toBe("feat(app): Add panel\n\n- stage files")
  })

  test("coerces a bare summary into chore", () => {
    expect(GitActions.conventionalCommit("Update the readme.")).toBe("chore: update the readme")
    expect(GitActions.conventionalCommit("  ")).toBeUndefined()
  })
})
