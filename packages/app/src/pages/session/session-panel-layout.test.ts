import { describe, expect, test } from "bun:test"
import { resolveRightPanelToggle, sessionPanelLayout } from "./session-panel-layout"

describe("sessionPanelLayout", () => {
  test("keeps one V2 owner while changing panel geometry", () => {
    expect(sessionPanelLayout({ review: false, terminal: false, files: false })).toEqual({
      visible: false,
      stacked: false,
    })
    expect(sessionPanelLayout({ review: false, terminal: true, files: false })).toEqual({
      visible: true,
      stacked: false,
    })
    expect(sessionPanelLayout({ review: true, terminal: true, files: false })).toEqual({
      visible: true,
      stacked: true,
    })
  })

  test("includes browser visibility and stacks browser with terminal", () => {
    expect(sessionPanelLayout({ review: false, browser: true, terminal: false, files: false })).toEqual({
      visible: true,
      stacked: false,
    })
    expect(sessionPanelLayout({ review: false, browser: true, terminal: true, files: false })).toEqual({
      visible: true,
      stacked: true,
    })
  })

  test("enforces user-initiated mutual exclusion between browser and review panels", () => {
    expect(
      resolveRightPanelToggle({ review: true, browser: false }, { type: "browser", open: true }),
    ).toEqual({
      review: false,
      browser: true,
      activity: false,
    })

    expect(
      resolveRightPanelToggle({ review: false, browser: true }, { type: "review", open: true }),
    ).toEqual({
      review: true,
      browser: false,
      activity: false,
    })

    expect(
      resolveRightPanelToggle({ review: true, browser: false }, { type: "browser", open: true, auto: true }),
    ).toEqual({
      review: true,
      browser: false,
      activity: true,
    })

    expect(
      resolveRightPanelToggle({ review: false, browser: false }, { type: "browser", open: true, auto: true }),
    ).toEqual({
      review: false,
      browser: true,
      activity: false,
    })
  })
})
