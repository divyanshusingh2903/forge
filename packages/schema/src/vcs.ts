export * as Vcs from "./vcs"

import { Schema } from "effect"
import { optional } from "./schema"

export interface Upstream extends Schema.Schema.Type<typeof Upstream> {}
export const Upstream = Schema.Struct({ remote: Schema.String, branch: Schema.String }).annotate({
  identifier: "Vcs.Upstream",
})

export interface Targets extends Schema.Schema.Type<typeof Targets> {}
export const Targets = Schema.Struct({
  remotes: Schema.Array(Schema.String),
  branches: Schema.Array(Upstream),
  // The strategy `git pull` uses for the current branch when none is passed.
  pull: optional(Schema.Literals(["merge", "rebase"])),
}).annotate({ identifier: "Vcs.Targets" })

export interface PushInput extends Schema.Schema.Type<typeof PushInput> {}
export const PushInput = Schema.Struct({
  remote: optional(Schema.String),
  setUpstream: optional(Schema.Boolean),
}).annotate({ identifier: "Vcs.PushInput" })

export interface PullInput extends Schema.Schema.Type<typeof PullInput> {}
export const PullInput = Schema.Struct({
  remote: optional(Schema.String),
  branch: optional(Schema.String),
  strategy: optional(Schema.Literals(["merge", "rebase"])),
}).annotate({ identifier: "Vcs.PullInput" })

export interface StashCreateInput extends Schema.Schema.Type<typeof StashCreateInput> {}
export const StashCreateInput = Schema.Struct({
  message: optional(Schema.String),
  includeUntracked: optional(Schema.Boolean),
}).annotate({ identifier: "Vcs.StashCreateInput" })

export interface StashInput extends Schema.Schema.Type<typeof StashInput> {}
export const StashInput = Schema.Struct({
  ref: Schema.String.check(Schema.isPattern(/^stash@\{\d+\}$/)),
  oid: Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)),
}).annotate({ identifier: "Vcs.StashInput" })

export interface Stash extends Schema.Schema.Type<typeof Stash> {}
export const Stash = Schema.Struct({ ...StashInput.fields, message: Schema.String, createdAt: Schema.Finite }).annotate(
  { identifier: "Vcs.Stash" },
)

export interface OperationResult extends Schema.Schema.Type<typeof OperationResult> {}
export const OperationResult = Schema.Struct({ success: Schema.Boolean, output: Schema.String }).annotate({
  identifier: "Vcs.OperationResult",
})
