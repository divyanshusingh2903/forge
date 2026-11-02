export * as LinkPreview from "./link-preview.js"

import { LinkPreview } from "@opencode/schema/link-preview"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { AppProcess } from "@opencode/util/process"
import { Context, Deferred, Duration, Effect, Layer, Option, Schema } from "effect"
import { ChildProcess } from "effect/process"
import { Credential } from "./credential.js"
import { Mcp } from "./mcp/index.js"

export const Kind = LinkPreview.Kind
export type Kind = LinkPreview.Kind
export const Input = LinkPreview.Input
export type Input = LinkPreview.Input
export const Result = LinkPreview.Result
export type Result = LinkPreview.Result

const CACHE_TTL_MS = 60_000
const REQUEST_TIMEOUT = Duration.seconds(10)
const SAFE_SEGMENT = /^[\w.-]+$/
const SAFE_TAG = /^[\w.+@/-]{1,200}$/
const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9]*-\d+$|^P-[A-Z0-9]+-\d+$/
const JIRA_KEY = /^[A-Z][A-Z0-9_]*-\d+$/
const JIRA_SITE = /^[a-z0-9][a-z0-9-]*\.atlassian\.net$/
const NOTION_ID = /^[0-9a-f]{32}$/
const MAX_FIELDS = 4
// Avatars are only passed on from the code hosts' own CDNs, so a popup never loads an arbitrary image.
const AVATAR_HOSTS = new Set(["avatars.githubusercontent.com", "gitlab.com", "secure.gravatar.com"])
const MAX_LABELS = 6
const SNIPPET_LENGTH = 180

export interface Interface {
  readonly resolve: (input: Input) => Effect.Effect<Result>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LinkPreview") {}

type Entry = { expires: number; result: Deferred.Deferred<Result> }

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const process = yield* AppProcess.Service
    const mcp = yield* Mcp.Service
    const credentials = yield* Credential.Service
    const cache = new Map<string, Entry>()

    // The access token the GitHub MCP signed in with, so `gh` works even where its own login is missing or another
    // account's, such as under a separate XDG config directory.
    const githubToken = Effect.fnUntraced(function* () {
      const server = (yield* mcp.servers()).find((item) => item.integrationID && /github/i.test(item.name))
      if (!server?.integrationID) return undefined
      const value = (yield* credentials.list(server.integrationID)).at(-1)?.value
      return value?.type === "key" ? value.key : undefined
    })

    // GitHub and GitLab go through their CLIs, which hold the user's existing sign-in for each host.
    const cli = Effect.fnUntraced(function* (
      command: string,
      route: string,
      map: (body: string) => Result | undefined,
      env?: Record<string, string>,
    ) {
      return yield* process
        .run(ChildProcess.make(command, ["api", route], { stdin: "ignore", extendEnv: true, env }), {
          timeout: REQUEST_TIMEOUT,
          maxOutputBytes: 1_000_000,
        })
        .pipe(
          Effect.map((result) =>
            result.exitCode === 0
              ? (map(result.stdout.toString("utf8")) ?? unavailable)
              : failureResult(result.stderr.toString("utf8")),
          ),
          Effect.catch(() => Effect.succeed(unavailable)),
        )
    })

    // Linear and Jira go through their connected MCP servers, matched by tool name on a server named after them.
    const tool = Effect.fnUntraced(function* (
      server: RegExp,
      name: string,
      args: Record<string, unknown>,
      map: (text: string) => Result | undefined,
    ) {
      const match = (yield* mcp.tools()).find((item) => item.name === name && server.test(item.server))
      if (!match) return unavailable
      return yield* mcp.callTool({ server: match.server, name, args }).pipe(
        Effect.map((raw) => {
          const text = raw.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
          return raw.isError ? failureResult(text) : (map(text) ?? unavailable)
        }),
        Effect.timeoutOrElse({ duration: REQUEST_TIMEOUT, orElse: () => Effect.succeed(unavailable) }),
        Effect.catch(() => Effect.succeed(unavailable)),
      )
    })

