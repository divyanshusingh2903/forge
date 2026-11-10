import { binaryPath } from "@opencode/pty"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Source development must use the daemon built from this checkout, not an
// older published package. CLI packaging replaces this module with its asset.
const local = fileURLToPath(
  new URL(
    `../../../process-daemon/target/debug/opencode-pty${process.platform === "win32" ? ".exe" : ""}`,
    import.meta.url,
  ),
)

const binding: string | { readonly path: string; readonly version: string; readonly sha256: string } | undefined =
  existsSync(local) ? local : binaryPath

export default binding
