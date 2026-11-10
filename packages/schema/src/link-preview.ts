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
  "notion-page",
]).annotate({ identifier: "LinkPreview.Kind" })
export type Kind = typeof Kind.Type

/**
 * One issue tracker or code host item. `repository` is `owner/repo` on GitHub and the full project path on GitLab;
 * `id` is a Linear identifier or slug, a Jira issue key on the Atlassian `site`, or a Notion page's 32-hex ID.
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
const Field = Schema.Struct({ name: Schema.String, value: Schema.String })

/**
 * Direct sub-issue progress. `unavailable` means the provider did not say, which is never the same as no children or
 * all done; `partial` means the counts are a lower bound. An issue without children carries no progress at all.
 */
const Progress = Schema.Struct({
  status: Schema.Literals(["ok", "unavailable"]),
  completed: Schema.Finite,
  cancelled: Schema.Finite,
  open: Schema.Finite,
  total: Schema.Finite,
  partial: Schema.Boolean,
})

/**
 * CI results for a pull or merge request's head revision. `unit` says what is counted: only a provider test report
 * counts `tests`, while GitHub check runs and GitLab jobs are `checks` and `jobs`. `none` is no CI for this head, and
 * `complete: false` marks counts that stop short of what the provider holds.
 */
const Ci = Schema.Struct({
  status: Schema.Literals(["ok", "none", "unavailable", "forbidden"]),
  unit: Schema.Literals(["tests", "checks", "jobs"]),
  passed: Schema.Finite,
  failed: Schema.Finite,
  pending: Schema.Finite,
  skipped: Schema.Finite,
  cancelled: Schema.Finite,
  total: Schema.Finite,
  complete: Schema.Boolean,
  sha: Schema.String.pipe(optional),
  failures: Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.String.pipe(optional) })),
})

/**
 * `unavailable` covers a missing CLI or MCP connection and transient failures; `forbidden` is a private or
 * unauthorised item. Only `ok` carries details, and each provider fills just the fields it has. `state` is
 * open/closed/merged/draft/not-planned (issues, pull and merge requests), draft/prerelease/release (releases) or the
 * workflow status name (Linear, Jira, a Notion Status property), with `stateType` giving the coarse category used for
 * colour. `path`, `icon` and `fields` describe a Notion page: where it sits, its emoji, and its other properties.
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
  path: Schema.String.pipe(optional),
  icon: Schema.String.pipe(optional),
  fields: Schema.Array(Field).pipe(optional),
  progress: Progress.pipe(optional),
  ci: Ci.pipe(optional),
}).annotate({ identifier: "LinkPreview.Result" })