    const compute = (input: Input) => {
      if (input.kind === "linear-issue" || input.kind === "linear-project") {
        if (!input.id) return Effect.succeed(unavailable)
        return input.kind === "linear-project"
          ? tool(/linear/i, "get_project", { query: input.id }, linearResult)
          : tool(/linear/i, "get_issue", { id: input.id }, linearResult)
      }
      if (input.kind === "jira-issue") {
        if (!input.id || !JIRA_KEY.test(input.id) || !input.site || !JIRA_SITE.test(input.site))
          return Effect.succeed(unavailable)
        return tool(/jira|atlassian/i, "getJiraIssue", { cloudId: input.site, issueIdOrKey: input.id }, jiraResult)
      }
      if (input.kind === "notion-page") {
        if (!input.id || !NOTION_ID.test(input.id)) return Effect.succeed(unavailable)
        return tool(/notion/i, "notion-fetch", { id: input.id }, notionResult)
      }
      if (input.kind === "gitlab-issue" || input.kind === "gitlab-mr") {
        const route = gitlabRoute(input)
        if (!route) return Effect.succeed(unavailable)
        const mr = input.kind === "gitlab-mr"
        const name = mr ? "get_merge_request" : "get_work_item"
        const map = (body: string) => gitlabResult(input.kind, body)
        // The GitLab MCP server when it is connected, and `glab` otherwise. Work item URLs also cover issues.
        return mcp.tools().pipe(
          Effect.flatMap((tools) =>
            tools.some((item) => item.name === name && /gitlab/i.test(item.server))
              ? tool(
                  /gitlab/i,
                  name,
                  { url: `https://gitlab.com/${input.repository}/-/${mr ? "merge_requests" : "issues"}/${input.number}` },
                  map,
                )
              : cli("glab", route, map),
          ),
        )
      }
      const route = githubRoute(input)
      if (!route) return Effect.succeed(unavailable)
      return githubToken().pipe(
        Effect.flatMap((token) =>
          cli("gh", route, (body) => githubResult(input.kind, body), token ? { GH_TOKEN: token } : undefined),
        ),
      )
    }

    return Service.of({
      // Concurrent callers for one reference share a single lookup; settled results are reused for CACHE_TTL_MS.
      resolve: Effect.fn("LinkPreview.resolve")(function* (input: Input) {
        const key = JSON.stringify([input.kind, input.repository, input.number, input.tag, input.id, input.site])
        const existing = cache.get(key)
        if (existing && existing.expires > Date.now()) return yield* Deferred.await(existing.result)
        const entry = { expires: Date.now() + CACHE_TTL_MS, result: yield* Deferred.make<Result>() }
        cache.set(key, entry)
        const result = yield* compute(input).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => cache.delete(key)).pipe(Effect.andThen(Deferred.interrupt(entry.result))),
          ),
        )
        // Failures are not worth remembering: the user may sign in to the CLI or connect the MCP server.
        if (result.outcome === "unavailable") cache.delete(key)
        yield* Deferred.succeed(entry.result, result)
        return result
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [AppProcess.node, Mcp.node, Credential.node] })

const unavailable: Result = { outcome: "unavailable" }

const JsonValue = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

// Only well-formed segments reach `gh api`, so a crafted reference can't steer the request to another endpoint.
function githubRoute(input: Input) {
  const [owner, repo, ...rest] = input.repository?.split("/") ?? []
  if (!owner || !repo || rest.length || !SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo)) return
  const base = `repos/${owner}/${repo}`
  if (input.kind === "github-release")
    return input.tag && SAFE_TAG.test(input.tag) ? `${base}/releases/tags/${encodeURIComponent(input.tag)}` : undefined
  if (!input.number) return
  return `${base}/${input.kind === "github-pr" ? "pulls" : "issues"}/${input.number}`
}

// GitLab addresses a project by its URL-encoded full path, which may include nested groups.
function gitlabRoute(input: Input) {
  const segments = input.repository?.split("/") ?? []
  if (segments.length < 2 || !segments.every((item) => SAFE_SEGMENT.test(item)) || !input.number) return
  const project = encodeURIComponent(segments.join("/"))
  return `projects/${project}/${input.kind === "gitlab-mr" ? "merge_requests" : "issues"}/${input.number}`
}

