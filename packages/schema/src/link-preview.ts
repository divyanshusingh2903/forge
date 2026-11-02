export * as LinkPreview from "./link-preview.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export const Kind = Schema.Literals([
  "github-issue",
  "github-pr",
  "github-release",
  "gitlab-issue",
  "gitlab-mr",
  "linear-issue",
  "linear-project",
  "jira-issue",
]).annotate({ identifier: "LinkPreview.Kind" })
export type Kind = typeof Kind.Type

/**
 * One issue tracker or code host item. `repository` is `owner/repo` on GitHub and the full project path on GitLab;
 * `id` is a Linear identifier or slug, or a Jira issue key on the Atlassian `site`.
 */
export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Input = Schema.Struct({
  kind: Kind,
  repository: Schema.String.pipe(optional),
  number: Schema.Int.check(Schema.isGreaterThan(0)).pipe(optional),
  tag: Schema.String.pipe(optional),
  id: Schema.String.pipe(optional),
  site: Schema.String.pipe(optional),
}).annotate({ identifier: "LinkPreview.Input" })

const Person = Schema.Struct({ name: Schema.String, avatarUrl: Schema.String.pipe(optional) })
const Label = Schema.Struct({ name: Schema.String, color: Schema.String.pipe(optional) })

/**
 * `unavailable` covers a missing CLI or MCP connection and transient failures; `forbidden` is a private or
 * unauthorised item. Only `ok` carries details, and each provider fills just the fields it has. `state` is
 * open/closed/merged/draft/not-planned (issues, pull and merge requests), draft/prerelease/release (releases) or the
 * workflow status name (Linear, Jira), with `stateType` giving the coarse category used for colour.
 */
export interface Result extends Schema.Schema.Type<typeof Result> {}
export const Result = Schema.Struct({
  outcome: Schema.Literals(["ok", "unavailable", "forbidden", "not-found"]),
  title: Schema.String.pipe(optional),
  state: Schema.String.pipe(optional),
  stateType: Schema.String.pipe(optional),
  identifier: Schema.String.pipe(optional),
  summary: Schema.String.pipe(optional),
  author: Person.pipe(optional),
  labels: Schema.Array(Label).pipe(optional),
  createdAt: Schema.String.pipe(optional),
  updatedAt: Schema.String.pipe(optional),
  closedAt: Schema.String.pipe(optional),
  mergedAt: Schema.String.pipe(optional),
  publishedAt: Schema.String.pipe(optional),
  comments: Schema.Finite.pipe(optional),
  head: Schema.String.pipe(optional),
  base: Schema.String.pipe(optional),
  additions: Schema.Finite.pipe(optional),
  deletions: Schema.Finite.pipe(optional),
  changedFiles: Schema.Finite.pipe(optional),
  tag: Schema.String.pipe(optional),
  assets: Schema.Finite.pipe(optional),
  downloads: Schema.Finite.pipe(optional),
  priority: Schema.String.pipe(optional),
  assignee: Schema.String.pipe(optional),
  project: Schema.String.pipe(optional),
  team: Schema.String.pipe(optional),
  issueType: Schema.String.pipe(optional),
  startDate: Schema.String.pipe(optional),
  targetDate: Schema.String.pipe(optional),
  initiatives: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "LinkPreview.Result" })
