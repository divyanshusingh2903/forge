import { describe, expect, test } from "bun:test"
import type { Reference } from "./reference"
import { compactNumber, initials, relativeTime, stateTone, visiblePriority } from "./reference-view"

const issue: Reference = { kind: "github-issue", owner: "a", repo: "b", number: 1 }
const pr: Reference = { kind: "github-pr", owner: "a", repo: "b", number: 1 }
const release: Reference = { kind: "github-release", owner: "a", repo: "b", tag: "v1" }
const linear: Reference = { kind: "linear-issue", workspace: "w", id: "A-1" }

describe("stateTone", () => {
  test("colours GitHub issues, pull requests and releases", () => {
    expect(stateTone(issue, { outcome: "ok", state: "open" })).toBe("success")
    expect(stateTone(issue, { outcome: "ok", state: "closed" })).toBe("done")
    expect(stateTone(issue, { outcome: "ok", state: "not-planned" })).toBe("muted")
    expect(stateTone(pr, { outcome: "ok", state: "merged" })).toBe("done")
    expect(stateTone(pr, { outcome: "ok", state: "closed" })).toBe("danger")
    expect(stateTone(pr, { outcome: "ok", state: "draft" })).toBe("muted")
    expect(stateTone(release, { outcome: "ok", state: "release" })).toBe("accent")
    expect(stateTone(release, { outcome: "ok", state: "prerelease" })).toBe("warning")
  })

  test("colours Linear items from their state type", () => {
    const tone = (stateType?: string) => stateTone(linear, { outcome: "ok", state: "x", stateType })
    expect(tone("started")).toBe("warning")
    expect(tone("completed")).toBe("done")
    expect(tone("canceled")).toBe("danger")
    expect(tone("backlog")).toBe("muted")
    expect(tone()).toBe("muted")
  })
})

describe("relativeTime", () => {
  const now = Date.parse("2026-10-04T12:00:00Z")
  test("picks the largest fitting unit", () => {
    expect(relativeTime("2026-10-04T09:00:00Z", "en", now)).toBe("3 hours ago")
    expect(relativeTime("2026-10-01T12:00:00Z", "en", now)).toBe("3 days ago")
    expect(relativeTime("2026-09-04T12:00:00Z", "en", now)).toBe("last month")
    expect(relativeTime("2025-10-04T12:00:00Z", "en", now)).toBe("last year")
    expect(relativeTime("2026-10-04T11:59:40Z", "en", now)).toBe("20 seconds ago")
  })

  test("follows the locale and tolerates bad input", () => {
    expect(relativeTime("2026-10-03T12:00:00Z", "es", now)).toBe("ayer")
    expect(relativeTime(undefined, "en", now)).toBeUndefined()
    expect(relativeTime("not a date", "en", now)).toBeUndefined()
  })
})

describe("small helpers", () => {
  test("compactNumber", () => expect(compactNumber(1500, "en")).toBe("1.5K"))
  test("visiblePriority hides the empty value", () => {
    expect(visiblePriority("Urgent")).toBe("Urgent")
    expect(visiblePriority("No priority")).toBeUndefined()
    expect(visiblePriority(undefined)).toBeUndefined()
  })
  test("initials strips the bot suffix", () => {
    expect(initials("github-actions[bot]")).toBe("G")
    expect(initials("")).toBe("?")
  })
})
