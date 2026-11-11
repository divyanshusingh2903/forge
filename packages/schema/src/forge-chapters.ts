export * as ForgeChapters from "./forge-chapters.js"

import { Schema } from "effect"
import { ForgePullRequests } from "./forge-pull-requests.js"
import { LinkPreview } from "./link-preview.js"
import { Rpc } from "./rpc.js"
import { optional } from "./schema.js"

/**
 * What started a chapter: the user pinning a message, a compaction, or the first mention of an issue or a pull
 * request. Only a pin can sit on a user message; the other two always sit on the agent's own message.
 */
export const Source = Schema.Literals(["pin", "compaction", "reference"])
export type Source = typeof Source.Type

export const Role = Schema.Literals(["user", "assistant"])
export type Role = typeof Role.Type

/**
 * A titled marker on one message of a Session. `turnMessageID` is the user message that opened the anchor's turn
 * (the anchor itself for a user message), which is what the transcript can scroll to.
 */
export interface Chapter extends Schema.Schema.Type<typeof Chapter> {}
export const Chapter = Schema.Struct({
  title: Schema.String,
  /** The message the chapter starts at. A message starts at most one chapter, so this is also the chapter's key. */
  anchorMessageID: Schema.String,
  turnMessageID: Schema.String,
  role: Role,
  source: Source,
  /** The key of the issue or pull request that started a `reference` chapter. */
  reference: optional(Schema.String),
  /** The user renamed it, so a looked-up title no longer replaces it. */
  renamed: optional(Schema.Boolean),
  createdAt: Schema.Number,
}).annotate({ identifier: "ForgeChapters.Chapter" })

/** An automatic chapter that waits for the agent's next message to anchor on. */
export interface Pending extends Schema.Schema.Type<typeof Pending> {}
export const Pending = Schema.Struct({
  source: Schema.Literals(["compaction", "reference"]),
  title: Schema.String,
  reference: optional(Schema.String),
  /** The user message that asked for it. Absent for a compaction until a user message follows. */
  turnMessageID: optional(Schema.String),
  /** That user message while it is still undelivered: the agent's messages before it are not its chapter. */
  waitFor: optional(Schema.String),
}).annotate({ identifier: "ForgeChapters.Pending" })

export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  /** In transcript order. */
  chapters: Schema.Array(Chapter),
  /** Keys of the issues and pull requests the Session already met, so a repeat starts no chapter. */
  seen: Schema.Array(Schema.String),
  pending: optional(Pending),
}).annotate({ identifier: "ForgeChapters.State" })

export const TITLE_MAX = 80

/**
 * A chapter title from free text: its first non-empty line, without the Markdown marks a reply opens or emphasises
 * with, trimmed and cut to `TITLE_MAX`.
 */
export function title(text: string) {
  const line =
    text
      .split(/\r?\n/)
      .map((part) =>
        part
          .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/, "")
          .replace(/\*\*|__|`/g, "")
          .trim(),
      )
      .find((part) => part.length > 0) ?? ""
  return line.length > TITLE_MAX ? line.slice(0, TITLE_MAX - 1).trimEnd() + "…" : line
}

/** One issue or pull request a message links. `key` dedupes it; `label` is its title until a lookup names it. */
export interface Reference {
  readonly key: string
  readonly label: string
  readonly preview: LinkPreview.Input
}

// Owners, projects and groups are made of these; anything else in a path is not a repository.
const segment = /^[\w.-]+$/
const number = /^[1-9]\d*$/

/**
 * The issue or pull request a URL points at, on github.com or gitlab.com: the hosts `LinkPreview` resolves. A bare
 * `#12` is not one, and neither is a URL with credentials or a port.
 */
export function reference(input: string): Reference | undefined {
  const request = ForgePullRequests.parse(input)
  if (request)
    return {
      key: ForgePullRequests.key(request),
      label: `${request.repository}#${request.number}`,
      preview: { kind: ForgePullRequests.kind(request), repository: request.repository, number: request.number },
    }

  const url = URL.parse(input.trim())
  if (url?.protocol !== "https:" || url.username || url.password || url.port) return undefined
  const segments = url.pathname.split("/").filter(Boolean)

  if (url.hostname === "github.com") {
    const [owner, repo, type, id] = segments
    if (!owner || !repo || !segment.test(owner) || !segment.test(repo)) return undefined
    if (type !== "issues" || !id || !number.test(id)) return undefined
    return issue("github", url.hostname, `${owner}/${repo}`, Number(id))
  }

  if (url.hostname === "gitlab.com") {
    const marker = segments.indexOf("-")
    const [type, id] = segments.slice(marker + 1)
    const path = segments.slice(0, marker)
    if (marker < 2 || !path.every((part) => segment.test(part))) return undefined
    // GitLab links issues as work items on newer instances.
    if ((type !== "issues" && type !== "work_items") || !id || !number.test(id)) return undefined
    return issue("gitlab", url.hostname, path.join("/"), Number(id))
  }

  return undefined
}

function issue(provider: "github" | "gitlab", host: string, repository: string, id: number): Reference {
  return {
    key: `${provider}-issue:${host}/${repository.toLowerCase()}#${id}`,
    label: `${repository}#${id}`,
    preview: { kind: provider === "github" ? "github-issue" : "gitlab-issue", repository, number: id },
  }
}

/** Every issue and pull request linked in a text, in order and without repeats. */
export function references(text: string) {
  const found = (text.match(/https:\/\/[^\s<>()"'`\]]+/g) ?? []).flatMap((link) => {
    const item = reference(link.replace(/[.,;:!?]+$/, ""))
    return item ? [item] : []
  })
  return found.filter((item, index) => found.findIndex((other) => other.key === item.key) === index)
}

/**
 * The plugin's RPC. Clients read a Session's chapters with `list` and keep them current from `changed`, which the
 * plugin publishes in the Session's Location on every write. `pin` is the user's path and takes any message; the
 * chapters Forge starts by itself never go through it. A Session's chapters are its own: children and forks start
 * without any. The schemas are Standard Schemas too, so Promise clients can call it.
 */
export const Definition = Rpc.define({
  id: "forge.chapters",
  methods: {
    list: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })),
      output: Schema.toStandardSchemaV1(State),
    },
    pin: {
      input: Schema.toStandardSchemaV1(
        Schema.Struct({
          sessionID: Schema.String,
          messageID: Schema.String,
          turnMessageID: Schema.String,
          role: Role,
          title: Schema.String,
        }),
      ),
      output: Schema.toStandardSchemaV1(State),
    },
    rename: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, messageID: Schema.String, title: Schema.String })),
      output: Schema.toStandardSchemaV1(State),
    },
    remove: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, messageID: Schema.String })),
      output: Schema.toStandardSchemaV1(State),
    },
  },
  events: {
    changed: {
      schema: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, state: State })),
    },
  },
})
