import { expect, test } from "bun:test"
import { isManualSignature } from "./signature"

test("only a Developer ID signature updates itself", () => {
  expect(isManualSignature("Executable=/Applications/Forge.app\nSignature=adhoc\nTeamIdentifier=not set")).toBe(true)
  expect(
    isManualSignature(
      [
        "Executable=/Applications/Forge.app",
        "Authority=Developer ID Application: Example (TEAM123)",
        "Authority=Developer ID Certification Authority",
        "Authority=Apple Root CA",
      ].join("\n"),
    ),
  ).toBe(false)
  expect(isManualSignature("Authority=Apple Development: dev@example.com (TEAM123)")).toBe(true)
  expect(isManualSignature("")).toBe(true)
})
