import type { LinkPreviewResult } from "@opencode/client/promise"
import { ReferenceCard } from "./reference-card"
import type { Reference } from "./reference"

const issue: Reference = { kind: "github-issue", repository: "forge/app", number: 79 }

const pull: Reference = { kind: "github-pr", repository: "forge/app", number: 81 }

const base = { outcome: "ok", author: { name: "octo" }, createdAt: "2026-11-01T00:00:00Z" } as const

const checks = {
  status: "ok",
  unit: "checks",
  complete: true,
  sha: "4101ed4",
  skipped: 1,
  cancelled: 0,
} as const

function Frame(props: { reference: Reference; result: LinkPreviewResult; stale?: boolean }) {
  return (
    <div style={{ width: "420px", padding: "12px 14px", border: "1px solid var(--v2-border-border-strong)", "border-radius": "10px" }}>
      <ReferenceCard
        reference={props.reference}
        result={props.result}
        href="https://github.com/forge/app/pull/81"
        onRefresh={() => undefined}
        stale={props.stale}
      />
    </div>
  )
}

export default {
  title: "OpenCode/Reference/Card",
  id: "components-reference-card",
  component: ReferenceCard,
  parameters: {
    docs: {
      description: {
        component:
          "The hover popup body for issues, pull requests and merge requests, with sub-issue progress and CI results when the provider has them.",
      },
    },
  },
}

export const SubIssueProgress = {
  render: () => (
    <Frame
      reference={issue}
      result={{
        ...base,
        title: "Show sub-issue completion in issue popovers",
        state: "open",
        progress: { status: "ok", completed: 2, cancelled: 1, open: 3, total: 6, partial: false },
      }}
    />
  ),
}

export const SubIssueProgressUnavailable = {
  render: () => (
    <Frame
      reference={issue}
      result={{
        ...base,
        title: "Hierarchy lookup failed",
        state: "open",
        progress: { status: "unavailable", completed: 0, cancelled: 0, open: 0, total: 0, partial: true },
      }}
    />
  ),
}

export const CiFailing = {
  render: () => (
    <Frame
      reference={pull}
      result={{
        ...base,
        title: "Run shell code blocks in the session terminal",
        state: "open",
        ci: {
          ...checks,
          passed: 9,
          failed: 2,
          pending: 1,
          total: 13,
          failures: [
            { name: "unit (macos)", url: "https://github.com/forge/app/runs/1" },
            { name: "e2e (windows)", url: "https://github.com/forge/app/runs/2" },
          ],
        },
      }}
    />
  ),
}

export const CiPassing = {
  render: () => (
    <Frame
      reference={pull}
      result={{ ...base, title: "All green", state: "open", ci: { ...checks, passed: 12, failed: 0, pending: 0, total: 13, failures: [] } }}
    />
  ),
}

export const CiPartial = {
  render: () => (
    <Frame
      reference={pull}
      result={{
        ...base,
        title: "More checks than were loaded",
        state: "open",
        ci: { ...checks, complete: false, passed: 100, failed: 0, pending: 0, skipped: 0, total: 100, failures: [] },
      }}
      stale
    />
  ),
}

export const CiNone = {
  render: () => (
    <Frame
      reference={pull}
      result={{ ...base, title: "No CI configured", state: "open", ci: { ...checks, status: "none", passed: 0, failed: 0, pending: 0, skipped: 0, total: 0, failures: [] } }}
    />
  ),
}