export function githubResult(kind: Kind, body: string): Result | undefined {
  const data = record(Option.getOrUndefined(JsonValue(body)))
  if (!data) return
  if (kind === "github-release") return releaseResult(data)
  if (typeof data.title !== "string") return
  const state = githubState(kind, data)
  if (!state) return
  const user = record(data.user)
  const pr = kind === "github-pr"
  return compact({
    outcome: "ok",
    title: data.title,
    state,
    author: author(pick(user?.login), user?.avatar_url),
    labels: labels(data.labels),
    createdAt: text(data.created_at),
    updatedAt: text(data.updated_at),
    closedAt: text(data.closed_at),
    // The list endpoints omit `merged`, so a merge time also marks a pull request as merged.
    mergedAt: text(data.merged_at),
    comments: count(data.comments, pr ? data.review_comments : undefined),
    head: pr ? text(record(data.head)?.ref) : undefined,
    base: pr ? text(record(data.base)?.ref) : undefined,
    additions: pr ? number(data.additions) : undefined,
    deletions: pr ? number(data.deletions) : undefined,
    changedFiles: pr ? number(data.changed_files) : undefined,
  })
}

export function gitlabResult(kind: Kind, body: string): Result | undefined {
  const data = record(Option.getOrUndefined(JsonValue(body)))
  if (!data || typeof data.title !== "string") return
  const state = gitlabState(kind, data)
  if (!state) return
  const user = record(data.author)
  const mr = kind === "gitlab-mr"
  return compact({
    outcome: "ok",
    title: data.title,
    state,
    author: author(pick(user?.username) ?? pick(user?.name), user?.avatar_url ?? user?.avatarUrl),
    labels: labels(data.labels ?? workItemLabels(data.widgets)),
    createdAt: text(data.created_at ?? data.createdAt),
    updatedAt: text(data.updated_at ?? data.updatedAt),
    closedAt: text(data.closed_at ?? data.closedAt),
    mergedAt: text(data.merged_at ?? data.mergedAt),
    comments: number(data.user_notes_count),
    head: mr ? text(data.source_branch) : undefined,
    base: mr ? text(data.target_branch) : undefined,
    // `changes_count` is a string, and "1000+" past GitLab's diff limit.
    changedFiles: mr ? number(Number.parseInt(text(data.changes_count) ?? "", 10)) : undefined,
  })
}

// The Atlassian MCP server answers with the Jira REST issue. Status categories map onto the same colours as Linear's.
export function jiraResult(body: string): Result | undefined {
  const data = record(Option.getOrUndefined(JsonValue(body)))
  const fields = record(data?.fields)
  const title = text(fields?.summary)
  if (!data || !fields || !title) return
  const status = record(fields.status)
  const category = text(record(status?.statusCategory)?.key)
  return compact({
    outcome: "ok",
    title,
    state: pick(status),
    stateType: category ? jiraStateTypes[category] : undefined,
    identifier: text(data.key),
    issueType: pick(fields.issuetype),
    priority: pick(fields.priority),
    assignee: pick(fields.assignee),
    author: author(pick(fields.reporter), undefined),
    project: pick(fields.project),
    labels: labels(fields.labels),
    createdAt: text(fields.created),
    updatedAt: text(fields.updated),
    closedAt: text(fields.resolutiondate),
    comments: number(record(fields.comment)?.total),
    summary: typeof fields.description === "string" ? snippet(fields.description) : undefined,
  })
}

const jiraStateTypes: Record<string, string> = { new: "unstarted", indeterminate: "started", done: "completed" }

// The Linear MCP server answers with JSON text. Issues carry their identifier in `id` and a plain-string `status`;
// projects carry `{ name, type }`. Anything unrecognisable falls back to `unavailable` rather than a half-filled popup.
export function linearResult(body: string): Result | undefined {
  const data = record(Option.getOrUndefined(JsonValue(body)))
  if (!data) return
  const title = pick(data.title) ?? pick(data.name)
  if (!title) return
  const status = record(data.status)
  const state = pick(data.status) ?? pick(data.state)
  const id = pick(data.id)
  return compact({
    outcome: "ok",
    title,
    state,
    stateType: pick(status?.type) ?? (state ? linearStateType(state) : undefined),
    identifier: pick(data.identifier) ?? (id && LINEAR_IDENTIFIER.test(id) ? id : undefined),
    summary: snippet(pick(data.summary) ?? pick(data.description)),
    labels: labels(data.labels),
    priority: pick(data.priority),
    assignee: pick(data.assignee) ?? pick(data.lead),
    project: pick(data.project),
    team: pick(data.team) ?? pick(data.leadTeam) ?? (Array.isArray(data.teams) ? pick(data.teams[0]) : undefined),
    updatedAt: pick(data.updatedAt),
    startDate: pick(data.startDate),
    targetDate: pick(data.targetDate),
    initiatives:
      Array.isArray(data.initiatives) && data.initiatives.length > 0
        ? data.initiatives.flatMap((item) => pick(item) ?? [])
        : undefined,
  })
}

