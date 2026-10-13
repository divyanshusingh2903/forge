export * as Watcher from "./watcher"

// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import type ParcelWatcher from "@parcel/watcher"
import { makeLocationNode } from "../effect/app-node"
import { Cause, Context, Effect, Layer } from "effect"
import { FileSystemWatcher } from "@opencode-ai/schema/filesystem-watcher"
import path from "path"
import { Config } from "../config"
import { EventV2 } from "../event"
import { Flag } from "../flag/flag"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { Location } from "../location"
import { lazy } from "../util/lazy"
import { Ignore } from "./ignore"
import { Protected } from "./protected"
import { VcsWatch } from "./vcs-watch"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"
import { RelativePath } from "../schema"

declare const OPENCODE_LIBC: string | undefined

const SUBSCRIBE_TIMEOUT_MS = 10_000

export const Event = FileSystemWatcher.Event

const watcher = lazy((): typeof import("@parcel/watcher") | undefined => {
  try {
    const libc = typeof OPENCODE_LIBC === "undefined" ? undefined : OPENCODE_LIBC
    const binding = require(
      `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${libc || "glibc"}` : ""}`,
    )
    return createWrapper(binding) as typeof import("@parcel/watcher")
  } catch {
    return
  }
})

function getBackend() {
  if (process.platform === "win32") return "windows"
  if (process.platform === "darwin") return "fs-events"
  if (process.platform === "linux") return "inotify"
}

function protecteds(dir: string) {
  return Protected.paths().filter((item) => {
    const relative = path.relative(dir, item)
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  })
}

export const hasNativeBinding = () => !!watcher()

export interface Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileWatcher") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    if (yield* Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER) return Service.of({})

    const backend = getBackend()
    const location = yield* Location.Service
    if (!backend) {
      yield* Effect.logError("watcher backend not supported", {
        directory: location.directory,
        platform: process.platform,
      })
      return Service.of({})
    }

    const w = watcher()
    if (!w) return Service.of({})

    yield* Effect.logInfo("watcher backend", { directory: location.directory, platform: process.platform, backend })
    const events = yield* EventV2.Service
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const context = yield* Effect.context()
    const runFork = Effect.runForkWith(context)
    const subscriptions: ParcelWatcher.AsyncSubscription[] = []
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => Promise.allSettled(subscriptions.map((subscription) => subscription.unsubscribe()))),
    )

    const callback: ParcelWatcher.SubscribeCallback = (_error, updates) => {
      for (const update of updates) {
        if (update.type === "create") runFork(events.publish(Event.Updated, { file: update.path, event: "add" }))
        if (update.type === "update") runFork(events.publish(Event.Updated, { file: update.path, event: "change" }))
        if (update.type === "delete") runFork(events.publish(Event.Updated, { file: update.path, event: "unlink" }))
      }
    }

    const subscribe = (directory: string, ignore: string[], onUpdate = callback) => {
      const pending = w.subscribe(directory, onUpdate, { ignore, backend })
      return Effect.promise(() => pending).pipe(
        Effect.tap((subscription) => Effect.sync(() => subscriptions.push(subscription))),
        Effect.timeout(SUBSCRIBE_TIMEOUT_MS),
        Effect.catchCause((cause) => {
          pending.then((subscription) => subscription.unsubscribe()).catch(() => {})
          return Effect.logError("failed to subscribe", { directory, cause: Cause.pretty(cause) })
        }),
      )
    }

    const configService = yield* Config.Service
    const config = (yield* configService.entries())
      .filter((entry): entry is Config.Document => entry.type === "document")
      .flatMap((item) => item.info.watcher?.ignore ?? [])
    const generic = yield* Flag.OPENCODE_EXPERIMENTAL_FILEWATCHER
    if (location.vcs && generic && location.vcs.type !== "git") {
      yield* Effect.forkScoped(
        subscribe(location.directory, [...Ignore.PATTERNS, ...config, ...protecteds(location.directory)]),
      )
    }

    if (location.vcs?.type === "git") {
      const repository = yield* git.repo.discover(location.directory)
      if (!repository) {
        if (generic)
          yield* Effect.forkScoped(
            subscribe(location.directory, [...Ignore.PATTERNS, ...config, ...protecteds(location.directory)]),
          )
        return Service.of({})
      }
      const paths = new Set<RelativePath>()
      const dirty = { metadata: false }
      const notify = yield* VcsWatch.coalesce(() =>
        Effect.gen(function* () {
          const files = Array.from(paths)
          paths.clear()
          const metadata = dirty.metadata
          dirty.metadata = false
          if (metadata || files.some((file) => file.endsWith(".gitignore"))) yield* refreshWorktree()
          const ignored = yield* git.index
            .ignored({ repository, paths: files, tracked: true })
            .pipe(Effect.catch(() => Effect.succeed(new Set<RelativePath>())))
          if (ignored.size && !metadata) yield* refreshWorktree()
          if (metadata || files.some((file) => !ignored.has(file))) yield* events.publish(VcsEvent.Changed, {})
        }),
      )
      const worktreeCallback: ParcelWatcher.SubscribeCallback = (error, updates) => {
        if (error) return runFork(Effect.logError("working-tree watcher failed", { error }))
        const relevant = updates.filter((update) => {
          const file = path.relative(repository.worktree, update.path)
          if (!file || file.startsWith("../") || path.isAbsolute(file)) return false
          paths.add(RelativePath.make(file))
          return true
        })
        if (generic)
          callback(
            null,
            relevant.filter((update) => {
              const relative = path.relative(location.directory, update.path)
              return !relative.startsWith("../") && !path.isAbsolute(relative) && !Ignore.match(relative)
            }),
          )
        if (relevant.length) notify()
      }
      const root: { subscription?: ParcelWatcher.AsyncSubscription; ignores?: string } = {}
      const refreshWorktree = Effect.fn("Watcher.refreshWorktree")(function* () {
        // Prune Git-ignored directories, but never a directory containing tracked files.
        // Recompute after index/ignore changes so force-added files become observable.
        const ignored = yield* git.index.watchIgnores(repository).pipe(Effect.catch(() => Effect.succeed([])))
        const list = [".git", ...ignored, ...config, ...protecteds(repository.worktree)].toSorted()
        const signature = JSON.stringify(list)
        if (root.subscription && root.ignores === signature) return
        const next = yield* subscribe(repository.worktree, list, worktreeCallback)
        if (!next) return
        const previous = root.subscription
        root.subscription = next
        root.ignores = signature
        if (!previous) return
        const index = subscriptions.indexOf(previous)
        if (index >= 0) subscriptions.splice(index, 1)
        yield* Effect.promise(() => previous.unsubscribe())
      })
      // Subscribing walks the whole worktree, so keep it off the Location boot path. Clients that
      // read status before the watchers were ready are told to re-read once they are.
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          yield* refreshWorktree()
          const roots = yield* Effect.forEach(
            Array.from(new Set([repository.gitDirectory, repository.commonDirectory])),
            (directory) =>
              fs.realPath(directory).pipe(
                Effect.catch(() => Effect.succeed(directory)),
                Effect.map((resolved) => ({ directory, resolved })),
              ),
          )
          yield* Effect.forEach(
            roots.filter((root, index) => roots.findIndex((value) => value.resolved === root.resolved) === index),
            (root) => {
              if (config.includes(".git") || config.includes(root.directory) || config.includes(root.resolved))
                return Effect.void
              const sharedOnly = root.directory !== repository.gitDirectory
              return subscribe(root.resolved, ["objects", "worktrees", "hooks", "logs/HEAD"], (error, updates) => {
                if (error) return runFork(Effect.logError("Git watcher failed", { error }))
                const relevant = updates.filter((update) =>
                  VcsWatch.metadata(path.relative(root.resolved, update.path), sharedOnly),
                )
                // Preserve compatibility consumers of the ordinary HEAD notification.
                callback(
                  null,
                  relevant.filter((update) => path.relative(root.resolved, update.path) === "HEAD"),
                )
                if (!relevant.length) return
                dirty.metadata = true
                notify()
              })
            },
            { concurrency: "unbounded" },
          )
          yield* events.publish(VcsEvent.Changed, {})
        }),
      )
    }

    return Service.of({})
  }).pipe(
    Effect.catchCause((cause) => {
      return Effect.logError("failed to init watcher service", { cause: Cause.pretty(cause) }).pipe(
        Effect.as(Service.of({})),
      )
    }),
  ),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Location.node, Config.node, Git.node, EventV2.node],
})
