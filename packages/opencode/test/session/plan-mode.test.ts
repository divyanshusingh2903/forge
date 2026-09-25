import { expect, test } from "bun:test"
import PLAN_MODE from "../../src/session/prompt/plan-mode.txt"

test("plan mode requires repository-backed implementation plans", () => {
  expect(PLAN_MODE).toContain("## Context")
  expect(PLAN_MODE).toContain("## Design decisions")
  expect(PLAN_MODE).toContain("## Changes")
  expect(PLAN_MODE).toContain("## Out of scope")
  expect(PLAN_MODE).toContain("## Verification")
  expect(PLAN_MODE).toContain("## Files touched")
  expect(PLAN_MODE).toContain("repository-backed evidence")
  expect(PLAN_MODE).toContain("exact path and target symbol or location")
  expect(PLAN_MODE).toContain("Scale detail to scope")
  expect(PLAN_MODE).toContain("general subagent")
  expect(PLAN_MODE).toContain("preserve confirmed findings")
  expect(PLAN_MODE).toContain("present_plan")
})
