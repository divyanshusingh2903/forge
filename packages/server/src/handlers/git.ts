import { GitActions } from "@opencode/core/git-actions"
import { GitOperationError } from "@opencode/protocol/groups/git"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, response } from "../location"

const empty = {}

export const GitHandler = HttpApiBuilder.group(Api, "server.git", (handlers) =>
  Effect.gen(function* () {
    const run = <A>(operation: (git: GitActions.Interface) => Effect.Effect<A, GitActions.Error>) =>
      response(
        Effect.gen(function* () {
          const git = yield* GitActions.Service
          return yield* operation(git).pipe(
            Effect.mapError((error) => new GitOperationError({ operation: error.operation, message: error.message })),
          )
        }),
      )
    return handlers
      .handle("git.state", () => run((git) => git.state()))
      .handle("git.stage", (ctx) => run((git) => git.stage(ctx.payload).pipe(Effect.as(empty))))
      .handle("git.unstage", (ctx) => run((git) => git.unstage(ctx.payload).pipe(Effect.as(empty))))
      .handle("git.discard", (ctx) => run((git) => git.discard(ctx.payload).pipe(Effect.as(empty))))
      .handle("git.commit", (ctx) => run((git) => git.commit(ctx.payload)))
      .handle("git.message", (ctx) =>
        // Writing needs the Location's models, which a cold Location registers with its plugins.
        awaitPlugins.pipe(
          Effect.mapError((error) => new GitOperationError({ operation: "message", message: error.message })),
          Effect.andThen(run((git) => git.message(ctx.payload))),
        ),
      )
      .handle("git.fetch", () => run((git) => git.fetch()))
      .handle("git.push", (ctx) => run((git) => git.push(ctx.payload)))
      .handle("git.pull", (ctx) => run((git) => git.pull(ctx.payload)))
      .handle("git.targets", () => run((git) => git.targets()))
      .handle("git.stash.list", () => run((git) => git.stashes()))
      .handle("git.stash.create", (ctx) => run((git) => git.stashCreate(ctx.payload)))
      .handle("git.stash.apply", (ctx) => run((git) => git.stashApply(ctx.payload)))
      .handle("git.stash.pop", (ctx) => run((git) => git.stashPop(ctx.payload)))
      .handle("git.stash.drop", (ctx) => run((git) => git.stashDrop(ctx.payload)))
  }),
)
