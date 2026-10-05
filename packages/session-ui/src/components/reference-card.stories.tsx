// @ts-nocheck
import { For } from "solid-js"
import { ReferenceCard } from "./reference-card"

const avatar = "https://avatars.githubusercontent.com/u/48401771?v=4"
const me = { name: "divyanshusingh2903", avatarUrl: avatar }
const gh = { owner: "divyanshusingh2903", repo: "forge" }
const linear = { workspace: "vihayas" }

// Fixtures mirror what the link-preview endpoint returns for real GitHub and Linear items.
const cards = [
  {
    reference: { kind: "github-pr", ...gh, number: 21 },
    result: {
      outcome: "ok",
      title: "feat(session-ui): render web search results in message parts",
      state: "merged",
      author: me,
      createdAt: "2026-10-04T01:14:41Z",
      mergedAt: "2026-10-04T03:16:20Z",
      head: "tool-response-viewer",
      base: "main",
      additions: 482,
      deletions: 37,
      changedFiles: 19,
      comments: 2,
    },
  },
  {
    reference: { kind: "github-pr", ...gh, number: 30 },
    result: {
      outcome: "ok",
      title: "wip: live git status in the review panel",
      state: "draft",
      author: me,
      createdAt: "2026-10-04T17:41:02Z",
      head: "live-git-status",
      base: "main",
      additions: 12,
      deletions: 0,
      changedFiles: 2,
    },
  },
  {
    reference: { kind: "github-issue", ...gh, number: 23 },
    result: {
      outcome: "ok",
      title: "feat(app): live git status and more git actions in review panel",
      state: "open",
      author: me,
      createdAt: "2026-10-04T17:41:02Z",
      labels: [{ name: "enhancement", color: "a2eeef" }, { name: "needs:compliance", color: "d93f0b" }],
      comments: 3,
    },
  },
  {
    reference: { kind: "github-issue", ...gh, number: 20 },
    result: {
      outcome: "ok",
      title: "feat(app): show animated activity indicators in the conversation",
      state: "closed",
      author: me,
      createdAt: "2026-09-30T16:45:58Z",
      closedAt: "2026-10-04T04:09:21Z",
      labels: [{ name: "enhancement", color: "a2eeef" }],
    },
  },
  {
    reference: { kind: "github-release", ...gh, tag: "v1.18.30-v0.2.0" },
    result: {
      outcome: "ok",
      title: "Forge v1.18.30-v0.2.0",
      tag: "v1.18.30-v0.2.0",
      state: "release",
      author: { name: "github-actions[bot]", avatarUrl: "https://avatars.githubusercontent.com/in/15368?v=4" },
      publishedAt: "2026-09-28T21:06:20Z",
      summary: "What's Changed forge release fix(desktop): unblock macOS release builds and refresh Forge branding",
      assets: 21,
      downloads: 449,
    },
  },
  {
    reference: { kind: "linear-issue", ...linear, id: "VIH-37" },
    result: {
      outcome: "ok",
      title: "vihayas-iam — API key mint, revoke, and list per user",
      identifier: "VIH-37",
      state: "In Progress",
      stateType: "started",
      priority: "Urgent",
      assignee: "divyanshusingh2903@gmail.com",
      project: "Vihayas Core",
      team: "Vihayas Engineering",
      updatedAt: "2026-07-22T23:18:33.676Z",
    },
  },
  {
    reference: { kind: "linear-issue", ...linear, id: "VIH-60" },
    result: {
      outcome: "ok",
      title: "Ingest Azure cloud storage configs and pricing (Blob Storage)",
      identifier: "VIH-60",
      state: "Done",
      stateType: "completed",
      priority: "Urgent",
      project: "Sadhak",
      team: "Vihayas Engineering",
    },
  },
  {
    reference: { kind: "linear-project", ...linear, id: "vihayas-core-8dff9615dbdd" },
    result: {
      outcome: "ok",
      title: "Vihayas Core",
      identifier: "P-VIH-2",
      state: "In Progress",
      stateType: "started",
      team: "Vihayas Engineering",
      startDate: "2026-05-29",
      initiatives: ["Vihayas Platform MVP"],
    },
  },
]

export default { title: "UI/Reference Card", parameters: { layout: "padded" } }

export const AllKinds = {
  render: () => (
    <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, 320px)", gap: "16px" }}>
      <For each={cards}>
        {(card) => (
          <div
            data-component="reference-popup"
            style={{ position: "static", width: "320px", "pointer-events": "auto" }}
          >
            <ReferenceCard reference={card.reference} result={card.result} />
          </div>
        )}
      </For>
    </div>
  ),
}
