import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppProcess } from "@opencode-ai/core/process"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { Context, Deferred, Duration, Effect, Layer, Option, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { InstanceState } from "@/effect/instance-state"
import { MCP } from "@/mcp"

const CACHE_TTL_MS = 60_000
const REQUEST_TIMEOUT_MS = 10_000
const SAFE_SEGMENT = /^[\w.-]+$/
const SAFE_TAG = /^[\w.+@/-]{1,200}$/
const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9]*-\d+$|^P-[A-Z0-9]+-\d+$/
const AVATAR_HOST = "avatars.githubusercontent.com"
const MAX_LABELS = 6
const SNIPPET_LENGTH = 180

export const Kind = Schema.Literals(["github-issue", "github-pr", "github-release", "linear-issue", "linear-project"])
export type Kind = Schema.Schema.Type<typeof Kind>

export const Input = Schema.Struct({
  kind: Kind,
  owner: Schema.optional(Schema.String),
  repo: Schema.optional(Schema.String),
  number: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))),
  tag: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
})
export type Input = Schema.Schema.Type<typeof Input>

const Person = Schema.Struct({ name: Schema.String, avatarUrl: Schema.optional(Schema.String) })
const Label = Schema.Struct({ name: Schema.String, color: Schema.optional(Schema.String) })

// `unavailable` covers a missing `gh`/Linear connection and transient failures; `forbidden` is a private or
// unauthorised item. Only `ok` carries details, and each provider fills just the fields it has. `state` is
// open/closed/merged/draft/not-planned (issues, PRs), draft/prerelease/release (releases) or the workflow
// status name (Linear), with `stateType` giving Linear's coarse category for colouring.
export const Result = Schema.Struct({
  outcome: Schema.Literals(["ok", "unavailable", "forbidden", "not-found"]),
  title: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
  stateType: Schema.optional(Schema.String),
  identifier: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  author: Schema.optional(Person),
  labels: Schema.optional(Schema.Array(Label)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  closedAt: Schema.optional(Schema.String),
  mergedAt: Schema.optional(Schema.String),
  publishedAt: Schema.optional(Schema.String),
  comments: Schema.optional(Schema.Finite),
  head: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  additions: Schema.optional(Schema.Finite),
  deletions: Schema.optional(Schema.Finite),
  changedFiles: Schema.optional(Schema.Finite),
  tag: Schema.optional(Schema.String),
  assets: Schema.optional(Schema.Finite),
  downloads: Schema.optional(Schema.Finite),
  priority: Schema.optional(Schema.String),
  assignee: Schema.optional(Schema.String),
  project: Schema.optional(Schema.String),
  team: Schema.optional(Schema.String),
  startDate: Schema.optional(Schema.String),
  targetDate: Schema.optional(Schema.String),
  initiatives: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "LinkPreviewResult" })
export type Result = Schema.Schema.Type<typeof Result>

export interface Interface {
  readonly resolve: (input: Input) => Effect.Effect<Result>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LinkPreview") {}

type Entry = { expires: number; result: Deferred.Deferred<Result> }

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service
    const mcp = yield* MCP.Service

    const state = yield* InstanceState.make(Effect.fn("LinkPreview.state")(() => Effect.succeed(new Map<string, Entry>())))

    const github = Effect.fnUntraced(function* (input: Input) {
      const route = githubRoute(input)
      if (!route) return unavailable
      return yield* appProcess
        .run(
          ChildProcess.make("gh", ["api", route], { stdin: "ignore", extendEnv: true }),
          { timeout: Duration.millis(REQUEST_TIMEOUT_MS), maxOutputBytes: 1_000_000 },
        )
        .pipe(
          Effect.map((result) =>
            result.exitCode === 0
              ? (githubResult(input.kind, result.stdout.toString("utf8")) ?? unavailable)
              : failureResult(result.stderr.toString("utf8")),
          ),
          Effect.catch(() => Effect.succeed(unavailable)),
        )
    })

    const linear = Effect.fnUntraced(function* (input: Input) {
      if (!input.id) return unavailable
      const tool = input.kind === "linear-project" ? "get_project" : "get_issue"
      const entry = Object.entries(yield* mcp.tools()).find(
        ([key, item]) => item.def.name === tool && /linear/i.test(key),
      )?.[1]
      if (!entry) return unavailable
      return yield* Effect.tryPromise(() =>
        entry.client.callTool(
          { name: entry.def.name, arguments: input.kind === "linear-project" ? { query: input.id } : { id: input.id } },
          CallToolResultSchema,
          { timeout: entry.timeout ?? REQUEST_TIMEOUT_MS },
        ),
      ).pipe(
        Effect.map((raw) => {
          const text = raw.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
          return raw.isError ? failureResult(text) : (linearResult(text) ?? unavailable)
        }),
        Effect.catch(() => Effect.succeed(unavailable)),
      )
    })

    const compute = (input: Input) => (input.kind.startsWith("github") ? github(input) : linear(input))

    return Service.of({
      // Concurrent callers for one reference share a single lookup; settled results are reused for CACHE_TTL_MS.
      resolve: Effect.fn("LinkPreview.resolve")(function* (input: Input) {
        const cache = yield* InstanceState.get(state)
        const key = JSON.stringify([input.kind, input.owner, input.repo, input.number, input.id])
        const existing = cache.get(key)
        if (existing && existing.expires > Date.now()) return yield* Deferred.await(existing.result)
        const entry = { expires: Date.now() + CACHE_TTL_MS, result: yield* Deferred.make<Result>() }
        cache.set(key, entry)
        const result = yield* compute(input).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => cache.delete(key)).pipe(Effect.andThen(Deferred.interrupt(entry.result))),
          ),
        )
        // Failures are not worth remembering for a full minute: the user may fix `gh auth` or connect Linear.
        if (result.outcome === "unavailable") cache.delete(key)
        yield* Deferred.succeed(entry.result, result)
        return result
      }),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [AppProcess.node, MCP.node] })

