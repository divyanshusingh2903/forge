import { describe, expect, test } from "bun:test"
import { ForgeChapters } from "@opencode/schema/forge-chapters"
import {
  AFTER_COMPACTION,
  cancelled,
  compacted,
  delivered,
  named,
  pin,
  prompted,
  remove,
  rename,
  reverted,
  stepped,
} from "@opencode/core/plugin/forge-chapters"

const empty: ForgeChapters.State = { chapters: [], seen: [] }
const issue = "https://github.com/a/b/issues/7"

describe("ForgeChapters.reference", () => {
  test("recognises issues and pull requests on both hosts", () => {
    expect(ForgeChapters.reference(issue)?.key).toBe("github-issue:github.com/a/b#7")
    expect(ForgeChapters.reference("https://github.com/a/b/pull/7")?.preview.kind).toBe("github-pr")
    expect(ForgeChapters.reference("https://gitlab.com/g/s/p/-/issues/3")?.preview).toEqual({
      kind: "gitlab-issue",
      repository: "g/s/p",
      number: 3,
    })
    expect(ForgeChapters.reference("https://gitlab.com/g/p/-/work_items/3")?.key).toBe("gitlab-issue:gitlab.com/g/p#3")
    expect(ForgeChapters.reference("https://gitlab.com/g/p/-/merge_requests/3")?.preview.kind).toBe("gitlab-mr")
  })

  test("an issue and a pull request with one number are different references", () => {
    expect(ForgeChapters.reference(issue)?.key).not.toBe(ForgeChapters.reference("https://github.com/a/b/pull/7")?.key)
  })

  test("ignores everything else", () => {
    expect(ForgeChapters.reference("#7")).toBeUndefined()
    expect(ForgeChapters.reference("https://github.com/a/b")).toBeUndefined()
    expect(ForgeChapters.reference("https://github.com/a/b/issues")).toBeUndefined()
    expect(ForgeChapters.reference("https://example.com/a/b/issues/7")).toBeUndefined()
    expect(ForgeChapters.reference("http://github.com/a/b/issues/7")).toBeUndefined()
  })

  test("finds links in prose once each, without trailing punctuation", () => {
    const found = ForgeChapters.references(`Fix ${issue}, then (see ${issue}) and https://github.com/A/B/pull/9.`)
    expect(found.map((item) => item.label)).toEqual(["a/b#7", "A/B#9"])
  })
})

describe("ForgeChapters.title", () => {
  test("takes the first non-empty line and cuts long ones", () => {
    expect(ForgeChapters.title("\n  Fix the build  \nmore")).toBe("Fix the build")
    expect(ForgeChapters.title("x".repeat(200))).toHaveLength(ForgeChapters.TITLE_MAX)
    expect(ForgeChapters.title("  \n ")).toBe("")
    expect(ForgeChapters.title("## GitLab has no **standard** `label`")).toBe("GitLab has no standard label")
    expect(ForgeChapters.title("- first item")).toBe("first item")
  })
})