// The Notion MCP server's fetch answers with JSON whose `text` wraps the page's properties and markdown content in
// <properties> and <content> tags. Properties come flattened: `date:Due:start` for dates, `__YES__` for a checked box,
// JSON arrays for multi-selects, and user:// or page URLs for people and relations, which carry no readable name.
export function notionResult(body: string): Result | undefined {
  const data = record(Option.getOrUndefined(JsonValue(body)))
  const title = text(data?.title)
  if (!data || !title) return
  const page = text(data.text) ?? ""
  const properties = record(Option.getOrUndefined(JsonValue(page.match(/<properties>([\s\S]*?)<\/properties>/)?.[1] ?? "")))
  const values = Object.entries(properties ?? {}).flatMap(([key, value]) => {
    const name = key.startsWith("date:") ? (key.endsWith(":start") ? key.split(":")[1] : undefined) : key
    const shown = notionValue(value)
    return name && shown && shown !== title ? [{ name, value: shown }] : []
  })
  const status = values.find((item) => /^status$/i.test(item.name))
  const icon = record(data.icon)
  return compact({
    outcome: "ok",
    title,
    state: status?.value,
    stateType: status ? notionStateType(status.value) : undefined,
    path: text(data.path),
    icon: text(icon?.emoji) ?? (typeof data.icon === "string" && !data.icon.includes("/") ? data.icon : undefined),
    fields: values.some((item) => item !== status)
      ? values.filter((item) => item !== status).slice(0, MAX_FIELDS)
      : undefined,
    updatedAt: text(data.page_last_edited_at),
    summary: snippet(page.match(/<content>([\s\S]*?)<\/content>/)?.[1]?.replace(/<[^>]+>/g, " ")),
  })
}

