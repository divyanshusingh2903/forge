#!/usr/bin/env bun

// Fetches the terminal daemon that forge-release embeds in the server it builds.
//
// The `@opencode/pty` package on npm is upstream's daemon, which has no shell integration, so Run in terminal
// cannot work with it. This repo's daemon (packages/process-daemon) does, and the "Process daemon release"
// workflow builds it for every target when a `process-daemon-v<version>` tag is pushed. This downloads that
// release's binary for one Rust target, checks it against the release manifest, and names it for
// `resolveOpencodePty` through OPENCODE_PTY_BIN (see opencode-pty.ts).
//
//   bun packages/cli/script/forge-pty.ts x86_64-unknown-linux-gnu

import { createHash } from "node:crypto"
import { appendFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Option, Schema } from "effect"

const root = path.resolve(import.meta.dirname, "../../..")

// The Rust target of each daemon build, and the platform and architecture Node and Bun name it by.
const targets = {
  "aarch64-apple-darwin": { platform: "darwin", arch: "arm64" },
  "x86_64-apple-darwin": { platform: "darwin", arch: "x64" },
  "aarch64-unknown-linux-gnu": { platform: "linux", arch: "arm64" },
  "x86_64-unknown-linux-gnu": { platform: "linux", arch: "x64" },
  "aarch64-pc-windows-msvc": { platform: "win32", arch: "arm64" },
  "x86_64-pc-windows-msvc": { platform: "win32", arch: "x64" },
} as const

const Manifest = Schema.Struct({
  schema: Schema.Literal(1),
  version: Schema.String,
  protocol: Schema.Number,
  artifacts: Schema.Array(Schema.Struct({ target: Schema.String, archive: Schema.String, sha256: Schema.String })),
})

export function daemonTarget(triple: string) {
  if (!(triple in targets)) throw new Error(`There is no terminal daemon build for ${triple}`)
  return targets[triple as keyof typeof targets]
}

/** The version of the `opencode-pty` package: the first `version` after `[package]`. */
export function cargoVersion(toml: string) {
  const version = /\[package\][^[]*?^version\s*=\s*"([^"]+)"/m.exec(toml)?.[1]
  if (!version) throw new Error("Cargo.toml has no package version")
  return version
}

/** The protocol the server speaks to the daemon. */
export function clientProtocol(source: string) {
  const protocol = /^const ProtocolVersion = (\d+)$/m.exec(source)?.[1]
  if (!protocol) throw new Error("The server's PTY protocol version was not found")
  return Number(protocol)
}

/** The archive for one target from a release manifest, after checking it describes the daemon the server needs. */
export function findArtifact(manifest: string, input: { version: string; protocol: number; triple: string }) {
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Manifest))(manifest)
  if (Option.isNone(decoded)) throw new Error("The terminal daemon release manifest is not valid")
  const release = decoded.value

  if (release.version !== input.version)
    throw new Error(`The release has terminal daemon ${release.version}, but the source is ${input.version}`)
  // A daemon on another protocol would be refused at runtime, after the release is already published.
  if (release.protocol !== input.protocol)
    throw new Error(`The terminal daemon speaks protocol ${release.protocol}, but the server speaks ${input.protocol}`)

  const artifact = release.artifacts.find((item) => item.target === input.triple)
  if (!artifact) throw new Error(`The terminal daemon release has no build for ${input.triple}`)
  return artifact
}

export function verify(bytes: Uint8Array, sha256: string) {
  const actual = createHash("sha256").update(bytes).digest("hex")
  if (actual !== sha256.toLowerCase()) throw new Error(`Checksum mismatch: expected ${sha256}, got ${actual}`)
}

async function main() {
  const triple = process.argv[2]
  if (!triple) throw new Error("Usage: forge-pty.ts <rust target>")
  const target = daemonTarget(triple)

  const version = cargoVersion(await readFile(path.join(root, "packages/process-daemon/Cargo.toml"), "utf8"))
  const protocol = clientProtocol(await readFile(path.join(root, "packages/core/src/persistent-pty/daemon.ts"), "utf8"))
  const tag = `process-daemon-v${version}`
  const repository = process.env.GITHUB_REPOSITORY ?? "divyanshusingh2903/forge"
  const directory = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), `opencode-pty-${triple}`)

  await download(repository, tag, directory, "release-manifest.json")
  const artifact = findArtifact(await readFile(path.join(directory, "release-manifest.json"), "utf8"), {
    version,
    protocol,
    triple,
  })
  await download(repository, tag, directory, artifact.archive)
  verify(await readFile(path.join(directory, artifact.archive)), artifact.sha256)

  // Relative to the directory: a drive letter in an archive path is read as a remote host by GNU tar.
  await run(["tar", "-xzf", artifact.archive], directory)
  const binary = path.join(
    directory,
    artifact.archive.replace(/\.tar\.gz$/, ""),
    target.platform === "win32" ? "opencode-pty.exe" : "opencode-pty",
  )

  const lines = [`OPENCODE_PTY_BIN=${binary}`, `OPENCODE_PTY_BIN_TARGET=${target.platform}-${target.arch}`]
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, lines.join("\n") + "\n")
  console.log(lines.join("\n"))
}

async function download(repository: string, tag: string, directory: string, pattern: string) {
  const failure = await run(
    ["gh", "release", "download", tag, "--repo", repository, "--dir", directory, "--pattern", pattern, "--clobber"],
    root,
    true,
  )
  if (failure)
    throw new Error(
      `Could not download ${pattern} from release ${tag}: ${failure}\n` +
        `Build the terminal daemon first: git tag ${tag} && git push origin ${tag}, then wait for "Process daemon release".`,
    )
}

// Returns the error output instead of throwing when `soft` is set.
async function run(command: string[], cwd: string, soft = false) {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code === 0) return undefined
  if (soft) return stderr.trim()
  throw new Error(`${command[0]} failed (${code}): ${stderr.trim()}`)
}

if (import.meta.main) await main()
