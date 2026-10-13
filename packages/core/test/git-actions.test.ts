import { describe, expect } from "bun:test"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Effect } from "effect"
import { Git } from "@opencode-ai/core/git"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { gitRemote, git, commit } from "./fixture/git"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Git.node))

function fixture<A, E, R>(
  body: (input: Awaited<ReturnType<typeof gitRemote>>, repository: Git.Repository) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const input = yield* Effect.promise(() => gitRemote(root.path))
    const service = yield* Git.Service
    const repository = yield* service.repo.clone({
      remote: input.remote,
      directory: AbsolutePath.make(path.join(root.path, "checkout")),
    })
    yield* Effect.promise(async () => {
      await git(repository.worktree, "config", "user.name", "Test")
      await git(repository.worktree, "config", "user.email", "test@example.com")
      await git(repository.worktree, "config", "commit.gpgsign", "false")
    })
    return yield* body(input, repository)
  })
}

describe("Git review actions", () => {
  it.live("prunes ignored directories without excluding force-added tracked files", () =>
    fixture((_, repository) =>
      Effect.gen(function* () {
        const service = yield* Git.Service
        yield* Effect.promise(async () => {
          await Bun.write(path.join(repository.worktree, ".gitignore"), "generated/\n")
          await fs.mkdir(path.join(repository.worktree, "generated"))
          await Bun.write(path.join(repository.worktree, "generated", "file.txt"), "generated\n")
        })
        expect(yield* service.index.watchIgnores(repository)).toContain("generated")
        yield* Effect.promise(() => git(repository.worktree, "add", "-f", "generated/file.txt"))
        expect(yield* service.index.watchIgnores(repository)).not.toContain("generated")
      }),
    ),
  )
  it.live("publishes a slash-named branch with upstream and rejects arbitrary remotes", () =>
    fixture((input, repository) =>
      Effect.gen(function* () {
        const service = yield* Git.Service
        yield* Effect.promise(() => git(repository.worktree, "checkout", "-b", "feature/publish"))
        yield* service.sync.push(repository, { setUpstream: true })
        expect(
          yield* Effect.promise(() =>
            $`git config --get branch.feature/publish.remote`.cwd(repository.worktree).quiet().text(),
          ),
        ).toBe("origin\n")
        expect(yield* service.remote.upstream(repository)).toEqual({ remote: "origin", branch: "feature/publish" })
        yield* service.sync.fetchBranch(repository, { branch: "feature/publish", force: false })
        expect((yield* service.remote.targets(repository)).branches).toContainEqual({
          remote: "origin",
          branch: "feature/publish",
        })
        const failure = yield* service.sync.push(repository, { remote: input.remote }).pipe(Effect.flip)
        expect(failure.message).toContain("configured Git remote")
      }),
    ),
  )

  for (const strategy of ["merge", "rebase"] as const) {
    it.live(`pulls using explicit ${strategy} despite repository defaults`, () =>
      fixture((input, repository) =>
        Effect.gen(function* () {
          const service = yield* Git.Service
          yield* Effect.promise(async () => {
            await git(repository.worktree, "config", "pull.rebase", strategy === "merge" ? "true" : "false")
            await git(repository.worktree, "config", "pull.ff", "only")
            await Bun.write(path.join(repository.worktree, "local.txt"), "local\n")
            await git(repository.worktree, "add", "local.txt")
            await git(repository.worktree, "commit", "-m", "local")
            await commit(input.source, "remote\n", "remote")
          })
          yield* service.sync.pull(repository, { remote: "origin", branch: "main", strategy })
          expect(yield* Effect.promise(() => Bun.file(path.join(repository.worktree, "README.md")).text())).toBe(
            "remote\n",
          )
          expect(yield* Effect.promise(() => Bun.file(path.join(repository.worktree, "local.txt")).text())).toBe(
            "local\n",
          )
          expect(yield* service.history.branch(repository)).toBe("main")
          expect(yield* service.remote.upstream(repository)).toEqual({ remote: "origin", branch: "main" })
        }),
      ),
    )
    it.live(`preserves ${strategy} conflict state for the caller to resolve`, () =>
      fixture((input, repository) =>
        Effect.gen(function* () {
          const service = yield* Git.Service
          yield* Effect.promise(async () => {
            await Bun.write(path.join(repository.worktree, "README.md"), "local conflict\n")
            await git(repository.worktree, "add", "README.md")
            await git(repository.worktree, "commit", "-m", "local conflict")
            await commit(input.source, "remote conflict\n", "remote conflict")
          })
          yield* service.sync.pull(repository, { remote: "origin", branch: "main", strategy }).pipe(Effect.flip)
          expect(
            yield* Effect.promise(() => $`git status --porcelain`.cwd(repository.worktree).quiet().text()),
          ).toContain("UU README.md")
          expect(yield* Effect.promise(() => Bun.file(path.join(repository.worktree, "README.md")).text())).toContain(
            "<<<<<<<",
          )
        }),
      ),
    )
  }

  it.live("pulls with the configured strategy when none is given", () =>
    fixture((input, repository) =>
      Effect.gen(function* () {
        const service = yield* Git.Service
        expect((yield* service.remote.targets(repository)).pull).toBe("merge")
        yield* Effect.promise(async () => {
          await git(repository.worktree, "config", "pull.rebase", "true")
          await Bun.write(path.join(repository.worktree, "local.txt"), "local\n")
          await git(repository.worktree, "add", "local.txt")
          await git(repository.worktree, "commit", "-m", "local")
          await commit(input.source, "remote\n", "remote")
        })
        expect((yield* service.remote.targets(repository)).pull).toBe("rebase")
        yield* service.sync.pull(repository)
        // A rebase leaves the local commit on top of the remote one, with no merge commit.
        expect(
          yield* Effect.promise(() => $`git log --format=%P%x09%s -2`.cwd(repository.worktree).quiet().text()),
        ).toMatch(/^[0-9a-f]+\tlocal\n[0-9a-f]+\tremote\n$/)
      }),
    ),
  )

  it.live("shares stash identity across linked worktrees while preserving the main working tree", () =>
    fixture((input, repository) =>
      Effect.gen(function* () {
        const service = yield* Git.Service
        const linked = yield* service.worktree.create({
          repository,
          directory: AbsolutePath.make(path.join(input.root, "linked")),
        })
        yield* Effect.promise(() => Bun.write(path.join(linked.worktree, "README.md"), "linked change\n"))
        yield* service.stash.create(linked, { message: "linked stash" })
        const saved = (yield* service.stash.list(repository))[0]
        if (!saved) return yield* Effect.die(new Error("Missing shared stash"))
        yield* service.stash.apply(linked, saved)
        expect(yield* Effect.promise(() => Bun.file(path.join(repository.worktree, "README.md")).text())).toBe("one\n")
        expect(yield* Effect.promise(() => Bun.file(path.join(linked.worktree, "README.md")).text())).toBe(
          "linked change\n",
        )
      }),
    ),
  )

  it.live("creates, applies, pops, and drops stashes with stale-selection protection", () =>
    fixture((_, repository) =>
      Effect.gen(function* () {
        const service = yield* Git.Service
        yield* Effect.promise(() => Bun.write(path.join(repository.worktree, "README.md"), "first\n"))
        yield* service.stash.create(repository, { message: "first stash" })
        const first = (yield* service.stash.list(repository))[0]
        if (!first) return yield* Effect.die(new Error("Missing stash"))
        expect(first.message).toContain("first stash")
        yield* service.stash.apply(repository, first)
        expect(yield* Effect.promise(() => Bun.file(path.join(repository.worktree, "README.md")).text())).toBe(
          "first\n",
        )
        expect(yield* service.stash.list(repository)).toHaveLength(1)
        yield* Effect.promise(() => git(repository.worktree, "restore", "README.md"))
        yield* Effect.promise(() => Bun.write(path.join(repository.worktree, "untracked.txt"), "untracked\n"))
        yield* service.stash.create(repository, { includeUntracked: true })
        expect(yield* Effect.promise(() => Bun.file(path.join(repository.worktree, "untracked.txt")).exists())).toBe(
          false,
        )
        expect((yield* service.stash.drop(repository, first).pipe(Effect.flip)).message).toContain(
          "selected stash has changed",
        )
        const second = (yield* service.stash.list(repository))[0]
        if (!second) return yield* Effect.die(new Error("Missing second stash"))
        yield* service.stash.pop(repository, second)
        expect(yield* Effect.promise(() => Bun.file(path.join(repository.worktree, "untracked.txt")).text())).toBe(
          "untracked\n",
        )
        const remaining = (yield* service.stash.list(repository))[0]
        if (!remaining) return yield* Effect.die(new Error("Missing remaining stash"))
        yield* service.stash.drop(repository, remaining)
        expect(yield* service.stash.list(repository)).toEqual([])
      }),
    ),
  )

  it.live("keeps a conflicting pop in the stash list and exposes unmerged files", () =>
    fixture((_, repository) =>
      Effect.gen(function* () {
        const service = yield* Git.Service
        yield* Effect.promise(() => Bun.write(path.join(repository.worktree, "README.md"), "stashed\n"))
        yield* service.stash.create(repository, {})
        const saved = (yield* service.stash.list(repository))[0]
        if (!saved) return yield* Effect.die(new Error("Missing stash"))
        yield* Effect.promise(async () => {
          await Bun.write(path.join(repository.worktree, "README.md"), "committed\n")
          await git(repository.worktree, "add", "README.md")
          await git(repository.worktree, "commit", "-m", "conflicting change")
        })
        yield* service.stash.pop(repository, saved).pipe(Effect.flip)
        expect(yield* service.stash.list(repository)).toHaveLength(1)
        const status = yield* Effect.promise(() => $`git status --porcelain`.cwd(repository.worktree).quiet().text())
        expect(status).toContain("UU README.md")
      }),
    ),
  )
})
