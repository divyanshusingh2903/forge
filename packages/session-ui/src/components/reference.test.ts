import { describe, expect, test } from "bun:test"
import { parseReference, referenceKey } from "./reference"

describe("parseReference", () => {
  test("parses GitHub issues and pull requests", () => {
    expect(parseReference("https://github.com/acme/forge/issues/6")).toEqual({
      kind: "github-issue",
      owner: "acme",
      repo: "forge",
      number: 6,
    })
    expect(parseReference("https://github.com/acme/forge/pull/22/files?w=1#diff")).toEqual({
      kind: "github-pr",
      owner: "acme",
      repo: "forge",
      number: 22,
    })
  })

  test("parses GitHub releases by tag", () => {
    expect(parseReference("https://github.com/acme/forge/releases/tag/v1.18.30-v0.2.0")).toEqual({
      kind: "github-release",
      owner: "acme",
      repo: "forge",
      tag: "v1.18.30-v0.2.0",
    })
    expect(parseReference("https://github.com/acme/forge/releases/tag/app%2Fv1")).toMatchObject({ tag: "app/v1" })
    expect(parseReference("https://github.com/acme/forge/releases")).toBeUndefined()
    expect(parseReference("https://github.com/acme/forge/releases/latest")).toBeUndefined()
  })

  test("parses Linear issues and projects", () => {
    expect(parseReference("https://linear.app/acme/issue/ENG-12/some-title")).toEqual({
      kind: "linear-issue",
      workspace: "acme",
      id: "ENG-12",
    })
    expect(parseReference("https://linear.app/acme/project/roadmap-abc123/overview")?.kind).toBe("linear-project")
    expect(parseReference("https://linear.app/acme/team/ENG/cycle/4")).toBeUndefined()
  })

  test("ignores other hosts, lookalike hosts and unrelated GitHub pages", () => {
    expect(parseReference("https://example.com/acme/forge/issues/6")).toBeUndefined()
    expect(parseReference("https://github.com.evil.dev/acme/forge/issues/6")).toBeUndefined()
    expect(parseReference("https://gist.github.com/acme/forge/issues/6")).toBeUndefined()
    expect(parseReference("https://github.com/acme/forge")).toBeUndefined()
    expect(parseReference("https://github.com/acme/forge/issues/new")).toBeUndefined()
    expect(parseReference("https://github.com/acme/forge/issues")).toBeUndefined()
    expect(parseReference("ftp://github.com/acme/forge/issues/6")).toBeUndefined()
    expect(parseReference("not a url")).toBeUndefined()
  })
})

describe("referenceKey", () => {
  test("is stable across trailing paths and casing", () => {
    const a = parseReference("https://github.com/Acme/Forge/issues/6")!
    const b = parseReference("https://github.com/acme/forge/issues/6#issuecomment-1")!
    expect(referenceKey(a)).toBe(referenceKey(b))
  })

  test("distinguishes kinds sharing a number", () => {
    const issue = parseReference("https://github.com/acme/forge/issues/6")!
    const pr = parseReference("https://github.com/acme/forge/pull/6")!
    expect(referenceKey(issue)).not.toBe(referenceKey(pr))
  })
})
