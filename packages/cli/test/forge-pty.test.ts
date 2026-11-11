import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveOpencodePty } from "../script/opencode-pty"
import { cargoVersion, clientProtocol, daemonTarget, findArtifact, verify } from "../script/forge-pty"

const root = path.resolve(import.meta.dirname, "../../..")

const manifest = JSON.stringify({
  schema: 1,
  version: "0.4.1",
  protocol: 7,
  artifacts: [
    { target: "x86_64-unknown-linux-gnu", archive: "opencode-pty-0.4.1-x86_64-unknown-linux-gnu.tar.gz", sha256: "aa" },
    { target: "aarch64-pc-windows-msvc", archive: "opencode-pty-0.4.1-aarch64-pc-windows-msvc.tar.gz", sha256: "bb" },
  ],
})

test("reads the daemon version and the server's protocol from the sources they live in", async () => {
  expect(cargoVersion('[package]\nname = "opencode-pty"\nversion = "1.2.3"\n\n[dependencies]\nversion = "9"')).toBe("1.2.3")
  expect(() => cargoVersion("[dependencies]\nversion = \"9\"")).toThrow("no package version")

  const version = cargoVersion(await readFile(path.join(root, "packages/process-daemon/Cargo.toml"), "utf8"))
  expect(version).toMatch(/^\d+\.\d+\.\d+/)
  expect(version).toBe((await Bun.file(path.join(root, "packages/process-daemon/npm/package.json")).json()).version)

  expect(clientProtocol("const a = 1\nconst ProtocolVersion = 7\n")).toBe(7)
  expect(() => clientProtocol("const ProtocolVersion = bump()")).toThrow("not found")
  expect(clientProtocol(await readFile(path.join(root, "packages/core/src/persistent-pty/daemon.ts"), "utf8"))).toBeGreaterThan(0)
})

test("every target forge-release builds has a daemon build", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/forge-release.yml"), "utf8")
  const triples = [...workflow.matchAll(/^\s+target: ([\w-]+)$/gm)].map((match) => match[1])

  expect(triples).toHaveLength(6)
  expect(triples.map((triple) => daemonTarget(triple!).platform).sort()).toEqual([
    "darwin",
    "darwin",
    "linux",
    "linux",
    "win32",
    "win32",
  ])
  expect(() => daemonTarget("riscv64-unknown-linux-gnu")).toThrow("no terminal daemon build")
})

test("picks a target's archive only from a release that matches the source", () => {
  const input = { version: "0.4.1", protocol: 7, triple: "x86_64-unknown-linux-gnu" }
  expect(findArtifact(manifest, input)).toEqual({
    target: "x86_64-unknown-linux-gnu",
    archive: "opencode-pty-0.4.1-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "aa",
  })
  expect(() => findArtifact(manifest, { ...input, version: "0.4.2" })).toThrow("has terminal daemon 0.4.1")
  expect(() => findArtifact(manifest, { ...input, protocol: 8 })).toThrow("protocol 7, but the server speaks 8")
  expect(() => findArtifact(manifest, { ...input, triple: "aarch64-apple-darwin" })).toThrow("no build for")
  expect(() => findArtifact("{}", input)).toThrow("not valid")
})

test("rejects an archive that does not match its checksum", () => {
  const bytes = new TextEncoder().encode("daemon")
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
  expect(() => verify(bytes, sha256)).not.toThrow()
  expect(() => verify(bytes, sha256.toUpperCase())).not.toThrow()
  expect(() => verify(bytes, "0".repeat(64))).toThrow("Checksum mismatch")
})

const saved = { bin: process.env.OPENCODE_PTY_BIN, target: process.env.OPENCODE_PTY_BIN_TARGET }
const directories: string[] = []

afterEach(async () => {
  for (const [key, value] of [
    ["OPENCODE_PTY_BIN", saved.bin],
    ["OPENCODE_PTY_BIN_TARGET", saved.target],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function embed(target?: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forge-pty-"))
  directories.push(directory)
  await writeFile(path.join(directory, "opencode-pty"), "daemon")
  process.env.OPENCODE_PTY_BIN = path.join(directory, "opencode-pty")
  if (target === undefined) delete process.env.OPENCODE_PTY_BIN_TARGET
  else process.env.OPENCODE_PTY_BIN_TARGET = target
}

test("embeds a local daemon only into a build for the platform it was built for", async () => {
  const host = { platform: process.platform, arch: process.arch } as { platform: string; arch: string }
  const other = host.platform === "linux" ? { platform: "darwin", arch: host.arch } : { platform: "linux", arch: host.arch }

  await embed()
  expect((await resolveOpencodePty(host))?.version).toBe("local")
  await expect(resolveOpencodePty(other)).rejects.toThrow(`${host.platform}-${host.arch} binary`)

  // A cross-build names the target its binary was built for.
  await embed(`${other.platform}-${other.arch}`)
  expect((await resolveOpencodePty(other))?.version).toBe("local")
  await expect(resolveOpencodePty(host)).rejects.toThrow(`cannot be embedded in a ${host.platform}-${host.arch} build`)
})
