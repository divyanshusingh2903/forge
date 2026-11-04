import { Git } from "@opencode/schema/git"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

/** A Git command refused or failed; `message` carries Git's own explanation, such as a rejected push. */
export class GitOperationError extends Schema.TaggedError<GitOperationError>()(
  "GitOperationError",
  { operation: Git.Operation, message: Schema.String },
  { httpApiStatus: 409 },
) {}

const get = <const Name extends string, const Path extends `/${string}`, S extends Schema.Top>(
  name: Name,
  route: Path,
  success: S,
  summary: string,
) =>
  HttpApiEndpoint.get(name, route, {
    query: LocationQuery,
    success: Location.response(success),
    error: GitOperationError,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(OpenApi.annotations({ identifier: name, summary }))

const post = <const Name extends string, const Path extends `/${string}`, P extends Schema.Top, S extends Schema.Top>(
  name: Name,
  route: Path,
  payload: P,
  success: S,
  summary: string,
) =>
  HttpApiEndpoint.post(name, route, {
    query: LocationQuery,
    payload,
    success: Location.response(success),
    error: GitOperationError,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(OpenApi.annotations({ identifier: name, summary }))

const Empty = Schema.Struct({})

export const GitGroup = HttpApiGroup.make("server.git")
  .add(get("git.state", "/api/git/state", Git.State, "Branch, staged and unstaged changes, and remote state"))
  .add(post("git.stage", "/api/git/stage", Git.FilesInput, Empty, "Stage files, or every change"))
  .add(post("git.unstage", "/api/git/unstage", Git.FilesInput, Empty, "Unstage files, or every staged change"))
  .add(post("git.discard", "/api/git/discard", Git.DiscardInput, Empty, "Discard a file's unstaged changes"))
  .add(post("git.commit", "/api/git/commit", Git.CommitInput, Git.Output, "Commit staged changes"))
  .add(post("git.message", "/api/git/message", Git.MessageInput, Git.Message, "Write a commit message with a model"))
  .add(post("git.fetch", "/api/git/fetch", Empty, Git.Output, "Fetch every remote"))
  .add(post("git.push", "/api/git/push", Git.PushInput, Git.Output, "Push the current branch"))
  .add(post("git.pull", "/api/git/pull", Git.PullInput, Git.Output, "Pull into the current branch"))
  .add(get("git.targets", "/api/git/targets", Git.Targets, "Remotes and remote branches to push or pull"))
  .add(get("git.stash.list", "/api/git/stash", Schema.Array(Git.Stash), "List stashes"))
  .add(post("git.stash.create", "/api/git/stash", Git.StashCreateInput, Git.Output, "Stash the working tree"))
  .add(post("git.stash.apply", "/api/git/stash/apply", Git.StashInput, Git.Output, "Apply a stash and keep it"))
  .add(post("git.stash.pop", "/api/git/stash/pop", Git.StashInput, Git.Output, "Apply a stash and drop it"))
  .add(post("git.stash.drop", "/api/git/stash/drop", Git.StashInput, Git.Output, "Drop a stash"))
  .annotateMerge(
    OpenApi.annotations({
      title: "git",
      description:
        "Location-scoped Git actions for the review panel: staging, commits, remotes and stashes. Every change to the repository, from Forge or elsewhere, is announced by the ephemeral `git.changed` event while the state is being read.",
    }),
  )
