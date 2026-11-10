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
// Results whose CI is still moving are reused briefly, so an open popup sees checks finish.
const ACTIVE_CI_TTL_MS = 10_000
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
const MAX_FAILURES = 5
const CHILD_PAGE_SIZE = 100
const MAX_CHILD_PAGES = 3
// Only the code hosts' own pages are passed on as links to failing checks, so a popup never links an arbitrary site.
const LINK_HOSTS = new Set(["github.com", "gitlab.com"])
const GITLAB_FINISHED = new Set(["success", "failed", "canceled", "skipped"])

export interface Interface {
  readonly resolve: (input: Input) => Effect.Effect<Result>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LinkPreview") {}

type Entry = { expires: number; result: Deferred.Deferred<Result> }

type Fetched = { body: string } | { failure: Result }

type Progress = NonNullable<Result["progress"]>

type Ci = NonNullable<Result["ci"]>

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
    const request = Effect.fnUntraced(function* (command: string, args: string[], env?: Record<string, string>) {
      return yield* process
        .run(ChildProcess.make(command, args, { stdin: "ignore", extendEnv: true, env }), {
          timeout: REQUEST_TIMEOUT,
          maxOutputBytes: 1_000_000,
        })
        .pipe(
          Effect.map(
            (result): Fetched =>
              result.exitCode === 0
                ? { body: result.stdout.toString("utf8") }
                : { failure: failureResult(result.stderr.toString("utf8")) },
          ),
          Effect.orElseSucceed((): Fetched => ({ failure: unavailable })),
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
        Effect.orElseSucceed(() => unavailable),
      )
    })

    // The pull request, then its CI for the head revision. A failed CI lookup leaves the card itself intact.
    const github = Effect.fnUntraced(function* (input: Input, route: string, base: string) {
      const token = yield* githubToken()
      const env = token ? { GH_TOKEN: token } : undefined
      const item = yield* request("gh", ["api", route], env)
      if ("failure" in item) return item.failure
      const result = githubResult(input.kind, item.body) ?? unavailable
      if (result.outcome !== "ok") return result

      if (input.kind === "github-pr") {
        const sha = githubHeadSha(item.body)
        if (!sha) return result
        const [runs, statuses] = yield* Effect.all(
          [
            request("gh", ["api", `${base}/commits/${sha}/check-runs?per_page=100&filter=latest`], env),
            request("gh", ["api", `${base}/commits/${sha}/status?per_page=100`], env),
          ],
          { concurrency: 2 },
        )
        return { ...result, ci: githubCiResult(sha, runs, statuses) }
      }

      const summary = githubSubIssues(item.body)
      if (input.kind !== "github-issue" || !summary || summary.total === 0) return result
      // Without a closed child there is nothing to tell completed from not planned.
      if (summary.completed === 0) return { ...result, progress: githubProgress(summary, []) }
      const children: Record<string, unknown>[] = []

      for (let page = 1; page <= MAX_CHILD_PAGES && children.length < summary.total; page++) {
        const listed = yield* request(
          "gh",
          ["api", `${route}/sub_issues?per_page=${CHILD_PAGE_SIZE}&page=${page}`],
          env,
        )
        const items = "body" in listed ? githubChildren(listed.body) : undefined
        if (!items) break
        children.push(...items)
        if (items.length < CHILD_PAGE_SIZE) break
      }

      return { ...result, progress: githubProgress(summary, children) }
    })

    // `glab` reads the merge request, then its head pipeline's test report and jobs.
    const gitlabCli = Effect.fnUntraced(function* (input: Input, route: string, project: string) {
      const item = yield* request("glab", ["api", route])
      if ("failure" in item) return item.failure
      const result = gitlabResult(input.kind, item.body) ?? unavailable
      if (result.outcome !== "ok") return result

      if (input.kind === "gitlab-mr") {
        const pipeline = gitlabPipeline(item.body)
        if (!pipeline) return result
        if (pipeline === "none") return { ...result, ci: noCi("jobs") }
        const [summary, jobs] = yield* Effect.all(
          [
            request("glab", ["api", `projects/${project}/pipelines/${pipeline.id}/test_report_summary`]),
            request("glab", ["api", `projects/${project}/pipelines/${pipeline.id}/jobs?per_page=100`]),
          ],
          { concurrency: 2 },
        )
        return { ...result, ci: gitlabCiResult(pipeline, summary, jobs) }
      }

      // Work items hold their children in a hierarchy widget, which only GraphQL exposes.
      const [path, iid] = [decodeURIComponent(project), String(input.number)]
      const children = yield* request("glab", [
        "api",
        "graphql",
        "-f",
        `query=${GITLAB_CHILDREN_QUERY}`,
        "-f",
        `path=${path}`,
        "-f",
        `iid=${iid}`,
      ])
      const progress = "body" in children ? gitlabChildren(children.body) : undefined
      return progress === "none" ? result : { ...result, progress: progress ?? unavailableProgress }
    })

