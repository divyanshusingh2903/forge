import { describe, expect, test } from "bun:test"
import { LinkPreview } from "@opencode/core/link-preview"

describe("LinkPreview mappers", () => {
  test("maps a merged GitHub pull request", () => {
    const result = LinkPreview.githubResult(
      "github-pr",
      JSON.stringify({
        title: "Add previews",
        state: "closed",
        merged_at: "2026-10-01T00:00:00Z",
        user: { login: "octo", avatar_url: "https://avatars.githubusercontent.com/u/1" },
        head: { ref: "previews" },
        base: { ref: "main" },
        comments: 2,
        review_comments: 3,
        labels: [{ name: "feature", color: "00ff00" }],
      }),
    )
    expect(result).toMatchObject({ outcome: "ok", state: "merged", head: "previews", base: "main", comments: 5 })
    expect(result?.author?.avatarUrl).toBe("https://avatars.githubusercontent.com/u/1")
  })

  test("maps GitLab issues and draft merge requests onto GitHub's states", () => {
    expect(
      LinkPreview.gitlabResult(
        "gitlab-mr",
        JSON.stringify({
          title: "Draft: rework",
          state: "opened",
          draft: true,
          author: { username: "dev", avatar_url: "https://evil.example/a.png" },
          source_branch: "rework",
          target_branch: "main",
          changes_count: "12",
          labels: ["backend"],
        }),
      ),
    ).toEqual({
      outcome: "ok",
      title: "Draft: rework",
      state: "draft",
      author: { name: "dev", avatarUrl: undefined },
      labels: [{ name: "backend", color: undefined }],
      head: "rework",
      base: "main",
      changedFiles: 12,
    })
    expect(LinkPreview.gitlabResult("gitlab-issue", JSON.stringify({ title: "Bug", state: "closed" }))?.state).toBe(
      "closed",
    )
  })

  test("maps a work item from the GitLab MCP server", () => {
    expect(
      LinkPreview.gitlabResult(
        "gitlab-issue",
        JSON.stringify({
          iid: "1",
          title: "Test Issue",
          state: "OPEN",
          createdAt: "2026-11-02T22:59:45Z",
          updatedAt: "2026-11-02T22:59:45Z",
          closedAt: null,
          author: { name: "Divyanshu Singh", username: "divyanshusingh2903" },
          workItemType: { name: "Issue" },
          widgets: [
            { type: "ASSIGNEES", assignees: { nodes: [] } },
            { type: "LABELS", labels: { nodes: [{ title: "bug", color: "#dc143c" }] } },
          ],
        }),
      ),
    ).toEqual({
      outcome: "ok",
      title: "Test Issue",
      state: "open",
      author: { name: "divyanshusingh2903" },
      labels: [{ name: "bug", color: "dc143c" }],
      createdAt: "2026-11-02T22:59:45Z",
      updatedAt: "2026-11-02T22:59:45Z",
    })
  })

  test("maps a Jira issue from the Atlassian MCP server", () => {
    expect(
      LinkPreview.jiraResult(
        JSON.stringify({
          key: "OPS-12",
          fields: {
            summary: "Rotate keys",
            status: { name: "In Review", statusCategory: { key: "indeterminate" } },
            issuetype: { name: "Task" },
            priority: { name: "High" },
            assignee: { displayName: "Sam" },
            project: { name: "Operations" },
            labels: ["security"],
          },
        }),
      ),
    ).toMatchObject({
      outcome: "ok",
      title: "Rotate keys",
      state: "In Review",
      stateType: "started",
      identifier: "OPS-12",
      issueType: "Task",
      priority: "High",
      assignee: "Sam",
      project: "Operations",
    })
    expect(LinkPreview.jiraResult("not json")).toBeUndefined()
  })

  test("maps a Notion page from the Notion MCP server", () => {
    const text = [
      '<page url="https://app.notion.com/p/36b86afd4db28057b82ec47ff146517e">',
      "<properties>",
      JSON.stringify({
        Name: "Launch checklist",
        Status: "In progress",
        Owner: '["user://5c0d"]',
        Tags: '["Launch","Q4"]',
        "date:Due:start": "2026-11-20",
        "date:Due:is_datetime": 0,
        Shipped: "__NO__",
        Reviewed: "__YES__",
        Spec: "https://app.notion.com/p/41886afd4db28225889281c107e96307",
      }),
      "</properties>",
      "<content>",
      "# Launch checklist\n\n<table><tr><td>**Owner**</td></tr></table>\nShip the **v2** port.",
      "</content>",
      "</page>",
    ].join("\n")
    expect(
      LinkPreview.notionResult(
        JSON.stringify({
          metadata: { type: "page" },
          title: "Launch checklist",
          icon: { type: "emoji", emoji: "🚀" },
          path: "Home / Projects",
          page_last_edited_at: "2026-11-02T18:17:27.225Z",
          text,
        }),
      ),
    ).toEqual({
      outcome: "ok",
      title: "Launch checklist",
      state: "In progress",
      stateType: "started",
      path: "Home / Projects",
      icon: "🚀",
      fields: [
        { name: "Tags", value: "Launch, Q4" },
        { name: "Due", value: "2026-11-20" },
        { name: "Reviewed", value: "Yes" },
      ],
      updatedAt: "2026-11-02T18:17:27.225Z",
      summary: "Launch checklist Owner Ship the v2 port.",
    })
    expect(LinkPreview.notionResult(JSON.stringify({ name: "APIResponseError", status: 404 }))).toBeUndefined()
  })

  test("classifies failures", () => {
    expect(LinkPreview.failureResult("HTTP 404: Not Found")).toEqual({ outcome: "not-found" })
    expect(LinkPreview.failureResult("To get started with GitHub CLI, please run: gh auth login")).toEqual({
      outcome: "unavailable",
    })
    expect(LinkPreview.failureResult("HTTP 403: Resource not accessible by integration")).toEqual({
      outcome: "forbidden",
    })
    expect(LinkPreview.failureResult("connection reset")).toEqual({ outcome: "unavailable" })
  })
})