const unavailable: Result = { outcome: "unavailable" }

const JsonValue = Schema.UnknownFromJsonString.pipe(Schema.decodeUnknownOption)

// Only well-formed segments reach `gh api`, so a crafted reference can't steer the request to another endpoint.
function githubRoute(input: Input) {
  if (!input.owner || !input.repo || !SAFE_SEGMENT.test(input.owner) || !SAFE_SEGMENT.test(input.repo)) return
  const repo = `repos/${input.owner}/${input.repo}`
  if (input.kind === "github-release")
    return input.tag && SAFE_TAG.test(input.tag) ? `${repo}/releases/tags/${encodeURIComponent(input.tag)}` : undefined
  if (!input.number) return
  return `${repo}/${input.kind === "github-pr" ? "pulls" : "issues"}/${input.number}`
}

export function githubResult(kind: Kind, body: string): Result | undefined {
  const data = record(Option.getOrUndefined(JsonValue(body)))
  if (!data) return
  if (kind === "github-release") return releaseResult(data)
  if (typeof data.title !== "string") return
  const state = githubState(kind, data)
  if (!state) return
  const user = record(data.user)
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
    comments: count(data.comments, kind === "github-pr" ? data.review_comments : undefined),
    head: kind === "github-pr" ? text(record(data.head)?.ref) : undefined,
    base: kind === "github-pr" ? text(record(data.base)?.ref) : undefined,
    additions: kind === "github-pr" ? number(data.additions) : undefined,
    deletions: kind === "github-pr" ? number(data.deletions) : undefined,
    changedFiles: kind === "github-pr" ? number(data.changed_files) : undefined,
  })
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

function releaseResult(data: Record<string, unknown>): Result | undefined {
  const tag = text(data.tag_name)
  const title = text(data.name) ?? tag
  if (!title) return
  const assets = Array.isArray(data.assets)
    ? data.assets.flatMap((item) => {
        const asset = record(item)
        return asset ? [asset] : []
      })
    : []
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

// The Linear MCP server answers with JSON text. Issues carry their identifier in `id` and a plain-string
// `status`; projects carry `{ name, type }`. Anything unrecognisable falls back to `unavailable` rather than
// a half-filled popup.
export function linearResult(text: string): Result | undefined {
  const data = record(Option.getOrUndefined(JsonValue(text)))
  if (!data) return
  const title = pick(data.title) ?? pick(data.name)
  if (!title) return
  const status = record(data.status)
  const state = pick(data.status) ?? pick(data.state)
  const id = pick(data.id)
  const team = pick(data.team) ?? pick(data.leadTeam) ?? (Array.isArray(data.teams) ? pick(data.teams[0]) : undefined)
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
    team,
    updatedAt: pick(data.updatedAt),
    startDate: pick(data.startDate),
    targetDate: pick(data.targetDate),
    initiatives:
      Array.isArray(data.initiatives) && data.initiatives.length > 0
        ? data.initiatives.flatMap((item) => pick(item) ?? [])
        : undefined,
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

export function failureResult(message: string): Result {
  if (/\b404\b|not found/i.test(message)) return { outcome: "not-found" }
  if (/\b40[13]\b|forbidden|unauthori[sz]ed|permission|gh auth login|not logged in/i.test(message))
    return { outcome: "forbidden" }
  return unavailable
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

// Accepts a plain string or an object with a `name`, which is how Linear spells people, teams and statuses.
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

// Avatars are only passed on when they come from GitHub's own CDN, so the popup never loads an arbitrary image.
function author(name: string | undefined, avatar: unknown): Result["author"] {
  if (!name) return
  const url = typeof avatar === "string" ? URL.parse(avatar) : null
  return { name, avatarUrl: url?.protocol === "https:" && url.hostname === AVATAR_HOST ? url.toString() : undefined }
}

function labels(value: unknown): Result["labels"] {
  if (!Array.isArray(value)) return
  const items = value.slice(0, MAX_LABELS).flatMap((item) => {
    const name = pick(item)
    const color = text(record(item)?.color)
    return name ? [{ name, color: color && /^#?[0-9a-f]{6}$/i.test(color) ? color.replace(/^#/, "") : undefined }] : []
  })
  return items.length ? items : undefined
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

export * as LinkPreview from "."
