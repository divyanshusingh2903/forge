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

describe("LinkPreview sub-issue progress", () => {
  const closed = (reason?: string) => ({ state: "closed", state_reason: reason ?? "completed" })
  const open = { state: "open" }

  test("reads the aggregate GitHub carries on an issue", () => {
    expect(LinkPreview.githubSubIssues(JSON.stringify({ sub_issues_summary: { total: 4, completed: 1 } }))).toEqual({
      total: 4,
      completed: 1,
    })
    expect(LinkPreview.githubSubIssues(JSON.stringify({ title: "no hierarchy on this instance" }))).toBeUndefined()
  })

  test("a partly complete issue splits closed children into completed and not planned", () => {
    expect(
      LinkPreview.githubProgress({ total: 4, completed: 2 }, [closed(), closed("not_planned"), open, open]),
    ).toEqual({ status: "ok", completed: 1, cancelled: 1, open: 2, total: 4, partial: false })
  })

  test("an issue with nothing closed needs no listing", () => {
    expect(LinkPreview.githubProgress({ total: 3, completed: 0 }, [])).toEqual({
      status: "ok",
      completed: 0,
      cancelled: 0,
      open: 3,
      total: 3,
      partial: false,
    })
  })

  test("an all-complete issue is complete without counting not planned children", () => {
    expect(LinkPreview.githubProgress({ total: 2, completed: 2 }, [closed(), closed()])).toMatchObject({
      completed: 2,
      cancelled: 0,
      open: 0,
      total: 2,
    })
  })

  test("a listing that stops short keeps the aggregate total and says it is partial", () => {
    expect(LinkPreview.githubProgress({ total: 450, completed: 300 }, Array.from({ length: 300 }, () => closed()))).toEqual({
      status: "ok",
      completed: 300,
      cancelled: 0,
      open: 150,
      total: 450,
      partial: true,
    })
  })

  test("the first page of children does not become the total", () => {
    const children = LinkPreview.githubChildren(JSON.stringify(Array.from({ length: 100 }, () => open)))
    expect(children).toHaveLength(100)
    expect(LinkPreview.githubProgress({ total: 120, completed: 20 }, children ?? []).total).toBe(120)
  })

  test("maps GitLab work item children and an issue without any", () => {
    const query = (children: unknown) =>
      JSON.stringify({ data: { project: { workItems: { nodes: [{ widgets: [{ type: "HIERARCHY", children }] }] } } } })

    expect(
      LinkPreview.gitlabChildren(
        query({ pageInfo: { hasNextPage: true }, nodes: [{ state: "OPEN" }, { state: "CLOSED" }, { state: "CLOSED" }] }),
      ),
    ).toEqual({ status: "ok", completed: 2, cancelled: 0, open: 1, total: 3, partial: true })
    expect(LinkPreview.gitlabChildren(query({ pageInfo: { hasNextPage: false }, nodes: [] }))).toBe("none")
    expect(LinkPreview.gitlabChildren(JSON.stringify({ data: { project: null } }))).toBeUndefined()
  })

  test("takes GitLab hierarchy children from an MCP work item", () => {
    const result = LinkPreview.gitlabResult(
      "gitlab-issue",
      JSON.stringify({
        title: "Epic",
        state: "OPEN",
        widgets: [{ type: "HIERARCHY", children: { nodes: [{ state: "CLOSED" }, { state: "OPEN" }] } }],
      }),
    )
    expect(result?.progress).toMatchObject({ completed: 1, open: 1, total: 2 })
  })

  test("Linear separates completed from cancelled children by status type", () => {
    const result = LinkPreview.linearChildren(
      JSON.stringify({
        issues: [
          { status: "Done" },
          { status: "Canceled" },
          { status: "In Progress" },
          { status: { name: "Shipped", type: "completed" } },
        ],
        hasNextPage: false,
      }),
    )
    expect(result?.progress).toEqual({ status: "ok", completed: 2, cancelled: 1, open: 1, total: 4, partial: false })
    expect(LinkPreview.linearChildren(JSON.stringify({ issues: [] }))?.progress).toBeUndefined()
    expect(LinkPreview.linearChildren("not json")).toBeUndefined()
  })
})

