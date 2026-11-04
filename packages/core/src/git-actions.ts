export * as GitActions from "./git-actions.js"

import path from "path"
import { Cause, Context, Duration, Effect, Layer, Schema, Semaphore, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { ForgePlan } from "@opencode/schema/forge-plan"
import { Git as GitSchema } from "@opencode/schema/git"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { AppProcess } from "@opencode/util/process"
import { Bus } from "./bus.js"
import { Watcher } from "./filesystem/watcher.js"
import { Generate } from "./generate.js"
import { Git } from "./git.js"
import { Location } from "./location.js"
import { splitGitPatch } from "./vcs/patch.js"
import { gitExecutable } from "./util/git-executable.js"

export class Error extends Schema.TaggedError<Error>()("GitActions.Error", {
  operation: GitSchema.Operation,
  message: Schema.String,
}) {}

export interface Interface {
  readonly state: () => Effect.Effect<GitSchema.State, Error>
  readonly stage: (input: GitSchema.FilesInput) => Effect.Effect<void, Error>
  readonly unstage: (input: GitSchema.FilesInput) => Effect.Effect<void, Error>
  readonly discard: (input: GitSchema.DiscardInput) => Effect.Effect<void, Error>
  readonly commit: (input: GitSchema.CommitInput) => Effect.Effect<GitSchema.Output, Error>
  readonly message: (input: GitSchema.MessageInput) => Effect.Effect<GitSchema.Message, Error>
  readonly fetch: () => Effect.Effect<GitSchema.Output, Error>
  readonly push: (input: GitSchema.PushInput) => Effect.Effect<GitSchema.Output, Error>
  readonly pull: (input: GitSchema.PullInput) => Effect.Effect<GitSchema.Output, Error>
  readonly targets: () => Effect.Effect<GitSchema.Targets, Error>
  readonly stashes: () => Effect.Effect<readonly GitSchema.Stash[], Error>
  readonly stashCreate: (input: GitSchema.StashCreateInput) => Effect.Effect<GitSchema.Output, Error>
  readonly stashApply: (input: GitSchema.StashInput) => Effect.Effect<GitSchema.Output, Error>
  readonly stashPop: (input: GitSchema.StashInput) => Effect.Effect<GitSchema.Output, Error>
  readonly stashDrop: (input: GitSchema.StashInput) => Effect.Effect<GitSchema.Output, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GitActions") {}

// Commands that may contact a remote or open an editor must fail instead of waiting for input nobody can give.
const nonInteractive = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_EDITOR: "true",
  GIT_SEQUENCE_EDITOR: "true",
  GIT_MERGE_AUTOEDIT: "no",
  GCM_INTERACTIVE: "never",
}
const conflictCodes = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"])
const STAGED_PATCH_BUDGET = 60_000
const STAGED_PATCH_MIN_SHARE = 400
const NETWORK_TIMEOUT = Duration.minutes(5)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const git = yield* Git.Service
    const proc = yield* AppProcess.Service
    const bus = yield* Bus.Service
    const watcher = yield* Watcher.Service
    const generate = yield* Generate.Service
    const repository = yield* git.repo.discover(location.directory)
    const scope = yield* Effect.scope
    // One write at a time, so a stage and a commit started together never race on the index lock.
    const writes = Semaphore.makeUnsafe(1)

    const run = Effect.fnUntraced(function* (
      operation: GitSchema.Operation,
      args: readonly string[],
      options?: { readonly network?: boolean; readonly maxOutputBytes?: number },
    ) {
      if (!repository) return yield* new Error({ operation, message: "Not a Git repository" })
      const result = yield* proc
        .run(
          ChildProcess.make(gitExecutable(), ["-c", "core.quotepath=false", ...args], {
            cwd: repository.worktree,
            env: nonInteractive,
            extendEnv: true,
            stdin: "ignore",
          }),
          { maxOutputBytes: options?.maxOutputBytes, ...(options?.network ? { timeout: NETWORK_TIMEOUT } : {}) },
        )
        .pipe(Effect.mapError((error) => new Error({ operation, message: error.message })))
      const stdout = result.stdout.toString("utf8")
      const stderr = result.stderr.toString("utf8")
      if (result.exitCode !== 0)
        return yield* new Error({ operation, message: stderr.trim() || stdout.trim() || `git ${args[0]} failed` })
      return { stdout, stderr, output: [stdout.trim(), stderr.trim()].filter(Boolean).join("\n") }
    })
    const read = (operation: GitSchema.Operation, args: readonly string[]) =>
      run(operation, args).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.orElseSucceed(() => ""),
      )
    const write = <A>(effect: Effect.Effect<A, Error>) => writes.withPermit(effect)

    const status = Effect.fnUntraced(function* (operation: GitSchema.Operation) {
      const result = yield* run(operation, ["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z"])
      return result.stdout
        .split("\0")
        .filter(Boolean)
        .map((entry) => ({ code: entry.slice(0, 2), file: entry.slice(3) }))
        .filter((entry) => entry.file && !isPlanFile(entry.file))
    })
    const branch = () => read("state", ["symbolic-ref", "--quiet", "--short", "HEAD"]).pipe(Effect.map(nonEmpty))
    const config = (key: string) => read("state", ["config", "--get", key]).pipe(Effect.map(nonEmpty))
    const remotes = () => read("targets", ["remote"]).pipe(Effect.map((text) => text.split("\n").filter(Boolean)))

    const upstream = Effect.fnUntraced(function* (current: string | undefined) {
      if (!current) return
      const [remote, merge] = yield* Effect.all([config(`branch.${current}.remote`), config(`branch.${current}.merge`)])
      if (!remote || !merge?.startsWith("refs/heads/")) return
      return { remote, branch: merge.slice("refs/heads/".length) }
    })

    const remote = Effect.fnUntraced(function* (current: string | undefined) {
      const [names, target, counts] = yield* Effect.all(
        [remotes(), upstream(current), read("state", ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])],
        { concurrency: 3 },
      )
      const [behind, ahead] = counts.split(/\s+/).map(Number)
      if (counts) return { upstream: true, ahead: ahead || 0, behind: behind || 0, remotes: names.length > 0, ...(target ? { target } : {}) }
      // Without a reachable upstream, count the commits a push would publish for the first time.
      const unpublished =
        names.length > 0 && current ? Number(yield* read("state", ["rev-list", "--count", "HEAD", "--not", "--remotes"])) : 0
      return {
        upstream: target !== undefined,
        ahead: unpublished || 0,
        behind: 0,
        remotes: names.length > 0,
        ...(target ? { target } : {}),
      }
    })

    const targets = Effect.fn("GitActions.targets")(function* () {
      const [names, refs, current] = yield* Effect.all(
        [remotes(), read("targets", ["for-each-ref", "--format=%(refname)", "refs/remotes/"]), branch()],
        { concurrency: 3 },
      )
      // branch.<name>.rebase overrides pull.rebase; any value other than false means rebase.
      const rebase = (current ? yield* config(`branch.${current}.rebase`) : undefined) ?? (yield* config("pull.rebase"))
      const longest = names.toSorted((a, b) => b.length - a.length)
      return {
        remotes: names,
        pull: rebase && rebase !== "false" ? ("rebase" as const) : ("merge" as const),
        branches: refs.split("\n").flatMap((ref) => {
          const name = longest.find((item) => ref.startsWith(`refs/remotes/${item}/`))
          const branch = name ? ref.slice(`refs/remotes/${name}/`.length) : ""
          return name && branch && branch !== "HEAD" ? [{ remote: name, branch }] : []
        }),
      } satisfies GitSchema.Targets
    })

    const requireRemote = Effect.fnUntraced(function* (operation: "push" | "pull", name: string) {
      if (!name.startsWith("-") && (yield* remotes()).includes(name)) return name
      return yield* new Error({ operation, message: "Select a configured Git remote" })
    })

    const stashes = Effect.fn("GitActions.stashes")(function* () {
      const fields = (yield* run("stash-list", ["stash", "list", "--format=%gd%x00%H%x00%ct%x00%gs%x00"])).stdout.split(
        "\0",
      )
      return fields.flatMap((field, index) => {
        const ref = field.trim()
        if (index % 4 !== 0 || !ref) return []
        return [
          {
            ref,
            oid: fields[index + 1] ?? "",
            createdAt: Number(fields[index + 2]) * 1000,
            message: fields[index + 3] ?? "",
          } satisfies GitSchema.Stash,
        ]
      })
    })

    const stash = (operation: "apply" | "pop" | "drop", input: GitSchema.StashInput) =>
      write(
        Effect.gen(function* () {
          const current = yield* stashes()
          if (!current.some((item) => item.ref === input.ref && item.oid === input.oid))
            return yield* new Error({
              operation: `stash-${operation}`,
              message: "The stash list changed. Refresh it and try again.",
            })
          // Apply by immutable object ID; pop and drop need Git's positional selector.
          const result = yield* run(`stash-${operation}`, [
            "stash",
            operation,
            ...(operation === "apply" ? [] : ["--quiet"]),
            operation === "apply" ? input.oid : input.ref,
          ])
          return { output: result.output }
        }),
      )

    const changedFiles = Effect.fnUntraced(function* (
      operation: GitSchema.Operation,
      select: (code: string) => boolean,
      files?: readonly string[],
    ) {
      const wanted = files ? new Set(files) : undefined
      if (files?.some((file) => !safeFile(file))) return yield* new Error({ operation, message: "Invalid file path" })
      return (yield* status(operation))
        .filter((entry) => select(entry.code) && (!wanted || wanted.has(entry.file)))
        .map((entry) => entry.file)
    })

    // Literal pathspecs, so names containing `*` or `[` match only themselves.
    const withPaths = (operation: GitSchema.Operation, args: readonly string[], files: readonly string[]) =>
      files.length === 0
        ? Effect.void
        : run(operation, ["--literal-pathspecs", ...args, "--", ...files]).pipe(Effect.asVoid)

    const hasHead = () => run("state", ["rev-parse", "--verify", "--quiet", "HEAD"]).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )

    const stagedSummary = Effect.fnUntraced(function* (all: boolean) {
      const head = yield* hasHead()
      // "Commit all" summarizes what it would commit: every change in the working tree against HEAD.
      const range = all ? (head ? ["HEAD"] : []) : ["--cached"]
      const [stat, patch, untracked] = yield* Effect.all(
        [
          run("message", ["diff", "--no-ext-diff", "--stat", ...range]),
          run("message", ["diff", "--no-ext-diff", "--patch", "--unified=3", ...range], {
            maxOutputBytes: 4 * STAGED_PATCH_BUDGET,
          }),
          all ? changedFiles("message", (code) => code === "??") : Effect.succeed([] as string[]),
        ],
        { concurrency: 3 },
      )
      const files = [stat.stdout.trim(), ...untracked.map((file) => ` ${file} (new file)`)].filter(Boolean).join("\n")
      if (!files) return yield* new Error({ operation: "message", message: "There are no changes to describe" })
      return summarizeDiff(files, patch.stdout)
    })

    // Watching starts with the first read of the state, which is the review panel opening, not with every Location.
    const watch = yield* Effect.cached(
      Effect.gen(function* () {
        if (!repository) return
        const sources = [
          watcher.subscribe({
            path: repository.gitDirectory,
            type: "entries",
            names: ["HEAD", "index", "ORIG_HEAD", "MERGE_HEAD", "REBASE_HEAD", "FETCH_HEAD"],
          }),
          // `config` holds remotes and each branch's upstream, which `git branch --set-upstream-to` changes alone.
          watcher.subscribe({ path: repository.commonDirectory, type: "entries", names: ["packed-refs", "config"] }),
          watcher.subscribe({ path: path.join(repository.commonDirectory, "refs"), type: "directory" }),
          watcher.subscribe({ path: repository.worktree, type: "directory", ignore: FSUtil.ignoreGlobs }),
        ]
        const streams = yield* Effect.all(sources)
        yield* Stream.mergeAll(streams, { concurrency: "unbounded" }).pipe(
          // A commit or checkout touches many files at once; one event per burst is enough.
          Stream.debounce(Duration.millis(150)),
          Stream.runForEach(() => bus.publish(GitSchema.Changed, {})),
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterrupts(cause),
            (cause) => Effect.logWarning("git watch failed", { cause }),
          ),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      }).pipe(Effect.catchCause((cause) => Effect.logWarning("git watch could not start", { cause }))),
    )

    return Service.of({
      state: Effect.fn("GitActions.state")(function* () {
        yield* watch
        const [current, entries] = yield* Effect.all([branch(), status("state")], { concurrency: 2 })
        return {
          ...(current ? { branch: current } : {}),
          changes: entries.map((entry) => ({
            file: entry.file,
            staged: entry.code[0] !== " " && entry.code[0] !== "?",
            unstaged: entry.code[1] !== " ",
            untracked: entry.code === "??",
            ...(conflictCodes.has(entry.code) ? { conflicted: true } : {}),
          })),
          remote: yield* remote(current),
        } satisfies GitSchema.State
      }),
      stage: (input) =>
        write(
          Effect.gen(function* () {
            const files = yield* changedFiles("stage", (code) => code[1] !== " ", input.files)
            yield* withPaths("stage", ["add", "--all"], files)
          }),
        ),
      unstage: (input) =>
        write(
          Effect.gen(function* () {
            const files = yield* changedFiles("unstage", (code) => code[0] !== " " && code[0] !== "?", input.files)
            // Before the first commit there is no HEAD to restore from, so files leave the index instead.
            yield* withPaths(
              "unstage",
              (yield* hasHead()) ? ["restore", "--staged"] : ["rm", "--cached", "--quiet", "-r"],
              files,
            )
          }),
        ),
      discard: (input) =>
        write(
          Effect.gen(function* () {
            if (!safeFile(input.file)) return yield* new Error({ operation: "discard", message: "Invalid file path" })
            const entry = (yield* status("discard")).find((item) => item.file === input.file)
            if (!entry || entry.code[1] === " ")
              return yield* new Error({ operation: "discard", message: "The file has no unstaged changes" })
            // Only the unstaged part goes: untracked files are deleted, tracked ones return to their staged content.
            yield* withPaths("discard", entry.code === "??" ? ["clean", "--force"] : ["restore", "--worktree"], [
              input.file,
            ])
          }),
        ),
      commit: (input) =>
        write(
          Effect.gen(function* () {
            const message = input.message.trim()
            if (!message) return yield* new Error({ operation: "commit", message: "Write a commit message first" })
            if (input.all) yield* withPaths("commit", ["add", "--all"], yield* changedFiles("commit", (code) => code[1] !== " "))
            if (!(yield* status("commit")).some((entry) => entry.code[0] !== " " && entry.code[0] !== "?"))
              return yield* new Error({ operation: "commit", message: "There are no staged changes to commit" })
            const result = yield* run("commit", ["commit", "--cleanup=strip", "-m", message])
            return { output: result.output }
          }),
        ),
      message: Effect.fn("GitActions.message")(function* (input) {
        const summary = yield* stagedSummary(input.all === true)
        const text = yield* generate
          .text({ prompt: `${COMMIT_MESSAGE_PROMPT}\n\n${summary}`, ...(input.model ? { model: input.model } : {}) })
          .pipe(Effect.mapError((error) => new Error({ operation: "message", message: error.message })))
        const message = conventionalCommit(text)
        if (!message) return yield* new Error({ operation: "message", message: "The model did not write a commit message" })
        return { message }
      }),
      fetch: () =>
        run("fetch", ["fetch", "--all", "--prune"], { network: true }).pipe(Effect.map((result) => ({ output: result.output }))),
      push: Effect.fn("GitActions.push")(function* (input) {
        if (!input.setUpstream && !input.remote)
          return { output: (yield* run("push", ["push"], { network: true })).output }
        const current = yield* branch()
        if (!current || !(yield* hasHead()))
          return yield* new Error({ operation: "push", message: "Pushing needs a branch with at least one commit" })
        const name = yield* requireRemote("push", input.remote ?? "origin")
        const result = yield* run(
          "push",
          ["push", ...(input.setUpstream ? ["--set-upstream"] : []), "--", name, `refs/heads/${current}:refs/heads/${current}`],
          { network: true },
        )
        return { output: result.output }
      }),
      pull: (input) =>
        write(
          Effect.gen(function* () {
            if (!!input.remote !== !!input.branch)
              return yield* new Error({ operation: "pull", message: "Select both a remote and a branch" })
            if (input.remote) yield* requireRemote("pull", input.remote)
            if (input.branch?.startsWith("-")) return yield* new Error({ operation: "pull", message: "Invalid branch name" })
            if (input.branch) yield* run("pull", ["check-ref-format", `refs/heads/${input.branch}`])
            // Without an explicit strategy, defer to the user's pull.rebase and pull.ff configuration. An explicit
            // merge also allows a merge commit where pull.ff=only would refuse one.
            const result = yield* run(
              "pull",
              [
                "pull",
                "--no-autostash",
                ...(input.strategy === "rebase" ? ["--rebase"] : []),
                ...(input.strategy === "merge" ? ["--no-rebase", "--ff"] : []),
                "--no-edit",
                ...(input.remote && input.branch ? ["--", input.remote, `refs/heads/${input.branch}`] : []),
              ],
              { network: true },
            )
            return { output: result.output }
          }),
        ),
      targets,
      stashes,
      stashCreate: (input) =>
        write(
          run("stash-create", [
            "stash",
            "push",
            ...(input.includeUntracked ? ["--include-untracked"] : []),
            ...(input.message?.trim() ? ["--message", input.message.trim()] : []),
          ]).pipe(Effect.map((result) => ({ output: result.output }))),
        ),
      stashApply: (input) => stash("apply", input),
      stashPop: (input) => stash("pop", input),
      stashDrop: (input) => stash("drop", input),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, Git.node, AppProcess.node, Bus.node, Watcher.node, Generate.node],
})

