import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { app, autoUpdater, shell } from "electron"
import pkg from "electron-updater"
import { Effect } from "effect"
import type { Platform } from "./machine"
import { isManualSignature } from "./signature"

const updateClient = pkg.autoUpdater

const execFileAsync = promisify(execFile)

const restartTimeout = 10_000

const unpackTimeout = 120_000

const signatureTimeout = 10_000

// Release tags carry both the OpenCode and the Forge version, so the newest release is linked rather than built from
// the app version. electron-updater found the update on that same latest release.
const releasePage = "https://github.com/divyanshusingh2903/forge/releases/latest"

export const make = Effect.fn("Updater.platform")(function* (channel: string) {
  const userAgent = `forge/${channel === "prod" ? "latest" : channel}/${app.getVersion()}/desktop`
  const runFork = Effect.runForkWith(yield* Effect.context())
  const manual = yield* manualInstall
  updateClient.logger = {
    info: (...args) => runFork(Effect.logInfo(...args)),
    warn: (...args) => runFork(Effect.logWarning(...args)),
    error: (...args) => runFork(Effect.logError(...args)),
    debug: (...args) => runFork(Effect.logDebug(...args)),
  }
  updateClient.channel = "latest"
  updateClient.requestHeaders = { "User-Agent": userAgent }
  updateClient.allowPrerelease = false
  updateClient.allowDowngrade = true
  updateClient.autoDownload = false
  // Squirrel.Mac only installs updates signed by the same Developer ID, so a build without one never installs on quit.
  updateClient.autoInstallOnAppQuit = process.platform === "darwin" && !manual
  yield* Effect.logInfo("auto updater configured", {
    manual,
    channel: updateClient.channel,
    allowPrerelease: updateClient.allowPrerelease,
    allowDowngrade: updateClient.allowDowngrade,
    currentVersion: app.getVersion(),
  })

  return {
    checkForUpdate: Effect.tryPromise({
      try: async () => {
        const result = await updateClient.checkForUpdates()

        if (!result?.isUpdateAvailable) return undefined
        const files = result.updateInfo.files
        // electron-updater picks the installer whose name contains process.arch, which emulation on Windows ARM64
        // reports as x64. downloadUpdate() reads this same list, so keeping only the ARM64 installer moves the install
        // to the native build. macOS needs nothing here: electron-updater already prefers arm64 under Rosetta.
        const native = files.filter((file) => file.url.includes("arm64"))

        if (process.platform === "win32" && app.runningUnderARM64Translation && native.length > 0) {
          files.splice(0, files.length, ...native)
          runFork(
            Effect.logInfo("updating emulated x64 install to native ARM64", { urls: native.map((file) => file.url) }),
          )
        }

        if (manual) return { mode: "external", version: result.updateInfo.version, url: releasePage } as const

        return { mode: "restart", version: result.updateInfo.version } as const
      },
      catch: (error) => error,
    }),
    stageUpdate,
    installAndRestart,
    externalInstall: (url) => Effect.tryPromise(() => shell.openExternal(url)),
  } satisfies Platform
})

/**
 * Whether this build must be updated by hand. Release builds without an Apple Developer ID are ad-hoc signed, and
 * Squirrel.Mac rejects an update whose signature does not match the running app's, so those builds open the release
 * page instead. A signature that cannot be read counts as ad-hoc, so it never reaches Squirrel.
 */
const manualInstall = Effect.gen(function* () {
  if (process.platform !== "darwin") return false

  const bundle = path.resolve(path.dirname(process.execPath), "../..")

  const signature = yield* Effect.tryPromise(() =>
    execFileAsync("/usr/bin/codesign", ["-dv", "--verbose=4", bundle], { timeout: signatureTimeout }),
  ).pipe(
    Effect.map((result) => result.stderr),
    Effect.catch((error) =>
      Effect.logWarning("app signature unreadable, updating by hand", { message: String(error.cause) }).pipe(
        Effect.as(undefined),
      ),
    ),
  )

  return signature === undefined || isManualSignature(signature)
})

function stageUpdate(options: { readonly differential: boolean }) {
  if (process.platform !== "darwin")
    return Effect.tryPromise({
      try: () => {
        // Only the NSIS cache goes stale: macOS refreshes its cached zip with every download and AppImage reads the
        // blockmap embedded in the running file. An emulated x64 install updates to the ARM64 installer, which cannot
        // be patched from the cached x64 one.
        updateClient.disableDifferentialDownload =
          process.platform === "win32" && (!options.differential || app.runningUnderARM64Translation)

        return updateClient.downloadUpdate()
      },
      catch: (error) => error,
    }).pipe(Effect.flatMap(unpackInstaller))

  return Effect.callback<void, Error>((resume) => {
    const cleanup = () => {
      autoUpdater.removeListener("update-downloaded", complete)
      updateClient.removeListener("error", fail)
    }

    const complete = () => {
      cleanup()
      resume(Effect.void)
    }

    const fail = (error: Error) => {
      cleanup()
      resume(Effect.fail(error))
    }

    autoUpdater.once("update-downloaded", complete)
    updateClient.once("error", fail)
    void updateClient.downloadUpdate().catch(fail)

    return Effect.sync(cleanup)
  })
}

// The NSIS installer unpacks the update beside the install directory while the app keeps running, so the
// install after the restart moves one directory into place instead of decompressing the whole app. When this
// fails, the restart still installs the update, only slower.
function unpackInstaller(files: string[]) {
  const installer = files.find((file) => file.endsWith(".exe"))

  if (process.platform !== "win32" || !app.isPackaged || !installer) return Effect.void

  return Effect.tryPromise(() =>
    execFileAsync(installer, ["--stage"], { windowsHide: true, timeout: unpackTimeout }),
  ).pipe(
    Effect.andThen(Effect.logInfo("update unpacked before restart", { installer })),
    Effect.catch((error) =>
      Effect.logWarning("update not unpacked before restart", {
        installer,
        message: error.cause instanceof Error ? error.cause.message : String(error.cause),
      }),
    ),
  )
}

const installAndRestart = Effect.callback<void, Error>((resume) => {
  const cleanup = () => {
    autoUpdater.removeListener("before-quit-for-update", started)
    updateClient.removeListener("error", fail)
  }

  const started = () => {
    cleanup()
    resume(Effect.void)
  }

  const fail = (error: Error) => {
    cleanup()
    resume(Effect.fail(error))
  }

  autoUpdater.once("before-quit-for-update", started)
  updateClient.once("error", fail)

  try {
    updateClient.quitAndInstall()
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)))
  }

  return Effect.sync(cleanup)
}).pipe(
  Effect.timeoutOrElse({
    duration: restartTimeout,
    orElse: () =>
      Effect.logError("update restart did not start").pipe(
        Effect.andThen(Effect.fail(new Error("Update restart did not start"))),
      ),
  }),
)