describe("LinkPreview CI", () => {
  const runs = (items: unknown[], total = items.length) => ({ body: JSON.stringify({ total_count: total, check_runs: items }) })
  const statuses = (items: unknown[] = []) => ({ body: JSON.stringify({ total_count: items.length, statuses: items }) })
  const run = (name: string, status: string, conclusion: string | null = null) => ({
    name,
    status,
    conclusion,
    html_url: `https://github.com/o/r/runs/${name}`,
  })

  test("counts a mixed set of GitHub check runs as checks, never tests", () => {
    const ci = LinkPreview.githubCiResult(
      "abc",
      runs([
        run("build", "completed", "success"),
        run("lint", "completed", "failure"),
        run("e2e", "in_progress"),
        run("docs", "completed", "skipped"),
        run("old", "completed", "cancelled"),
      ]),
      statuses(),
    )
    expect(ci).toMatchObject({
      status: "ok",
      unit: "checks",
      passed: 1,
      failed: 1,
      pending: 1,
      skipped: 1,
      cancelled: 1,
      total: 5,
      complete: true,
      sha: "abc",
      failures: [{ name: "lint", url: "https://github.com/o/r/runs/lint" }],
    })
  })

  test("all passing and all failing", () => {
    expect(
      LinkPreview.githubCiResult("a", runs([run("a", "completed", "success"), run("b", "completed", "success")]), statuses()),
    ).toMatchObject({ passed: 2, failed: 0, total: 2, complete: true })
    expect(
      LinkPreview.githubCiResult("a", runs([run("a", "completed", "timed_out"), run("b", "completed", "failure")]), statuses()),
    ).toMatchObject({ passed: 0, failed: 2, total: 2 })
  })

  test("a conclusion it does not know is not counted as passing", () => {
    expect(LinkPreview.githubCiResult("a", runs([run("a", "completed", "surprise")]), statuses())).toMatchObject({
      passed: 0,
      pending: 1,
    })
  })

  test("adds legacy commit statuses and keeps only provider links", () => {
    const ci = LinkPreview.githubCiResult(
      "a",
      runs([]),
      statuses([
        { context: "ci/other", state: "failure", target_url: "https://ci.example.com/1" },
        { context: "ci/ok", state: "success", target_url: "https://github.com/o/r/1" },
      ]),
    )
    expect(ci).toMatchObject({ status: "ok", passed: 1, failed: 1, failures: [{ name: "ci/other" }] })
    expect(ci.failures[0]?.url).toBeUndefined()
  })

  test("no checks at all is none, not green", () => {
    expect(LinkPreview.githubCiResult("a", runs([]), statuses())).toMatchObject({ status: "none", total: 0, complete: true })
  })

  test("results cut short by pagination are incomplete", () => {
    expect(
      LinkPreview.githubCiResult("a", runs([run("a", "completed", "success")], 130), statuses()),
    ).toMatchObject({ status: "ok", total: 1, complete: false })
  })

  test("a source that failed is incomplete, and no source at all is unavailable or forbidden", () => {
    const failure = (outcome: "forbidden" | "unavailable") => ({ failure: { outcome } as const })
    expect(
      LinkPreview.githubCiResult("a", runs([run("a", "completed", "success")]), failure("unavailable")),
    ).toMatchObject({ status: "ok", complete: false })
    expect(LinkPreview.githubCiResult("a", failure("forbidden"), failure("forbidden"))).toMatchObject({
      status: "forbidden",
      total: 0,
    })
    expect(LinkPreview.githubCiResult("a", failure("unavailable"), statuses())).toMatchObject({
      status: "unavailable",
      complete: false,
    })
  })

  test("reads the head revision from a pull request", () => {
    expect(LinkPreview.githubHeadSha(JSON.stringify({ head: { ref: "x", sha: "deadbeef" } }))).toBe("deadbeef")
  })

  test("reads a GitLab head pipeline, or its absence", () => {
    expect(LinkPreview.gitlabPipeline(JSON.stringify({ head_pipeline: { id: 7, status: "running", sha: "f00" } }))).toEqual({
      id: 7,
      status: "running",
      sha: "f00",
    })
    expect(LinkPreview.gitlabPipeline(JSON.stringify({ head_pipeline: null }))).toBe("none")
    expect(LinkPreview.gitlabPipeline(JSON.stringify({ title: "no such field" }))).toBeUndefined()
  })

  test("counts GitLab tests when there is a report, and says the run may still add more", () => {
    const summary = { body: JSON.stringify({ total: { count: 10, success: 7, failed: 1, error: 1, skipped: 1 } }) }
    const jobs = {
      body: JSON.stringify([{ name: "rspec", status: "failed", web_url: "https://gitlab.com/g/p/-/jobs/1" }]),
    }
    expect(LinkPreview.gitlabCiResult({ id: 1, status: "success", sha: "f00" }, summary, jobs)).toMatchObject({
      unit: "tests",
      passed: 7,
      failed: 2,
      skipped: 1,
      total: 10,
      complete: true,
      failures: [{ name: "rspec", url: "https://gitlab.com/g/p/-/jobs/1" }],
    })
    expect(LinkPreview.gitlabCiResult({ id: 1, status: "running" }, summary, jobs).complete).toBe(false)
  })

  test("falls back to jobs, labelled as jobs, when there is no test report", () => {
    const jobs = {
      body: JSON.stringify([
        { name: "build", status: "success" },
        { name: "test", status: "running" },
        { name: "deploy", status: "manual" },
        { name: "scan", status: "failed", web_url: "https://evil.example/1" },
      ]),
    }
    const ci = LinkPreview.gitlabCiResult({ id: 1, status: "running" }, { failure: { outcome: "not-found" } }, jobs)
    expect(ci).toMatchObject({ status: "ok", unit: "jobs", passed: 1, pending: 1, skipped: 1, failed: 1, total: 4 })
    expect(ci.failures).toEqual([{ name: "scan" }])
    expect(
      LinkPreview.gitlabCiResult({ id: 1, status: "running" }, { body: JSON.stringify({ total: { count: 0 } }) }, jobs).unit,
    ).toBe("jobs")
  })

  test("only unfinished or truncated CI asks to be looked at again", () => {
    const base = { outcome: "ok" } as const
    const ci = LinkPreview.githubCiResult("a", runs([run("a", "in_progress")]), statuses())
    expect(LinkPreview.ciActive({ ...base, ci })).toBe(true)
    expect(
      LinkPreview.ciActive({ ...base, ci: LinkPreview.githubCiResult("a", runs([run("a", "completed", "success")]), statuses()) }),
    ).toBe(false)
    expect(LinkPreview.ciActive(base)).toBe(false)
  })
})

