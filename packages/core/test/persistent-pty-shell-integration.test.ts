import { expect } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { makeDaemonTransport, type DaemonTransport } from "../src/persistent-pty/daemon"
import { prepareShellIntegration } from "../src/persistent-pty/shell-integration"
import { temporaryDirectory } from "./fixture/persistent-pty-daemon"
import { it } from "./lib/effect"

// The published @opencode/pty daemon predates shell integration and drops the connection on `run`, so only an
// explicitly rebuilt daemon or this checkout's own debug build can exercise it.
const local = path.join(
  import.meta.dir,
  "../../process-daemon/target/debug",
  process.platform === "win32" ? "opencode-pty.exe" : "opencode-pty",
)
const binary = process.env.OPENCODE_PTY_BIN ?? (existsSync(local) ? local : undefined)

for (const shell of ["bash", "zsh", "fish", "pwsh"]) {
  const program = Bun.which(shell)
  // The Unix HOME/XDG fixture does not replace Windows Known Folder profile paths.
  const smoke = process.platform !== "win32" && program && binary && existsSync(binary) ? it.live : it.live.skip

  smoke(`${shell}: real PTY preserves initialization, directory and exports across Run commands`, () =>
    Effect.gen(function* () {
      if (!program || !binary) throw new Error("Shell and rebuilt PTY binary required")
      const root = yield* temporaryDirectory()
      const config = path.join(root, ".config")
      yield* Effect.promise(async () => {
        await mkdir(path.join(config, "fish"), { recursive: true })
        await mkdir(path.join(config, "powershell"), { recursive: true })
        await Promise.all([
          writeFile(path.join(root, ".bashrc"), "export FORGE_PROFILE=loaded\n"),
          writeFile(path.join(root, ".zshrc"), "export FORGE_PROFILE=loaded\n"),
          writeFile(path.join(config, "fish", "config.fish"), "set -gx FORGE_PROFILE loaded\n"),
          writeFile(
            path.join(config, "powershell", "Microsoft.PowerShell_profile.ps1"),
            "$env:FORGE_PROFILE = 'loaded'\n",
          ),
        ])
      })
      const startup = yield* Effect.promise(() =>
        prepareShellIntegration(root, program, { HOME: root, XDG_CONFIG_HOME: config }),
      )
      const daemon = yield* makeDaemonTransport(path.join(root, "daemon"), "integration", () => Promise.resolve(binary))
      yield* Effect.addFinalizer(() => daemon.shutdown.pipe(Effect.ignore))
      const created = yield* daemon.request(
        {
          op: "create",
          program,
          ...startup,
          cwd: root,
          title: shell,
          group_id: "ses_shell_hooks",
          cols: 120,
          rows: 24,
        },
        true,
      )
      if (created.type !== "created") throw new Error("Expected terminal creation")
      const id = created.terminal.id
      const attachment = yield* daemon.subscribe(id, {
        cursor: 0,
        attachmentID: "run-test",
        role: "controller",
        takeover: true,
        onEvent: () => {},
        onEnd: () => {},
      })
      attachment.activate()
      yield* Effect.addFinalizer(() => Effect.sync(attachment.detach))
      yield* waitForRun(daemon, id, "first", false)
      const first =
        shell === "pwsh"
          ? "$env:FORGE_KEEP = 'kept'; Set-Location .config"
          : shell === "fish"
            ? "set -gx FORGE_KEEP kept; cd .config"
            : "export FORGE_KEEP=kept; cd .config"
      yield* daemon.request({ op: "run", id, attachment_id: "run-test", run_id: "first", command: first })
      const initial = yield* waitForRun(daemon, id, "first", true)
      expect(initial.run?.success).toBeTrue()
      const second =
        shell === "pwsh"
          ? "Write-Output $env:FORGE_PROFILE; Write-Output $env:FORGE_KEEP; (Get-Location).Path"
          : 'printf \'%s\\n\' "$FORGE_PROFILE" "$FORGE_KEEP"; pwd'
      yield* daemon.request({ op: "run", id, attachment_id: "run-test", run_id: "second", command: second })
      const result = yield* waitForRun(daemon, id, "second", true)
      expect(result.run?.output).toContain("loaded\nkept\n")
      expect(result.run?.output).toContain(config)
      // Readiness check and input share an actor: partially typed input must win.
      yield* daemon.request({
        op: "write",
        id,
        attachment_id: "run-test",
        data_base64: Buffer.from("echo partial").toString("base64"),
      })
      const rejected = yield* daemon.request({
        op: "run",
        id,
        attachment_id: "run-test",
        run_id: "third",
        command: "pwd",
      })
      expect(rejected).toEqual({ type: "run_admission", data: { accepted: false, reason: "dirty" } })
    }),
  )
}

const waitForRun = Effect.fn("test.waitForIntegratedRun")(function* (
  daemon: DaemonTransport,
  id: number,
  runID: string,
  completed: boolean,
) {
  while (true) {
    const response = yield* daemon.request({ op: "get_run", id, run_id: runID })
    if (response.type !== "run_status") throw new Error("Expected run status")
    if (
      completed
        ? response.data.run?.outcome === "completed" && response.data.state === "ready"
        : response.data.state === "ready"
    )
      return response.data
    yield* Effect.sleep("10 millis")
  }
}, Effect.timeout("10 seconds"))
