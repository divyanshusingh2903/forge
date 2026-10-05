import { describe, expect, test } from "bun:test"
import { LinkPreview } from "../../src/link-preview"

const github = (kind: LinkPreview.Kind, data: object) => LinkPreview.githubResult(kind, JSON.stringify(data))

describe("LinkPreview.githubResult", () => {
  test("maps an issue with author, labels and dates", () => {
    expect(
      github("github-issue", {
        title: "Bug",
        state: "open",
        comments: 4,
        created_at: "2026-09-28T07:41:00Z",
        user: { login: "divyanshusingh2903", avatar_url: "https://avatars.githubusercontent.com/u/48401771?v=4" },
        labels: [{ name: "enhancement", color: "a2eeef" }, { name: "plain" }],
      }),
    ).toEqual({
      outcome: "ok",
      title: "Bug",
      state: "open",
      comments: 4,
      createdAt: "2026-09-28T07:41:00Z",
      author: { name: "divyanshusingh2903", avatarUrl: "https://avatars.githubusercontent.com/u/48401771?v=4" },
      labels: [{ name: "enhancement", color: "a2eeef" }, { name: "plain" }],
    })
  })

  test("accepts uppercase states and plain-string labels from list responses", () => {
    const result = github("github-issue", { title: "x", state: "CLOSED", labels: ["needs:title"] })
    expect(result?.state).toBe("closed")
    expect(result?.labels).toEqual([{ name: "needs:title" }])
  })

  test("marks issues closed as not planned", () => {
    expect(github("github-issue", { title: "x", state: "closed", state_reason: "not_planned" })?.state).toBe(
      "not-planned",
    )
    expect(github("github-issue", { title: "x", state: "closed", state_reason: "completed" })?.state).toBe("closed")
  })

  test("distinguishes merged, draft, open and closed pull requests", () => {
    const state = (extra: object) => github("github-pr", { title: "PR", ...extra })?.state
    expect(state({ state: "closed", merged: true })).toBe("merged")
    // List responses report merged: false even for merged pull requests, so the merge time decides.
    expect(state({ state: "closed", merged: false, merged_at: "2026-09-28T19:25:20Z" })).toBe("merged")
    expect(state({ state: "open", draft: true })).toBe("draft")
    expect(state({ state: "open", draft: false, merged: false })).toBe("open")
    expect(state({ state: "closed", merged: false, merged_at: null })).toBe("closed")
  })

  test("reads branches and diff stats for pull requests only", () => {
    const pr = {
      title: "PR",
      state: "open",
      head: { ref: "activity-indicators" },
      base: { ref: "main" },
      additions: 12,
      deletions: 3,
      changed_files: 5,
      comments: 1,
      review_comments: 2,
    }
    expect(github("github-pr", pr)).toMatchObject({
      head: "activity-indicators",
      base: "main",
      additions: 12,
      deletions: 3,
      changedFiles: 5,
      comments: 3,
    })
    expect(github("github-issue", pr)?.head).toBeUndefined()
  })

  test("drops avatars that are not served from GitHub's CDN", () => {
    const result = github("github-issue", {
      title: "x",
      state: "open",
      user: { login: "eve", avatar_url: "https://evil.example/a.png" },
    })
    expect(result?.author).toEqual({ name: "eve", avatarUrl: undefined })
  })

  test("ignores malformed label colours and caps the label list", () => {
    const result = github("github-issue", {
      title: "x",
      state: "open",
      labels: [{ name: "a", color: "not-a-colour" }, ...Array.from({ length: 10 }, (_, index) => ({ name: `l${index}` }))],
    })
    expect(result?.labels?.[0]).toEqual({ name: "a" })
    expect(result?.labels).toHaveLength(6)
  })

  test("rejects malformed bodies", () => {
    expect(LinkPreview.githubResult("github-issue", "not json")).toBeUndefined()
    expect(github("github-issue", { state: "open" })).toBeUndefined()
    expect(github("github-issue", { title: "x", state: "weird" })).toBeUndefined()
  })
})

