import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"

// Forge has no full-screen terminal UI; the desktop app is the interface and this binary hosts its server.
export default Runtime.handler(Commands, () =>
  Effect.sync(() => {
    process.stderr.write(
      "Forge has no full-screen terminal interface.\nUse the desktop app, `opencode mini` for a minimal terminal session, or `opencode run <message>`.\n",
    )
    process.exitCode = 1
  }),
)
