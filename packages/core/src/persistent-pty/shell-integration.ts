import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import bash from "./shell-integration/bash.bash" with { type: "text" }
import zshenv from "./shell-integration/zsh/.zshenv" with { type: "text" }
import zshrc from "./shell-integration/zsh/.zshrc" with { type: "text" }
import fish from "./shell-integration/fish.fish" with { type: "text" }
import powershell from "./shell-integration/powershell.ps1" with { type: "text" }

/** Prepare interactive startup without changing the selected shell executable. */
export async function prepareShellIntegration(state: string, program: string, env: Readonly<Record<string, string>>) {
  const shell = path
    .basename(program)
    .toLowerCase()
    .replace(/\.exe$/, "")
  const directory = path.join(state, "pty", "shell-integration-1")
  if (!["bash", "zsh", "fish", "pwsh", "powershell"].includes(shell)) return { args: [], env }
  await mkdir(path.join(directory, "zsh"), { recursive: true })
  await Promise.all(
    Object.entries({
      "bash.bash": bash,
      "zsh/.zshenv": zshenv,
      "zsh/.zshrc": zshrc,
      "fish.fish": fish,
      "powershell.ps1": powershell,
    }).map(async ([name, source]) => {
      const destination = path.join(directory, name)
      if ((await readFile(destination, "utf8").catch(() => undefined)) === source) return
      // Concurrent terminal creation must never source a partially written hook.
      const temporary = `${destination}.${randomUUID()}`
      await writeFile(temporary, source, { mode: 0o600 })
      await rename(temporary, destination)
    }),
  )
  if (shell === "bash") return { args: ["--rcfile", path.join(directory, "bash.bash"), "-i"], env }
  if (shell === "zsh")
    return {
      args: ["-i"],
      env: {
        ...env,
        FORGE_ORIGINAL_ZDOTDIR: env.ZDOTDIR ?? process.env.ZDOTDIR ?? "",
        FORGE_ZSH_INTEGRATION: path.join(directory, "zsh"),
        ZDOTDIR: path.join(directory, "zsh"),
      },
    }
  if (shell === "fish")
    return { args: ["-i", "--init-command", `source '${path.join(directory, "fish.fish").replace(/'/g, "\\'")}'`], env }
  // Inline startup avoids requiring users to change PowerShell's script-file execution policy.
  return { args: ["-NoExit", "-Command", powershell], env }
}
