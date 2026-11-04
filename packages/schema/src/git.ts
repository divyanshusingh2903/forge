export * as Git from "./git.js"

import { Schema } from "effect"
import { Event } from "./event.js"
import { Ref } from "./model.js"
import { NonNegativeInt, optional } from "./schema.js"

/** A file's place in the index and working tree, as the review panel's staging checkboxes show it. */
export const Change = Schema.Struct({
  file: Schema.String,
  staged: Schema.Boolean,
  unstaged: Schema.Boolean,
  untracked: Schema.Boolean,
  conflicted: optional(Schema.Boolean),
}).annotate({ identifier: "Git.Change" })
export interface Change extends Schema.Schema.Type<typeof Change> {}

export const Upstream = Schema.Struct({ remote: Schema.String, branch: Schema.String }).annotate({
  identifier: "Git.Upstream",
})
export interface Upstream extends Schema.Schema.Type<typeof Upstream> {}

export const Remote = Schema.Struct({
  /** Whether the branch tracks an upstream branch. */
  upstream: Schema.Boolean,
  /** Commits a push would publish: ahead of the upstream, or not on any remote when there is none. */
  ahead: NonNegativeInt,
  behind: NonNegativeInt,
  target: optional(Upstream),
  /** Whether the repository has any remote, so there is somewhere to push. */
  remotes: Schema.Boolean,
}).annotate({ identifier: "Git.Remote" })
export interface Remote extends Schema.Schema.Type<typeof Remote> {}

/** The current branch, its changes and its remote state, read together so the panel never mixes two moments. */
export const State = Schema.Struct({
  branch: optional(Schema.String),
  changes: Schema.Array(Change),
  remote: Remote,
}).annotate({ identifier: "Git.State" })
export interface State extends Schema.Schema.Type<typeof State> {}

export const Targets = Schema.Struct({
  remotes: Schema.Array(Schema.String),
  branches: Schema.Array(Upstream),
  /** The strategy `git pull` uses for the current branch when none is passed. */
  pull: Schema.Literals(["merge", "rebase"]),
}).annotate({ identifier: "Git.Targets" })
export interface Targets extends Schema.Schema.Type<typeof Targets> {}

export const FilesInput = Schema.Struct({
  /** Repository-relative paths; omitted means every changed file. */
  files: optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "Git.FilesInput" })
export interface FilesInput extends Schema.Schema.Type<typeof FilesInput> {}

export const DiscardInput = Schema.Struct({ file: Schema.String }).annotate({ identifier: "Git.DiscardInput" })
export interface DiscardInput extends Schema.Schema.Type<typeof DiscardInput> {}

export const CommitInput = Schema.Struct({
  message: Schema.String,
  /** Stage every change, untracked files included, before committing. */
  all: optional(Schema.Boolean),
}).annotate({ identifier: "Git.CommitInput" })
export interface CommitInput extends Schema.Schema.Type<typeof CommitInput> {}

export const MessageInput = Schema.Struct({
  /** The model to write with, usually the session's; omitted uses the default model. */
  model: optional(Ref),
  /** Summarize every change rather than only staged ones, for "Commit all". */
  all: optional(Schema.Boolean),
}).annotate({ identifier: "Git.MessageInput" })
export interface MessageInput extends Schema.Schema.Type<typeof MessageInput> {}

export const Message = Schema.Struct({ message: Schema.String }).annotate({ identifier: "Git.Message" })
export interface Message extends Schema.Schema.Type<typeof Message> {}

export const PushInput = Schema.Struct({
  remote: optional(Schema.String),
  setUpstream: optional(Schema.Boolean),
}).annotate({ identifier: "Git.PushInput" })
export interface PushInput extends Schema.Schema.Type<typeof PushInput> {}

export const PullInput = Schema.Struct({
  remote: optional(Schema.String),
  branch: optional(Schema.String),
  strategy: optional(Schema.Literals(["merge", "rebase"])),
}).annotate({ identifier: "Git.PullInput" })
export interface PullInput extends Schema.Schema.Type<typeof PullInput> {}

export const StashCreateInput = Schema.Struct({
  message: optional(Schema.String),
  includeUntracked: optional(Schema.Boolean),
}).annotate({ identifier: "Git.StashCreateInput" })
export interface StashCreateInput extends Schema.Schema.Type<typeof StashCreateInput> {}

/** A stash named both by position and by object ID, so a stack that changed meanwhile is caught. */
export const StashInput = Schema.Struct({
  ref: Schema.String.check(Schema.isPattern(/^stash@\{\d+\}$/)),
  oid: Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)),
}).annotate({ identifier: "Git.StashInput" })
export interface StashInput extends Schema.Schema.Type<typeof StashInput> {}

export const Stash = Schema.Struct({
  ...StashInput.fields,
  message: Schema.String,
  createdAt: Schema.Finite,
}).annotate({ identifier: "Git.Stash" })
export interface Stash extends Schema.Schema.Type<typeof Stash> {}

export const Output = Schema.Struct({ output: Schema.String }).annotate({ identifier: "Git.Output" })
export interface Output extends Schema.Schema.Type<typeof Output> {}

export const Operation = Schema.Literals([
  "state",
  "stage",
  "unstage",
  "discard",
  "commit",
  "message",
  "fetch",
  "push",
  "pull",
  "targets",
  "stash-list",
  "stash-create",
  "stash-apply",
  "stash-pop",
  "stash-drop",
])
export type Operation = typeof Operation.Type

/** The index, refs, HEAD or stash changed, from Forge or from anywhere else, such as a terminal. */
export const Changed = Event.ephemeral({ type: "git.changed", schema: {} })

export const Definitions = Event.inventory(Changed)
