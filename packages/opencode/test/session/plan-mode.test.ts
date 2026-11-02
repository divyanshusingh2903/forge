import { expect, test } from "bun:test"
import PLAN_MODE from "../../src/session/prompt/plan-mode.txt"
import PROMPT_PLAN from "../../src/session/prompt/plan.txt"

test("plan mode requires repository-backed implementation plans", () => {
  expect(PLAN_MODE).toContain("## Context")
  expect(PLAN_MODE).toContain("## Design")
  expect(PLAN_MODE).toContain("## Changes")
  expect(PLAN_MODE).toContain("### 1. `path/to/file.ts`")
  expect(PLAN_MODE).toContain("## Tests")
  expect(PLAN_MODE).toContain("## Verification")
  expect(PLAN_MODE).toContain("## Out of scope")
  expect(PLAN_MODE).toContain("repository-backed evidence")
  expect(PLAN_MODE).toContain("exact path and target symbol or location")
  expect(PLAN_MODE).toContain("Scale detail to scope")
  expect(PLAN_MODE).toContain("general subagent")
  expect(PLAN_MODE).toContain("preserve confirmed findings")
  expect(PLAN_MODE).toContain("present_plan")
})

test("plan prompts ask for browser verification of frontend changes", () => {
  for (const prompt of [PLAN_MODE, PROMPT_PLAN]) {
    expect(prompt).toContain("browser_navigate")
    expect(prompt).toContain("browser_read")
    expect(prompt).toContain("browser_act")
    expect(prompt).toContain("browser_screenshot")
    expect(prompt).toContain("browser_act is not available")
  }
})