function notionValue(value: unknown): string | undefined {
  if (typeof value === "number") return String(value)
  const raw = text(value)
  if (!raw || /^(user|page|collection):\/\/|^https?:\/\//.test(raw)) return
  if (raw === "__YES__") return "Yes"
  if (raw === "__NO__") return
  const list = Option.getOrUndefined(JsonValue(raw))
  if (!Array.isArray(list)) return raw
  const names = list.flatMap((item) => notionValue(item) ?? [])
  return names.length ? names.join(", ") : undefined
}

function notionStateType(name: string) {
  if (/done|complete|shipped|closed|resolved/i.test(name)) return "completed"
  if (/cancel|archiv|won.?t/i.test(name)) return "canceled"
  if (/progress|doing|review|active|started/i.test(name)) return "started"
  return "unstarted"
}

export function failureResult(message: string): Result {
  if (/\b404\b|not found|does not exist/i.test(message)) return { outcome: "not-found" }
  // A CLI that is not signed in is unavailable rather than forbidden, so the lookup retries once the user signs in.
  if (/auth login|not logged in|GH_TOKEN/i.test(message)) return unavailable
  if (/\b40[13]\b|forbidden|unauthori[sz]ed|permission/i.test(message)) return { outcome: "forbidden" }
  return unavailable
}

function githubState(kind: Kind, data: Record<string, unknown>) {
  const state = typeof data.state === "string" ? data.state.toLowerCase() : undefined
  if (state !== "open" && state !== "closed") return
  if (kind === "github-pr") {
    if (data.merged === true || typeof data.merged_at === "string") return "merged"
    return state === "open" && data.draft === true ? "draft" : state
  }
  return state === "closed" && data.state_reason === "not_planned" ? "not-planned" : state
}

// GitLab's REST API says "opened" and "locked", and its work items "OPEN" and "CLOSED"; the popup speaks GitHub's
// open/closed/merged/draft vocabulary.
function gitlabState(kind: Kind, data: Record<string, unknown>) {
  const state = text(data.state)?.toLowerCase()
  if (state === "merged") return "merged"
  if (state === "closed" || state === "locked") return "closed"
  if (state !== "opened" && state !== "open") return
  return kind === "gitlab-mr" && data.draft === true ? "draft" : "open"
}

function releaseResult(data: Record<string, unknown>): Result | undefined {
  const tag = text(data.tag_name)
  const title = text(data.name) ?? tag
  if (!title) return
  const assets = Array.isArray(data.assets) ? data.assets.map(record).filter((item) => item !== undefined) : []
  const user = record(data.author)
  return compact({
    outcome: "ok",
    title,
    tag,
    state: data.draft === true ? "draft" : data.prerelease === true ? "prerelease" : "release",
    author: author(pick(user?.login), user?.avatar_url),
    createdAt: text(data.created_at),
    publishedAt: text(data.published_at),
    summary: snippet(text(data.body)),
    assets: assets.length,
    downloads: assets.reduce((total, item) => total + (number(item.download_count) ?? 0), 0),
  })
}

// Issue statuses arrive as bare names, so colour is inferred from the conventional Linear workflow names.
function linearStateType(name: string) {
  const value = name.toLowerCase()
  if (/cancel|duplicate|won'?t/.test(value)) return "canceled"
  if (/done|complete|shipped|released/.test(value)) return "completed"
  if (/progress|started|review|testing|qa/.test(value)) return "started"
  if (/backlog|triage/.test(value)) return "backlog"
  if (/todo|to do|ready/.test(value)) return "unstarted"
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  return Object.fromEntries(Object.entries(value))
}

// Accepts a plain string or an object with a name, which is how Linear and Jira spell people, teams and statuses.
function pick(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined
  const named = record(value)
  const name = named?.name ?? named?.displayName
  return typeof name === "string" && name ? name : undefined
}

function text(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function count(...values: unknown[]) {
  const numbers = values.flatMap((item) => number(item) ?? [])
  return numbers.length ? numbers.reduce((total, item) => total + item, 0) : undefined
}

function author(name: string | undefined, avatar: unknown): Result["author"] {
  if (!name) return
  const url = typeof avatar === "string" ? URL.parse(avatar) : null
  return { name, avatarUrl: url?.protocol === "https:" && AVATAR_HOSTS.has(url.hostname) ? url.toString() : undefined }
}

// GitHub labels are objects with a hex colour; GitLab and Jira labels are bare strings.
function labels(value: unknown): Result["labels"] {
  if (!Array.isArray(value)) return
  const items = value.slice(0, MAX_LABELS).flatMap((item) => {
    const name = pick(item)
    const color = text(record(item)?.color)
    return name ? [{ name, color: color && /^#?[0-9a-f]{6}$/i.test(color) ? color.replace(/^#/, "") : undefined }] : []
  })
  return items.length ? items : undefined
}

// Work items keep their labels in a LABELS widget, as nodes with a title and colour.
function workItemLabels(widgets: unknown) {
  if (!Array.isArray(widgets)) return
  const nodes = record(widgets.map(record).find((item) => item?.type === "LABELS")?.labels)?.nodes
  if (!Array.isArray(nodes)) return
  return nodes.flatMap((item) => {
    const label = record(item)
    return label ? [{ name: label.title, color: label.color }] : []
  })
}

// Release notes and descriptions are markdown; the popup only wants a short plain-text lead-in.
function snippet(value: string | undefined) {
  const plain = value
    ?.replace(/```[\s\S]*?```/g, " ")
    // GitHub's generated release notes end each entry with "by @user in <url>" and close with a changelog link.
    .replace(/\s+by @[\w-]+ in https?:\/\/\S+/g, "")
    .replace(/^\**Full Changelog\**:.*$/gim, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^[#>\-*\s]+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!plain) return
  return plain.length > SNIPPET_LENGTH ? `${plain.slice(0, SNIPPET_LENGTH).trimEnd()}…` : plain
}

// Drops absent fields so results stay small and compare cleanly.
function compact(result: Result): Result {
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)) as Result
}
