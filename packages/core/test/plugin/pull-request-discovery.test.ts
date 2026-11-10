import { describe, expect, test } from "bun:test"
import { PullRequestDiscovery } from "@opencode/core/plugin/pull-request-discovery"

describe("pull request creation provenance", () => {
  test.each([
    ["gh pr create --title 'A pull request' --body-file /tmp/body.md", "github"],
    ["glab mr create --title 'An MR' --description 'Changes'", "gitlab"],
    ["gh pr view 12", undefined],
    ["echo 'gh pr create'", undefined],
    ["echo https://github.com/a/b/pull/1", undefined],
    ["gh pr create --title x || echo https://github.com/a/b/pull/1", undefined],
    ["gh pr create --title x; gh pr view 1", undefined],
  ] as const)("only admits a standalone creation invocation: %s", (command, provider) => {
    expect(PullRequestDiscovery.cli(command)).toBe(provider)
  })

  test("keeps host, provider, repository and number in the deduplicated identity", () => {
    expect(PullRequestDiscovery.identity("https://github.com/Owner/Repo/pull/12?tab=checks")).toMatchObject({
      key: "github:github.com/owner/repo#12",
      host: "github.com",
      provider: "github",
      repository: "Owner/Repo",
      number: 12,
    })
    expect(PullRequestDiscovery.identity("https://gitlab.com/group/sub/project/-/merge_requests/12")).toMatchObject({
      key: "gitlab:gitlab.com/group/sub/project#12",
      repository: "group/sub/project",
      number: 12,
    })
  })

  test.each([
    "https://github.com/a/b/issues/1",
    "https://github.com/a/b/pull/1/files",
    "https://github.com.evil.example/a/b/pull/1",
    "https://github.com@evil.example/a/b/pull/1",
    "https://user:password@github.com/a/b/pull/1",
    "https://github.com:8443/a/b/pull/1",
    "https://gitlab.com/a/b/-/issues/1",
  ])("does not claim an unrelated or unsafe URL: %s", (url) => {
    expect(PullRequestDiscovery.identity(url)).toBeUndefined()
  })

  test("reads successful provider output, not a URL mentioned inside its body", () => {
    expect(PullRequestDiscovery.created({ html_url: "https://github.com/a/b/pull/1" }, "github")?.number).toBe(1)
    expect(
      PullRequestDiscovery.created(
        JSON.stringify({ web_url: "https://gitlab.com/a/b/-/merge_requests/2" }),
        "gitlab",
      )?.number,
    ).toBe(2)
    expect(PullRequestDiscovery.created({ body: "See https://github.com/a/b/pull/1" }, "github")).toBeUndefined()
    expect(
      PullRequestDiscovery.created({ isError: true, url: "https://github.com/a/b/pull/1" }, "github"),
    ).toBeUndefined()
    expect(
      PullRequestDiscovery.created("Creating merge request…\nhttps://gitlab.com/a/b/-/merge_requests/2\n", "gitlab")
        ?.number,
    ).toBe(2)
    expect(PullRequestDiscovery.created("https://gitlab.com/a/b/-/merge_requests/2", "github")).toBeUndefined()
    expect(PullRequestDiscovery.provider("company_connector_create_pull_request")).toBe("github")
    expect(PullRequestDiscovery.provider("github_get_pull_request")).toBeUndefined()
  })
})
