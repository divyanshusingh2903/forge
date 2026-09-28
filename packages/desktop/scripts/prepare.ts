#!/usr/bin/env bun
import { Script } from "@opencode-ai/script"

await import("./prebuild")

// Forge releases stamp the app with the combined Forge version (e.g. 1.18.30-v0.1.0) while the
// bundled server keeps the plain OpenCode version, which the opencode.ai Console API checks.
const version = process.env.FORGE_VERSION ?? Script.version
const pkg = await Bun.file("./package.json").json()
pkg.version = version
await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${version}`)
