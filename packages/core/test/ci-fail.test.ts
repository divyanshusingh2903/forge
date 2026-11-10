import { expect, test } from "bun:test"

test("intentionally fails in CI", () => {
  expect(1).toBe(1)
})
