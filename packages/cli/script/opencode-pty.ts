import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

export type OpencodePtyAsset = {
  readonly source: string
  readonly version: string
  readonly sha256: string
}

type Target = {
  readonly platform: string
  readonly arch: string
  readonly libc?: "glibc" | "musl"
}

const core = createRequire(path.resolve(import.meta.dirname, "../../core/package.json"))
const pty = createRequire(core.resolve("@opencode/pty/package.json"))

export async function resolveOpencodePty(target: Target): Promise<OpencodePtyAsset | undefined> {
  if (target.platform !== "darwin" && target.platform !== "linux" && target.platform !== "win32") return undefined
  if (target.arch !== "arm64" && target.arch !== "x64") return undefined

  const suffix = [target.platform, target.arch, target.platform === "linux" ? (target.libc ?? "glibc") : undefined]
    .filter(Boolean)
    .map((value) => (value === "glibc" ? "gnu" : value))
    .join("-")
  const name = `@opencode/pty-${suffix}`
  const local = process.env.OPENCODE_PTY_BIN
  // The binary is assumed to run on this host. A cross-build (Windows arm64 on an x64 runner) names the target its
  // binary was built for instead, so a binary for the wrong target is still refused.
  const built = process.env.OPENCODE_PTY_BIN_TARGET ?? `${process.platform}-${process.arch}`
  const wanted = `${target.platform}-${target.arch}`
  if (local && built !== wanted)
    throw new Error(`OPENCODE_PTY_BIN is a ${built} binary and cannot be embedded in a ${wanted} build`)
  const source = local
    ? path.resolve(local)
    : pty.resolve(`${name}/bin/${target.platform === "win32" ? "opencode-pty.exe" : "opencode-pty"}`)
  const manifest: unknown = local
    ? { version: "local" }
    : JSON.parse(await readFile(pty.resolve(`${name}/package.json`), "utf8"))
  if (!manifest || typeof manifest !== "object" || !("version" in manifest) || typeof manifest.version !== "string")
    throw new Error(`Invalid package metadata for ${name}`)

  return {
    source,
    version: manifest.version,
    sha256: createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
  }
}