describe("LinkPreview.githubResult for releases", () => {
  const release = {
    tag_name: "v1.18.30-v0.2.0",
    name: "Forge v1.18.30-v0.2.0",
    body: "## What's Changed\n* forge release by @divyanshusingh2903 in https://github.com/divyanshusingh2903/forge/pull/17\n\n**Full Changelog**: https://github.com/x/y/commits/v1",
    draft: false,
    prerelease: false,
    published_at: "2026-09-28T21:06:20Z",
    author: { login: "github-actions[bot]", avatar_url: "https://avatars.githubusercontent.com/in/15368?v=4" },
    assets: [
      { name: "a.deb", download_count: 2 },
      { name: "latest-linux.yml", download_count: 441 },
      { name: "b.exe", download_count: 0 },
    ],
  }

  test("summarises tag, assets, downloads and a plain-text lead-in", () => {
    expect(github("github-release", release)).toEqual({
      outcome: "ok",
      title: "Forge v1.18.30-v0.2.0",
      tag: "v1.18.30-v0.2.0",
      state: "release",
      author: { name: "github-actions[bot]", avatarUrl: "https://avatars.githubusercontent.com/in/15368?v=4" },
      publishedAt: "2026-09-28T21:06:20Z",
      summary: "What's Changed forge release",
      assets: 3,
      downloads: 443,
    })
  })

  test("flags pre-releases and drafts, and falls back to the tag when unnamed", () => {
    expect(github("github-release", { ...release, prerelease: true })?.state).toBe("prerelease")
    expect(github("github-release", { ...release, draft: true, prerelease: true })?.state).toBe("draft")
    expect(github("github-release", { tag_name: "v2", name: "" })?.title).toBe("v2")
    expect(github("github-release", { name: "", tag_name: "" })).toBeUndefined()
  })
})

describe("LinkPreview.linearResult", () => {
  test("maps an issue: identifier from id, plain-string status, nested names", () => {
    expect(
      LinkPreview.linearResult(
        JSON.stringify({
          id: "VIH-37",
          title: "vihayas-iam — API key mint, revoke, and list per user",
          status: "In Progress",
          priority: { value: 1, name: "Urgent" },
          assignee: "divyanshusingh2903@gmail.com",
          project: "Vihayas Core",
          team: "Vihayas Engineering",
          updatedAt: "2026-07-22T23:18:33.676Z",
        }),
      ),
    ).toEqual({
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
    })
  })

  test("infers a state type from conventional issue status names", () => {
    const type = (status: string) => LinkPreview.linearResult(JSON.stringify({ id: "A-1", title: "t", status }))?.stateType
    expect(type("Done")).toBe("completed")
    expect(type("In Review")).toBe("started")
    expect(type("Todo")).toBe("unstarted")
    expect(type("Backlog")).toBe("backlog")
    expect(type("Canceled")).toBe("canceled")
    expect(type("Duplicate")).toBe("canceled")
    expect(type("Waiting on vendor")).toBeUndefined()
  })

  test("maps a project: status object, team, dates and initiatives", () => {
    expect(
      LinkPreview.linearResult(
        JSON.stringify({
          id: "P-VIH-2",
          name: "Vihayas Core",
          summary: "",
          priority: { value: 0, name: "No priority" },
          lead: {},
          leadTeam: { name: "Vihayas Engineering", key: "VIH" },
          startDate: "2026-05-29",
          targetDate: null,
          initiatives: [{ id: "b5", name: "Vihayas Platform MVP" }],
          status: { id: "96", name: "In Progress", type: "started" },
          teams: [{ name: "Vihayas Engineering" }],
        }),
      ),
    ).toEqual({
      outcome: "ok",
      title: "Vihayas Core",
      identifier: "P-VIH-2",
      state: "In Progress",
      stateType: "started",
      priority: "No priority",
      team: "Vihayas Engineering",
      startDate: "2026-05-29",
      initiatives: ["Vihayas Platform MVP"],
    })
  })

  test("returns nothing for non-JSON or untitled responses", () => {
    expect(LinkPreview.linearResult("# Markdown answer")).toBeUndefined()
    expect(LinkPreview.linearResult(JSON.stringify({ status: "Done" }))).toBeUndefined()
  })
})

describe("LinkPreview.failureResult", () => {
  test("classifies gh and MCP error text", () => {
    expect(LinkPreview.failureResult("gh: Not Found (HTTP 404)").outcome).toBe("not-found")
    expect(LinkPreview.failureResult("gh: Resource not accessible (HTTP 403)").outcome).toBe("forbidden")
    expect(LinkPreview.failureResult("To get started with GitHub CLI, please run: gh auth login").outcome).toBe(
      "forbidden",
    )
    expect(LinkPreview.failureResult("connection reset").outcome).toBe("unavailable")
  })
})