describe("chapter state", () => {
  test("the user pins user and agent messages, once each, in transcript order", () => {
    const later = pin(empty, { messageID: "msg_4", turnMessageID: "msg_3", role: "assistant", title: "Result" }, 1)
    const both = pin(later, { messageID: "msg_1", turnMessageID: "msg_1", role: "user", title: "Start\nrest" }, 2)
    expect(both.chapters.map((chapter) => [chapter.anchorMessageID, chapter.role, chapter.title])).toEqual([
      ["msg_1", "user", "Start"],
      ["msg_4", "assistant", "Result"],
    ])
    expect(pin(both, { messageID: "msg_1", turnMessageID: "msg_1", role: "user", title: "Again" }, 3)).toBe(both)
  })

  test("renames and removes by anchor, and leaves unknown anchors alone", () => {
    const state = pin(empty, { messageID: "msg_1", turnMessageID: "msg_1", role: "user", title: "Start" }, 1)
    expect(rename(state, "msg_1", " New ").chapters[0]).toMatchObject({ title: "New", renamed: true })
    expect(rename(state, "msg_1", "  ")).toBe(state)
    expect(rename(state, "msg_9", "New")).toBe(state)
    expect(remove(state, "msg_1").chapters).toEqual([])
    expect(remove(state, "msg_9")).toBe(state)
  })

  test("a new reference starts a chapter on the agent's next message, never on the user's", () => {
    const asked = prompted(empty, { messageID: "msg_1", text: `Work on ${issue}` })
    expect(asked.chapters).toEqual([])
    // The agent is still answering something earlier: its message is not this chapter.
    expect(stepped(asked, "msg_0b", 1)).toBe(asked)
    const started = stepped(delivered(asked, "msg_1"), "msg_2", 1)
    expect(started.pending).toBeUndefined()
    expect(started.chapters).toEqual([
      {
        title: "a/b#7",
        anchorMessageID: "msg_2",
        turnMessageID: "msg_1",
        role: "assistant",
        source: "reference",
        reference: "github-issue:github.com/a/b#7",
        createdAt: 1,
      },
    ])
    // Later steps and later mentions start nothing.
    expect(stepped(started, "msg_3", 2)).toBe(started)
    expect(prompted(started, { messageID: "msg_4", text: `Back to ${issue}` })).toBe(started)
  })

  test("a cancelled prompt takes its chapter with it and its reference can ask again", () => {
    const asked = prompted(empty, { messageID: "msg_1", text: issue })
    const gone = cancelled(asked, "msg_1")
    expect(gone).toEqual(empty)
    expect(prompted(gone, { messageID: "msg_2", text: issue }).pending?.reference).toBe("github-issue:github.com/a/b#7")
    expect(cancelled(asked, "msg_other")).toBe(asked)
  })

  test("a compaction starts a chapter on the agent's next message", () => {
    const alone = stepped(compacted(empty), "msg_5", 1)
    expect(alone.chapters[0]).toMatchObject({
      title: AFTER_COMPACTION,
      anchorMessageID: "msg_5",
      turnMessageID: "msg_5",
      role: "assistant",
      source: "compaction",
    })

    const asked = prompted(compacted(empty), { messageID: "msg_6", text: "Now the docs" })
    expect(stepped(asked, "msg_5b", 1)).toBe(asked)
    expect(stepped(delivered(asked, "msg_6"), "msg_7", 1).chapters[0]).toMatchObject({
      title: "Now the docs",
      anchorMessageID: "msg_7",
      turnMessageID: "msg_6",
      source: "compaction",
    })
    expect(cancelled(asked, "msg_6").pending).toEqual({ source: "compaction", title: AFTER_COMPACTION })
  })

  test("a reference after a compaction makes one chapter, named for the reference", () => {
    const asked = prompted(compacted(empty), { messageID: "msg_1", text: issue })
    const started = stepped(delivered(asked, "msg_1"), "msg_2", 1)
    expect(started.chapters.map((chapter) => chapter.source)).toEqual(["reference"])
  })

  test("a revert drops the chapters it removed", () => {
    const first = pin(empty, { messageID: "msg_1", turnMessageID: "msg_1", role: "user", title: "One" }, 1)
    const second = pin(first, { messageID: "msg_4", turnMessageID: "msg_3", role: "assistant", title: "Two" }, 2)
    expect(reverted(second, "msg_3").chapters.map((chapter) => chapter.title)).toEqual(["One"])
    expect(reverted(second, "msg_9")).toBe(second)
    const asked = prompted(second, { messageID: "msg_5", text: issue })
    expect(reverted(asked, "msg_5").pending).toBeUndefined()
  })

  test("a looked-up title replaces the label until the user renames the chapter", () => {
    const key = "github-issue:github.com/a/b#7"
    const asked = prompted(empty, { messageID: "msg_1", text: issue })
    expect(named(asked, key, "#7 Fix the build").pending?.title).toBe("#7 Fix the build")
    const started = stepped(delivered(asked, "msg_1"), "msg_2", 1)
    expect(named(started, key, "#7 Fix the build").chapters[0]?.title).toBe("#7 Fix the build")
    const renamed = rename(started, "msg_2", "Mine")
    expect(named(renamed, key, "#7 Fix the build")).toBe(renamed)
    expect(named(started, "other", "Title")).toBe(started)
  })
})
