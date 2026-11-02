import { describe, expect, test } from "bun:test"
import { parseReference, referenceKey, referenceLabel } from "./reference"

describe("parseReference", () => {
  test("recognises GitHub issues, pull requests and releases", () => {
    expect(parseReference("https://github.com/acme/app/issues/12")).toEqual({
      kind: "github-issue",
      repository: "acme/app",
      number: 12,
    })
    expect(parseReference("https://github.com/acme/app/pull/7/files")?.kind).toBe("github-pr")
    expect(parseReference("https://github.com/acme/app/releases/tag/v1.2%2Bbuild")).toEqual({
      kind: "github-release",
      repository: "acme/app",
      tag: "v1.2+build",
    })
  })

  test("recognises GitLab issues and merge requests in nested groups", () => {
    expect(parseReference("https://gitlab.com/group/sub/app/-/merge_requests/42")).toEqual({
      kind: "gitlab-mr",
      repository: "group/sub/app",
      number: 42,
    })
    expect(parseReference("https://gitlab.com/group/app/-/issues/3")?.kind).toBe("gitlab-issue")
    expect(parseReference("https://gitlab.com/group/app/-/work_items/1")).toEqual({
      kind: "gitlab-issue",
      repository: "group/app",
      number: 1,
    })
    expect(parseReference("https://gitlab.com/group/app/-/pipelines/3")).toBeUndefined()
  })

  test("recognises Linear and Jira items", () => {
    expect(parseReference("https://linear.app/acme/issue/ENG-1/fix-it")).toEqual({
      kind: "linear-issue",
      workspace: "acme",
      id: "ENG-1",
    })
    expect(parseReference("https://acme.atlassian.net/browse/OPS-12")).toEqual({
      kind: "jira-issue",
      site: "acme.atlassian.net",
      id: "OPS-12",
    })
    expect(parseReference("https://acme.atlassian.net/jira/software/projects/OPS/boards/1?selectedIssue=OPS-9")?.kind).toBe(
      "jira-issue",
    )
  })

  test("ignores other hosts and pages", () => {
    expect(parseReference("https://github.example.com/acme/app/issues/1")).toBeUndefined()
    expect(parseReference("https://github.com/acme/app")).toBeUndefined()
    expect(parseReference("https://acme.atlassian.net/wiki/spaces/X")).toBeUndefined()
    expect(parseReference("javascript:alert(1)")).toBeUndefined()
  })

  test("keys and labels references", () => {
    const mr = parseReference("https://gitlab.com/Group/App/-/merge_requests/5")
    expect(mr && referenceKey(mr)).toBe("gitlab-mr:group/app#5")
    expect(mr && referenceLabel(mr)).toBe("Group/App !5")
  })
})
