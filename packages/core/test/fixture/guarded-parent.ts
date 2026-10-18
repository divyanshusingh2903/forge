// Spawns a guarded long-running pipeline, prints its process group ID, then stays alive until killed.
import { spawn } from "node:child_process"
import { Shell } from "@opencode-ai/core/shell"

const guard = Shell.guarded("/bin/bash", "sleep 300 | cat")
if (!guard) throw new Error("guard unavailable")
const child = spawn(guard.file, guard.args, { detached: true, stdio: "ignore" })
console.log(child.pid)
setInterval(() => {}, 1000)