    const compute = (input: Input) => {
      if (input.kind === "linear-issue" || input.kind === "linear-project") {
        if (!input.id) return Effect.succeed(unavailable)
        if (input.kind === "linear-project") return tool(/linear/i, "get_project", { query: input.id }, linearResult)
        const id = input.id
        // Sub-issues are the issues whose parent is this one. A lookup that fails just leaves the card without progress.
        return tool(/linear/i, "get_issue", { id }, linearResult).pipe(
          Effect.flatMap((result) =>
            result.outcome !== "ok"
              ? Effect.succeed(result)
              : tool(/linear/i, "list_issues", { parentId: id, limit: 250 }, linearChildren).pipe(
                  Effect.map((children) => (children.progress ? { ...result, progress: children.progress } : result)),
                ),
          ),
        )
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
        const project = gitlabProject(input)
        if (!route || !project) return Effect.succeed(unavailable)
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
                  {
                    url: `https://gitlab.com/${input.repository}/-/${mr ? "merge_requests" : "issues"}/${input.number}`,
                  },
                  map,
                ).pipe(
                  Effect.flatMap((result) =>
                    mr && result.outcome === "ok"
                      ? gitlabCli(input, route, project).pipe(
                          Effect.map((cli) =>
                            cli.outcome === "ok" ? cli : { ...result, ci: failedCi("jobs", { failure: cli }) },
                          ),
                        )
                      : result.outcome !== "ok" || result.progress
                        ? Effect.succeed(result)
                        : // The work item itself does not list its children; the direct ones are the items under it.
                          tool(
                            /gitlab/i,
                            "list_work_items",
                            { project_id: input.repository, parent_iid: input.number, state: "all", first: 100 },
                            gitlabListedChildren,
                          ).pipe(
                            Effect.map((children) =>
                              children.progress ? { ...result, progress: children.progress } : result,
                            ),
                          ),
                  ),
                )
              : gitlabCli(input, route, project),
          ),
        )
      }
      const route = githubRoute(input)
      const base = githubBase(input)
      if (!route || !base) return Effect.succeed(unavailable)
      return github(input, route, base)
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
        // Failed lookups are bounded too: multiple windows must not hammer an unavailable or rate-limited provider.
        entry.expires =
          Date.now() +
          (result.reason === "rate-limit" || result.ci?.reason === "rate-limit"
            ? 300_000
            : ciActive(result)
              ? ACTIVE_CI_TTL_MS
              : CACHE_TTL_MS)
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
function githubBase(input: Input) {
  const [owner, repo, ...rest] = input.repository?.split("/") ?? []
  if (!owner || !repo || rest.length || !SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo)) return
  return `repos/${owner}/${repo}`
}

function githubRoute(input: Input) {
  const base = githubBase(input)
  if (!base) return
  if (input.kind === "github-release")
    return input.tag && SAFE_TAG.test(input.tag) ? `${base}/releases/tags/${encodeURIComponent(input.tag)}` : undefined
  if (!input.number) return
  return `${base}/${input.kind === "github-pr" ? "pulls" : "issues"}/${input.number}`
}

// GitLab addresses a project by its URL-encoded full path, which may include nested groups.
function gitlabProject(input: Input) {
  const segments = input.repository?.split("/") ?? []
  if (segments.length < 2 || !segments.every((item) => SAFE_SEGMENT.test(item))) return
  return encodeURIComponent(segments.join("/"))
}

function gitlabRoute(input: Input) {
  const project = gitlabProject(input)
  if (!project || !input.number) return
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
    progress: mr ? undefined : childProgress(data.widgets),
  })
}