const nonEmpty = (value: string) => value || undefined

// Plan files are the plan agent's notes, reviewed in the Plan tab, so they stay out of staging like the diff.
const isPlanFile = (file: string) => file.startsWith(`${ForgePlan.directory}/`)

const safeFile = (file: string) =>
  file.length > 0 &&
  file !== "." &&
  !file.includes("\0") &&
  !path.isAbsolute(file) &&
  !file.startsWith("\\") &&
  !file.split(/[\\/]/).includes("..")

/**
 * Keeps a commit-message prompt bounded for any commit size. The stat lists every file, and the patch budget is
 * shared fairly, so small files stay whole while huge ones such as lockfiles are cut down instead of crowding the
 * rest out.
 */
export function summarizeDiff(files: string, patch: string) {
  const chunks = splitGitPatch({ text: patch, truncated: false })
  const bySize = chunks.map((chunk, index) => ({ chunk, index })).toSorted((a, b) => a.chunk.length - b.chunk.length)
  const kept = bySize.reduce(
    (acc, item, position) => {
      const share = Math.floor(acc.left / (bySize.length - position))
      if (share < STAGED_PATCH_MIN_SHARE) return acc
      const text = item.chunk.length <= share ? item.chunk : `${item.chunk.slice(0, share)}\n[... diff truncated]\n`
      acc.parts[item.index] = text
      acc.left -= text.length
      return acc
    },
    { left: STAGED_PATCH_BUDGET, parts: [] as string[] },
  ).parts
  const omitted = chunks.length - kept.filter(Boolean).length
  return [
    "Changed files:",
    files,
    "",
    "Patch (large files truncated):",
    kept.filter(Boolean).join(""),
    omitted > 0 ? "[Some file diffs were omitted; rely on the file list above.]" : "",
  ]
    .filter(Boolean)
    .join("\n")
}

