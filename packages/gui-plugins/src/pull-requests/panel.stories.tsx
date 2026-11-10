import { ForgePullRequests } from "@opencode/schema/forge-pull-requests"
import en from "./i18n/en"
import PullRequestsPanel from "./panel"

type Params = Record<string, string | number>

const dictionary: Record<string, string> = en

const translate = (key: string, params?: Params) =>
  (dictionary[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ""))

const plural = (key: string, count: number, params?: Params) =>
  translate(`${key}.${count === 1 ? "one" : "other"}`, { count, ...params })

const github = (number: number): ForgePullRequests.Identity => ({
  provider: "github",
  host: "github.com",
  repository: "forge/app",
  number,
})

const gitlab: ForgePullRequests.Identity = {
  provider: "gitlab",
  host: "gitlab.com",
  repository: "forge/platform/api",
  number: 12,
}

const base = { outcome: "ok", author: { name: "octo" }, createdAt: "2026-11-01T00:00:00Z" } as const

const now = Date.parse("2026-11-10T08:00:00Z")

const ci = {
  status: "ok",
  unit: "checks",
  complete: true,
  sha: "4101ed4",
  skipped: 1,
  cancelled: 0,
} as const

const item = (
  identity: ForgePullRequests.Identity,
  fields: Partial<ForgePullRequests.Item> & { status: ForgePullRequests.Item["status"] },
): ForgePullRequests.Item => ({
  identity,
  url: ForgePullRequests.href(identity),
  source: "created",
  trackedAt: now,
  checkedAt: now,
  autoFix: { enabled: false, state: "idle", attempts: 0 },
  ...fields,
})

const mixed: ForgePullRequests.State = {
  items: [
    item(github(84), {
      status: {
        ...base,
        title: "Track session pull requests with opt-in CI auto-fix",
        state: "open",
        head: "pr-tracking",
        base: "main",
        ci: {
          ...ci,
          passed: 21,
          failed: 2,
          pending: 0,
          total: 24,
          failures: [
            { name: "unit (macos)", url: "https://github.com/forge/app/actions/runs/1" },
            { name: "e2e (windows, app-1)", url: "https://github.com/forge/app/actions/runs/2" },
          ],
        },
      },
      autoFix: { enabled: true, state: "fixing", attempts: 1, handledSha: "4101ed4" },
    }),
    item(gitlab, {
      source: "requested",
      status: {
        ...base,
        title: "Retry the webhook queue",
        state: "draft",
        head: "webhook-retry",
        base: "main",
        ci: { ...ci, unit: "jobs", passed: 6, failed: 0, pending: 3, total: 9, failures: [] },
      },
    }),
    item(github(79), {
      status: {
        ...base,
        title: "Show sub-issue completion in issue popovers",
        state: "open",
        head: "popover-progress",
        base: "main",
        ci: { ...ci, passed: 31, failed: 0, pending: 0, total: 32, failures: [] },
      },
      failure: "unavailable",
      reason: "rate-limit",
      failedAt: now,
      failures: 2,
      checkedAt: now - 6 * 60_000,
      autoFix: { enabled: true, state: "paused", attempts: 1, handledSha: "old" },
    }),
    item(github(7), { source: "requested", status: undefined, failure: "not-found", failedAt: now, failures: 1 }),
    item(github(70), {
      status: { ...base, title: "Fix scroll state", state: "merged", head: "fix-scroll", base: "main" },
    }),
  ],
}

const actions = {
  refresh: async () => undefined,
  track: async () => "tracked" as const,
  untrack: async () => undefined,
  autoFix: async () => undefined,
}

export default {
  title: "OpenCode/Plugins/Pull requests",
  id: "plugins-pull-requests",
  component: PullRequestsPanel,
  parameters: {
    docs: {
      description: {
        component:
          "The Pull requests tab: compact rows for the session's tracked pull and merge requests, expanding into the reference card with the auto-fix control.",
      },
    },
  },
}

function Frame(props: { state: ForgePullRequests.State }) {
  return (
    <div style={{ width: "380px", height: "560px", border: "1px solid var(--v2-border-border-strong)" }}>
      <PullRequestsPanel state={() => props.state} actions={actions} t={translate} plural={plural} />
    </div>
  )
}

export const Mixed = { render: () => <Frame state={mixed} /> }

export const Empty = { render: () => <Frame state={{ items: [] }} /> }