function childProgress(widgets: unknown) {
  const progress = hierarchyProgress(widgets)
  return progress === "none" ? undefined : progress
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
  const properties = record(
    Option.getOrUndefined(JsonValue(page.match(/<properties>([\s\S]*?)<\/properties>/)?.[1] ?? "")),
  )
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

const unavailableProgress: Progress = {
  status: "unavailable",
  completed: 0,
  cancelled: 0,
  open: 0,
  total: 0,
  partial: true,
}

/** A result whose CI is unfinished or cut short, so an open popup should look again soon. */
export function ciActive(result: Result) {
  return result.ci?.status === "ok" && (result.ci.pending > 0 || !result.ci.complete)
}

const GITLAB_CHILDREN_QUERY =
  "query($path: ID!, $iid: String!) { project(fullPath: $path) { workItems(iid: $iid) { nodes { widgets { type ... on WorkItemWidgetHierarchy { children(first: 100) { pageInfo { hasNextPage } nodes { state } } } } } } } }"

// GitHub's issue carries an authoritative aggregate of its direct sub-issues; absent on instances without them.
export function githubSubIssues(body: string) {
  const summary = record(record(Option.getOrUndefined(JsonValue(body)))?.sub_issues_summary)
  const total = number(summary?.total)
  const completed = number(summary?.completed)
  return total === undefined || completed === undefined ? undefined : { total, completed }
}

export function githubChildren(body: string) {
  const data = Option.getOrUndefined(JsonValue(body))
  return Array.isArray(data) ? data.map(record).filter((item) => item !== undefined) : undefined
}

// The aggregate cannot tell a child closed as not planned from a completed one, so the listing does. When it does not
// cover every child the aggregate stands in, and `partial` says its completed count may include not-planned children.
export function githubProgress(
  summary: { total: number; completed: number },
  children: Record<string, unknown>[],
): Progress {
  if (summary.completed === 0)
    return { status: "ok", completed: 0, cancelled: 0, open: summary.total, total: summary.total, partial: false }
  if (children.length < summary.total)
    return {
      status: "ok",
      completed: summary.completed,
      cancelled: 0,
      open: summary.total - summary.completed,
      total: summary.total,
      partial: true,
    }
  const cancelled = children.filter((item) => item.state === "closed" && item.state_reason === "not_planned").length
  const closed = children.filter((item) => item.state === "closed").length
  return {
    status: "ok",
    completed: closed - cancelled,
    cancelled,
    open: children.length - closed,
    total: children.length,
    partial: false,
  }
}

function tally(states: ("completed" | "cancelled" | "open")[], partial: boolean): Progress | undefined {
  if (states.length === 0) return
  const count = (state: string) => states.filter((item) => item === state).length
  return {
    status: "ok",
    completed: count("completed"),
    cancelled: count("cancelled"),
    open: count("open"),
    total: states.length,
    partial,
  }
}

// GitLab children are work items in the hierarchy widget; a closed one is done, as GitLab has no cancelled state.
// `none` is an issue without children, undefined a lookup that did not answer.
export function gitlabChildren(body: string): Progress | "none" | undefined {
  const data = record(Option.getOrUndefined(JsonValue(body)))
  const nodes = record(record(record(data?.data)?.project)?.workItems)?.nodes
  if (!Array.isArray(nodes) || nodes.length === 0) return
  return hierarchyProgress(record(nodes[0])?.widgets)
}

function hierarchyProgress(widgets: unknown): Progress | "none" | undefined {
  const hierarchy = Array.isArray(widgets) ? widgets.map(record).find((item) => item?.type === "HIERARCHY") : undefined
  const children = record(hierarchy?.children)
  if (!children || !Array.isArray(children.nodes)) return
  const states = children.nodes.map((item) =>
    text(record(item)?.state)?.toUpperCase() === "OPEN" ? "open" : "completed",
  )
  return tally(states, record(children.pageInfo)?.hasNextPage === true) ?? "none"
}

// `list_work_items` under a parent: its direct children, as an array or wrapped in `nodes` or `items`.
export function gitlabListedChildren(body: string): Result | undefined {
  const data = Option.getOrUndefined(JsonValue(body))
  const found = [data, ...["nodes", "items", "work_items", "workItems", "results"].map((key) => record(data)?.[key])]
  const items = found.find((item) => Array.isArray(item))
  if (!Array.isArray(items)) return
  const states = items.map((item) =>
    ["OPEN", "OPENED"].includes(text(record(item)?.state)?.toUpperCase() ?? "") ? "open" : "completed",
  )
  const more = record(record(data)?.pageInfo)?.hasNextPage === true
  return compact({ outcome: "ok", progress: tally(states, more) })
}

// Linear lists the issues under a parent; its workflow status type separates completed from cancelled.
export function linearChildren(body: string): Result | undefined {
  const data = Option.getOrUndefined(JsonValue(body))
  const issues = Array.isArray(data) ? data : record(data)?.issues
  if (!Array.isArray(issues)) return
  const states = issues.map((item) => {
    const status = record(record(item)?.status)
    const name = pick(record(item)?.status) ?? pick(record(item)?.state)
    const type = pick(status?.type) ?? (name ? linearStateType(name) : undefined)
    return type === "completed" ? "completed" : type === "canceled" ? "cancelled" : "open"
  })
  const progress = tally(states, record(data)?.hasNextPage === true)
  return compact({ outcome: "ok", progress })
}

function providerUrl(value: unknown) {
  const url = typeof value === "string" ? URL.parse(value) : null
  return url?.protocol === "https:" && LINK_HOSTS.has(url.hostname) ? url.toString() : undefined
}

type Bucket = "passed" | "failed" | "pending" | "skipped" | "cancelled"

type Item = { name: string; bucket: Bucket; url?: string }

function summarise(unit: Ci["unit"], items: Item[], complete: boolean, sha?: string): Ci {
  const count = (bucket: Bucket) => items.filter((item) => item.bucket === bucket).length
  return {
    // Nothing counted from a source that fell short is unknown, not an empty pipeline.
    status: items.length > 0 ? "ok" : complete ? "none" : "unavailable",
    unit,
    passed: count("passed"),
    failed: count("failed"),
    pending: count("pending"),
    skipped: count("skipped"),
    cancelled: count("cancelled"),
    total: items.length,
    complete,
    ...(sha ? { sha } : {}),
    failures: items
      .filter((item) => item.bucket === "failed")
      .slice(0, MAX_FAILURES)
      .map((item) => ({ name: item.name, ...(item.url ? { url: item.url } : {}) })),
  }
}

function noCi(unit: Ci["unit"]) {
  return summarise(unit, [], true)
}

function failedCi(unit: Ci["unit"], fetched: Fetched): Ci {
  const forbidden = "failure" in fetched && fetched.failure.outcome === "forbidden"
  const result: Ci = { ...summarise(unit, [], false), status: forbidden ? "forbidden" : "unavailable" }
  if ("failure" in fetched && fetched.failure.reason) return { ...result, reason: fetched.failure.reason }
  return result
}

export function githubHeadSha(body: string) {
  return text(record(record(Option.getOrUndefined(JsonValue(body)))?.head)?.sha)
}

const checkConclusions: Record<string, Bucket> = {
  success: "passed",
  failure: "failed",
  timed_out: "failed",
  action_required: "failed",
  startup_failure: "failed",
  skipped: "skipped",
  neutral: "skipped",
  stale: "skipped",
  cancelled: "cancelled",
}

const statusStates: Record<string, Bucket> = {
  success: "passed",
  failure: "failed",
  error: "failed",
  pending: "pending",
}

function githubChecks(fetched: Fetched) {
  if (!("body" in fetched)) return
  const data = record(Option.getOrUndefined(JsonValue(fetched.body)))
  if (!data || !Array.isArray(data.check_runs)) return
  const runs = data.check_runs.map(record).filter((item) => item !== undefined)
  const items = runs.map(
    (run): Item => ({
      name: text(run.name) ?? "check",
      // A run that has not completed has no conclusion yet, and an unknown conclusion is never counted as passing.
      bucket: run.status === "completed" ? (checkConclusions[text(run.conclusion) ?? ""] ?? "pending") : "pending",
      url: providerUrl(run.html_url),
    }),
  )
  return { items, complete: (number(data.total_count) ?? runs.length) <= runs.length }
}

function githubStatuses(fetched: Fetched) {
  if (!("body" in fetched)) return
  const data = record(Option.getOrUndefined(JsonValue(fetched.body)))
  if (!data || !Array.isArray(data.statuses)) return
  const statuses = data.statuses.map(record).filter((item) => item !== undefined)
  const items = statuses.map(
    (status): Item => ({
      name: text(status.context) ?? "status",
      bucket: statusStates[text(status.state) ?? ""] ?? "pending",
      url: providerUrl(status.target_url),
    }),
  )
  return { items, complete: (number(data.total_count) ?? statuses.length) <= statuses.length }
}

// GitHub counts check runs, never tests. Runs come as the latest attempt of each check, so reruns are not counted
// twice, and legacy commit statuses add the CI that does not report through check runs.
export function githubCiResult(sha: string, runs: Fetched, statuses: Fetched): Ci {
  const checks = githubChecks(runs)
  const legacy = githubStatuses(statuses)
  if (!checks && !legacy) return failedCi("checks", "failure" in runs ? runs : statuses)
  const result = summarise(
    "checks",
    [...(checks?.items ?? []), ...(legacy?.items ?? [])],
    !!checks && !!legacy && checks.complete && legacy.complete,
    sha,
  )
  const failed = [runs, statuses].find((item) => "failure" in item)
  if (failed && "failure" in failed && failed.failure.reason) return { ...result, reason: failed.failure.reason }
  return result
}

// The head pipeline of a merge request: `none` when GitLab says it has none, undefined when the answer is unreadable.
export function gitlabPipeline(body: string) {
  const data = record(Option.getOrUndefined(JsonValue(body)))
  if (!data || !("head_pipeline" in data)) return
  if (data.head_pipeline === null) return "none"
  const pipeline = record(data.head_pipeline)
  const id = number(pipeline?.id)
  return id === undefined ? undefined : { id, status: text(pipeline?.status) ?? "", sha: text(pipeline?.sha) }
}

const jobStatuses: Record<string, Bucket> = {
  success: "passed",
  failed: "failed",
  canceled: "cancelled",
  canceling: "cancelled",
  skipped: "skipped",
  manual: "skipped",
}

function gitlabJobs(fetched: Fetched) {
  if (!("body" in fetched)) return
  const data = Option.getOrUndefined(JsonValue(fetched.body))
  if (!Array.isArray(data)) return
  const jobs = data.map(record).filter((item) => item !== undefined)
  const items = jobs.map(
    (job): Item => ({
      name: text(job.name) ?? "job",
      // Created, pending, running, waiting and scheduled jobs are all still to finish.
      bucket: jobStatuses[text(job.status) ?? ""] ?? "pending",
      url: providerUrl(job.web_url),
    }),
  )
  // The jobs endpoint is paged without a total, so a full page may have more behind it.
  return { items, complete: jobs.length < 100 }
}

// A test report counts individual tests; without one the pipeline's jobs are counted, and called jobs.
export function gitlabCiResult(
  pipeline: { id: number; status: string; sha?: string },
  summary: Fetched,
  jobs: Fetched,
): Ci {
  const list = gitlabJobs(jobs)
  const total = "body" in summary ? record(record(Option.getOrUndefined(JsonValue(summary.body)))?.total) : undefined
  const count = number(total?.count)

  if (total && count) {
    const passed = number(total.success) ?? 0
    const skipped = number(total.skipped) ?? 0
    return {
      status: "ok",
      unit: "tests",
      passed,
      failed: (number(total.failed) ?? 0) + (number(total.error) ?? 0),
      pending: 0,
      skipped,
      cancelled: 0,
      total: count,
      // Tests of a pipeline that is still running keep arriving.
      complete: GITLAB_FINISHED.has(pipeline.status),
      ...(pipeline.sha ? { sha: pipeline.sha } : {}),
      failures: list ? summarise("jobs", list.items, list.complete).failures : [],
    }
  }

  if (!list) return failedCi("jobs", jobs)
  const result = summarise("jobs", list.items, list.complete, pipeline.sha)
  if ("failure" in summary && summary.failure.reason) return { ...result, reason: summary.failure.reason }
  return result
}

export function failureResult(message: string): Result {
  if (/\b429\b|rate.limit|secondary rate|too many requests/i.test(message))
    return { outcome: "unavailable", reason: "rate-limit" }
  if (/\b404\b|not found|does not exist/i.test(message)) return { outcome: "not-found" }
  // A CLI that is not signed in is unavailable rather than forbidden, so the lookup retries once the user signs in.
  if (/auth login|not logged in|GH_TOKEN|\b401\b|authentication/i.test(message))
    return { outcome: "unavailable", reason: "authentication" }
  if (/\b40[13]\b|forbidden|unauthori[sz]ed|permission/i.test(message)) return { outcome: "forbidden" }
  return { outcome: "unavailable", reason: "temporary" }
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