const COMMIT_TYPES = ["feat", "fix", "docs", "chore", "refactor", "test"]
const COMMIT_TYPE_ALIASES: Record<string, string> = {
  feature: "feat",
  bugfix: "fix",
  hotfix: "fix",
  doc: "docs",
  tests: "test",
  refactoring: "refactor",
  build: "chore",
  ci: "chore",
  style: "chore",
  perf: "refactor",
}
const CONVENTIONAL = new RegExp(`^(${COMMIT_TYPES.join("|")})(\\([a-z0-9._/-]+\\))?!?: \\S`)

const COMMIT_MESSAGE_PROMPT = `Write a commit message for these changes using Conventional Commits.

Subject format: \`type: summary\` or \`type(scope): summary\`
Allowed types:
- feat: new feature
- fix: bug fix
- docs: documentation changes
- chore: maintenance tasks
- refactor: code refactoring
- test: adding or updating tests

Subject rules:
- The scope is optional; when used, make it the lowercase name of the main affected package or area.
- The summary is imperative, starts lowercase, has no trailing period, and keeps the whole subject line under 72 characters.
- Describe the overall intent of the change, not a list of files.

Optional body:
- For a small or focused change, return only the subject line.
- When the changes include several substantial aspects that the subject cannot adequately convey, add a blank line followed by up to 5 bullet points.
- Judge complexity by distinct behaviors or concerns, not the number of changed files or lines.
- Start each bullet with \`- \` and describe a meaningful change or its purpose.
- Keep bullets concise, avoid repeating the subject, and combine closely related changes.
- Include only details supported by the changes; do not invent motivations, outcomes, or verification results.

Return only the commit message, with no surrounding quotes, code fences, or explanation.
Do not add signatures, author attribution, AI/model credits, "Generated by" notices, or Co-authored-by trailers.`

