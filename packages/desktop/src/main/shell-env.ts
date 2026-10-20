import { execFile } from "node:child_process"
import { userInfo } from "node:os"
import { basename } from "node:path"

const TIMEOUT = 5_000

type Probe = { type: "Loaded"; value: Record<string, string> } | { type: "Timeout" } | { type: "Unavailable" }
type ShellEnvLogger = {
  log: (message: string) => void
}

export function resolveUserShell(envShell: string | undefined, loginShell: string | null | undefined) {
  const resolvedLoginShell = loginShell && loginShell !== "unknown" ? loginShell : undefined
  return envShell || resolvedLoginShell || "/bin/sh"
}

export function getUserShell() {
  try {
    return resolveUserShell(process.env.SHELL, userInfo().shell)
  } catch {
    return resolveUserShell(process.env.SHELL, undefined)
  }
}

export function parseShellEnv(out: Buffer) {
  const env: Record<string, string> = {}
  for (const line of out.toString("utf8").split("\0")) {
    if (!line) continue
    const ix = line.indexOf("=")
    if (ix <= 0) continue
    env[line.slice(0, ix)] = line.slice(ix + 1)
  }
  return env
}

function probe(shell: string, mode: "-il" | "-l") {
  return new Promise<Probe>((resolve) => {
    const child = execFile(
      shell,
      [mode, "-c", "env -0"],
      { encoding: "buffer", timeout: TIMEOUT, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          const err = error as NodeJS.ErrnoException & { killed?: boolean }
          if (err.code === "ETIMEDOUT" || err.killed) return resolve({ type: "Timeout" })
          if (typeof err.code === "number") {
            console.log(`[server] Shell env probe exited with non-zero status for ${shell} ${mode}`)
            return resolve({ type: "Unavailable" })
          }
          console.log(`[server] Shell env probe failed for ${shell} ${mode}: ${err.message}`)
          return resolve({ type: "Unavailable" })
        }

        const env = parseShellEnv(stdout)
        if (Object.keys(env).length === 0) {
          console.log(`[server] Shell env probe returned empty env for ${shell} ${mode}`)
          return resolve({ type: "Unavailable" })
        }

        resolve({ type: "Loaded", value: env })
      },
    )
    // The previous spawnSync call ignored stdin; an open pipe could keep an interactive shell waiting.
    child.stdin?.end()
  })
}

export function isNushell(shell: string) {
  const name = basename(shell).toLowerCase()
  const raw = shell.toLowerCase()
  return name === "nu" || name === "nu.exe" || raw.endsWith("\\nu.exe")
}

export async function loadShellEnv(shell: string, logger: ShellEnvLogger) {
  if (isNushell(shell)) {
    logger.log(`[server] Skipping shell env probe for nushell: ${shell}`)
    return null
  }

  const interactive = await probe(shell, "-il")
  if (interactive.type === "Loaded") {
    logger.log(`[server] Loaded shell environment with -il (${Object.keys(interactive.value).length} vars)`)
    return interactive.value
  }
  if (interactive.type === "Timeout") {
    logger.log(`[server] Interactive shell env probe timed out: ${shell}`)
    return null
  }

  const login = await probe(shell, "-l")
  if (login.type === "Loaded") {
    logger.log(`[server] Loaded shell environment with -l (${Object.keys(login.value).length} vars)`)
    return login.value
  }

  logger.log(`[server] Falling back to app environment: ${shell}`)
  return null
}

export function mergeShellEnv(shell: Record<string, string> | null, env: Record<string, string>) {
  return {
    ...shell,
    ...env,
  }
}
