import { describe, expect, test } from "bun:test"
import { updaterAction } from "./updater-action"

describe("updaterAction", () => {
  test("disables update actions when the platform has no updater", () => {
    expect(updaterAction(undefined)).toEqual({ label: "settings.updates.action.checkNow" })
  })

  test("offers manual download for a ready release page", () => {
    expect(
      updaterAction({
        status: "ready",
        version: "1.19.0-v0.4.0",
        manualUrl: "https://github.com/divyanshusingh2903/forge/releases/tag/v1.19.0-v0.4.0",
      }),
    ).toEqual({ label: "toast.update.action.download", run: "install" })
  })

  test("projects updater transitions into one settings action", () => {
    expect(updaterAction({ status: "idle" })).toEqual({
      label: "settings.updates.action.checkNow",
      run: "check",
    })
    expect(updaterAction({ status: "checking" })).toEqual({ label: "settings.updates.action.checking" })
    expect(updaterAction({ status: "downloading", version: "2.0.0" })).toEqual({
      label: "settings.updates.action.downloading",
    })
    expect(updaterAction({ status: "ready", version: "2.0.0" })).toEqual({
      label: "toast.update.action.installRestart",
      run: "install",
    })
    expect(updaterAction({ status: "installing", version: "2.0.0" })).toEqual({
      label: "settings.updates.action.installing",
    })
  })
})