/**
 * Models sometimes wrap the answer in fences or prose, so this picks the first conforming subject and keeps only its
 * bullet body, coercing a bare summary into `chore:` when no subject matches the format.
 */
export function conventionalCommit(output: string) {
  const lines = output
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("```"))
    .map((line) =>
      line
        .trim()
        .replace(/^[`"'*]+|[`"'*]+$/g, "")
        .trim(),
    )
    .filter(Boolean)
  const index = Math.max(
    0,
    lines.findIndex((item) => CONVENTIONAL.test(item.toLowerCase())),
  )
  const line = lines[index]
  if (!line) return
  const match = /^([a-zA-Z]+)(\([^)]*\))?(!?):\s*(.+)$/.exec(line)
  const raw = match?.[1]?.toLowerCase() ?? ""
  const type = COMMIT_TYPE_ALIASES[raw] ?? raw
  const subject = (
    match && COMMIT_TYPES.includes(type)
      ? `${type}${match[2]?.toLowerCase() ?? ""}${match[3]}: ${match[4].replace(/\.$/, "")}`
      : `chore: ${line.charAt(0).toLowerCase()}${line.slice(1).replace(/\.$/, "")}`
  ).slice(0, 200)
  const body = lines.slice(index + 1)
  const end = body.findIndex((item) => !/^- \S/.test(item))
  const bullets = body
    .slice(0, end < 0 ? body.length : end)
    .filter(
      (item) =>
        !/^- (?:co-authored-by\s*:|(?:generated|authored|written|signed) (?:by|with)\b|(?:author|signature|ai(?:\/model)? credits)\s*:)/i.test(
          item,
        ),
    )
    .slice(0, 5)
  return bullets.length ? `${subject}\n\n${bullets.join("\n")}` : subject
}