describe("LinkPreview GitLab children through the MCP server", () => {
  test("a work item names its parent but never lists its children", () => {
    const result = LinkPreview.gitlabResult(
      "gitlab-issue",
      JSON.stringify({
        title: "Sub-task",
        state: "OPEN",
        widgets: [{ type: "HIERARCHY", hasChildren: false, hasParent: true, parent: { iid: "2" } }],
      }),
    )
    expect(result?.progress).toBeUndefined()
  })

  test("counts the direct children list_work_items returns", () => {
    const result = LinkPreview.gitlabListedChildren(
      JSON.stringify({
        work_items: [{ state: "OPEN" }, { state: "CLOSED" }, { state: "OPEN" }],
        pageInfo: { endCursor: null, hasNextPage: false },
      }),
    )
    expect(result?.progress).toEqual({ status: "ok", completed: 1, cancelled: 0, open: 2, total: 3, partial: false })
  })

  test("a further page makes the counts a lower bound, and no children means no progress", () => {
    expect(
      LinkPreview.gitlabListedChildren(
        JSON.stringify({ work_items: [{ state: "closed" }], pageInfo: { hasNextPage: true } }),
      )?.progress?.partial,
    ).toBe(true)
    expect(
      LinkPreview.gitlabListedChildren(JSON.stringify({ work_items: [], pageInfo: { hasNextPage: false } }))?.progress,
    ).toBeUndefined()
    expect(LinkPreview.gitlabListedChildren("not json")).toBeUndefined()
  })
})
