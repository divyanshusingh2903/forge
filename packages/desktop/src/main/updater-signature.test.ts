import { describe, expect, test } from "bun:test"
import { createManualUpdateUrl } from "./updater-signature"

describe("macOS manual update policy", () => {
  test.each([
    ["ad-hoc", "Signature=adhoc\n", true],
    ["unsigned", "code object is not signed at all\n", true],
    ["other identity", "Authority=Apple Development: Example\n", true],
    [
      "Developer ID",
      "Authority=Developer ID Application: Example (TEAM)\nAuthority=Developer ID Certification Authority\n",
      false,
    ],
  ])("handles %s signing", async (_, signature, manual) => {
    const bundles: string[] = []
    const url = createManualUpdateUrl({
      platform: "darwin",
      packaged: true,
      executable: "/Applications/Forge.app/Contents/MacOS/Forge",
      inspect: async (bundle) => {
        bundles.push(bundle)
        return signature
      },
    })

    expect(await url("1.19.0-v0.4.0")).toBe(
      manual ? "https://github.com/divyanshusingh2903/forge/releases/tag/v1.19.0-v0.4.0" : undefined,
    )
    expect(await url("1.20.0-v0.5.0")).toBe(
      manual ? "https://github.com/divyanshusingh2903/forge/releases/tag/v1.20.0-v0.5.0" : undefined,
    )
    expect(bundles).toEqual(["/Applications/Forge.app"])
  })

  test("caches failed inspection across concurrent requests", async () => {
    const calls: string[] = []
    const url = createManualUpdateUrl({
      platform: "darwin",
      packaged: true,
      executable: "/Applications/Forge.app/Contents/MacOS/Forge",
      inspect: async (bundle) => {
        calls.push(bundle)
        throw new Error("codesign failed")
      },
    })

    expect(await Promise.all([url("2.0.0"), url("2.0.0")])).toEqual([
      "https://github.com/divyanshusingh2903/forge/releases/tag/v2.0.0",
      "https://github.com/divyanshusingh2903/forge/releases/tag/v2.0.0",
    ])
    expect(calls).toHaveLength(1)
  })

  test.each([
    ["linux", true],
    ["win32", true],
    ["darwin", false],
  ])("does not inspect platform %s (packaged: %p)", async (platform, packaged) => {
    const calls: string[] = []
    const url = createManualUpdateUrl({
      platform,
      packaged,
      executable: "/unused",
      inspect: async (bundle) => {
        calls.push(bundle)
        return "Signature=adhoc"
      },
    })

    expect(await url("2.0.0")).toBeUndefined()
    expect(calls).toEqual([])
  })
})
