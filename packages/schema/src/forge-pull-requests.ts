export * as ForgePullRequests from "./forge-pull-requests.js"

import { Schema } from "effect"
import { LinkPreview } from "./link-preview.js"
import { Rpc } from "./rpc.js"
import { optional } from "./schema.js"

export const Provider = Schema.Literals(["github", "gitlab"])
export type Provider = typeof Provider.Type

/**
 * One pull or merge request. `repository` is `owner/repo` on GitHub and the full project path on GitLab, the same
 * values `LinkPreview.Input` takes.
 */
export interface Identity extends Schema.Schema.Type<typeof Identity> {}
export const Identity = Schema.Struct({
  provider: Provider,
  host: Schema.String,
  repository: Schema.String,
  number: Schema.Int.check(Schema.isGreaterThan(0)),
}).annotate({ identifier: "ForgePullRequests.Identity" })

/**
 * Where an item came from. Only the agent creating a pull request or the user asking to track one adds an item; a
 * URL that is merely mentioned never does.
 */
export const Source = Schema.Literals(["created", "requested"])
export type Source = typeof Source.Type

/**
 * The CI auto-fix of one item. `fixing` means a fix prompt was sent for `handledSha` and CI has not finished again;
 * `paused` means the user interrupted that run or it failed, and nothing more is sent until the user resumes;
 * `exhausted` means `MAX_ATTEMPTS` fixes did not turn CI green.
 */
export interface AutoFix extends Schema.Schema.Type<typeof AutoFix> {}
export const AutoFix = Schema.Struct({
  enabled: Schema.Boolean,
  state: Schema.Literals(["idle", "fixing", "paused", "exhausted"]),
  /** Fix prompts sent since CI was last fully green. */
  attempts: Schema.Number,
  /** The head revision whose failure was last handed to the agent. */
  handledSha: optional(Schema.String),
}).annotate({ identifier: "ForgePullRequests.AutoFix" })

export const MAX_ATTEMPTS = 3

/** Why the last refresh failed. The previous `status` stays beside it, so a failed refresh never reads as green. */
export const FailureKind = Schema.Literals(["unavailable", "forbidden", "not-found"])
export type FailureKind = typeof FailureKind.Type

export interface Item extends Schema.Schema.Type<typeof Item> {}
export const Item = Schema.Struct({
  identity: Identity,
  url: Schema.String,
  source: Source,
  trackedAt: Schema.Number,
  /** The last successful lookup. Absent until the first one lands. */
  status: optional(LinkPreview.Result),
  /** When `status` was fetched. */
  checkedAt: optional(Schema.Number),
  /** The failure of the latest refresh, cleared by the next success. */
  failure: optional(FailureKind),
  /** Why it failed, when the code host said: not signed in, rate-limited, or a temporary error. */
  reason: optional(Schema.Literals(["authentication", "rate-limit", "temporary"])),
  /** When the failing refresh was made, used to back off. */
  failedAt: optional(Schema.Number),
  /** Consecutive failed refreshes. */
  failures: optional(Schema.Number),
  autoFix: AutoFix,
}).annotate({ identifier: "ForgePullRequests.Item" })

export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  items: Schema.Array(Item),
}).annotate({ identifier: "ForgePullRequests.State" })

/** The dedupe key of an item: `github:github.com/owner/repo#12`. Hosts and repository paths are case-insensitive. */
export function key(identity: Identity) {
  return `${identity.provider}:${identity.host}/${identity.repository.toLowerCase()}#${identity.number}`
}

/** The `LinkPreview` kind that resolves the item. */
export function kind(identity: Identity): LinkPreview.Kind {
  return identity.provider === "github" ? "github-pr" : "gitlab-mr"
}

/** The item's own page. */
export function href(identity: Identity) {
  return identity.provider === "github"
    ? `https://${identity.host}/${identity.repository}/pull/${identity.number}`
    : `https://${identity.host}/${identity.repository}/-/merge_requests/${identity.number}`
}

/** Merged and closed items are inspectable but no longer refreshed. */
export function finished(item: Item) {
  const state = item.status?.state
  return state === "merged" || state === "closed"
}

/**
 * Whether auto-fix can ever do anything for an item: it must still be open and must exist. A merged or closed request
 * has nothing left to fix, and one the code host does not know has no CI to follow.
 */
export function canAutoFix(item: Item) {
  return !finished(item) && item.failure !== "not-found"
}

// Owners, projects and groups are made of these; anything else in a path is not a repository.
const segment = /^[\w.-]+$/

/**
 * The pull or merge request a URL points at, when it is a github.com pull request or a gitlab.com merge request:
 * the hosts `LinkPreview` resolves. Anything else, including a link to an issue or a commit, is not one, and neither
 * is a URL with credentials or a port. A page of the request (`/files`, `/checks`) still names it.
 */
export function parse(input: string): Identity | undefined {
  const url = URL.parse(input.trim())
  if (url?.protocol !== "https:" || url.username || url.password || url.port) return undefined
  const segments = url.pathname.split("/").filter(Boolean)

  if (url.hostname === "github.com") {
    const [owner, repo, type, number] = segments
    if (!owner || !repo || !segment.test(owner) || !segment.test(repo)) return undefined
    if (type !== "pull" || !number || !/^[1-9]\d*$/.test(number)) return undefined
    return { provider: "github", host: url.hostname, repository: `${owner}/${repo}`, number: Number(number) }
  }

  if (url.hostname === "gitlab.com") {
    const marker = segments.indexOf("-")
    const [type, number] = segments.slice(marker + 1)
    const path = segments.slice(0, marker)
    if (marker < 2 || !path.every((part) => segment.test(part))) return undefined
    if (type !== "merge_requests" || !number || !/^[1-9]\d*$/.test(number)) return undefined
    return { provider: "gitlab", host: url.hostname, repository: path.join("/"), number: Number(number) }
  }

  return undefined
}

/**
 * The plugin's RPC. Clients read a Session's items with `list` and keep them current from `changed`, which the plugin
 * publishes in the Session's Location on every write. A Session's items are its own: children and forks start
 * without any. The schemas are Standard Schemas too, so Promise clients can call it.
 */
export const Definition = Rpc.define({
  id: "forge.pull-requests",
  methods: {
    list: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })),
      output: Schema.toStandardSchemaV1(State),
    },
    track: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, url: Schema.String })),
      output: Schema.toStandardSchemaV1(
        Schema.Struct({ outcome: Schema.Literals(["tracked", "exists", "unsupported"]), state: State }),
      ),
    },
    untrack: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, key: Schema.String })),
      output: Schema.toStandardSchemaV1(State),
    },
    refresh: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, key: Schema.optionalKey(Schema.String) })),
      output: Schema.toStandardSchemaV1(State),
    },
    autoFix: {
      input: Schema.toStandardSchemaV1(
        Schema.Struct({ sessionID: Schema.String, key: Schema.String, enabled: Schema.Boolean }),
      ),
      output: Schema.toStandardSchemaV1(State),
    },
  },
  events: {
    changed: {
      schema: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, state: State })),
    },
  },
})
