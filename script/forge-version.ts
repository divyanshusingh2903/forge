#!/usr/bin/env bun

// Forge versions combine the upstream OpenCode version the fork is synced to with Forge's own
// version: `<opencode>-v<forge>`, e.g. 1.18.30-v0.1.0, released under the tag v1.18.30-v0.1.0.
//
// - The OpenCode half is read from packages/opencode/package.json, which moves on upstream merges.
// - The Forge half lives in forge.json and is only changed by passing a bump to this script.
//
// Usage: script/forge-version.ts [major|minor|patch]

import path from "path"

const root = path.resolve(import.meta.dir, "..")
const forgeFile = Bun.file(path.join(root, "forge.json"))
const forge = await forgeFile.json()
const opencode = (await Bun.file(path.join(root, "packages/opencode/package.json")).json()).version

if (!/^\d+\.\d+\.\d+$/.test(opencode)) throw new Error(`Unexpected OpenCode version "${opencode}"`)
if (!/^\d+\.\d+\.\d+$/.test(forge.version)) throw new Error(`Unexpected Forge version "${forge.version}"`)

const bump = process.argv[2]
if (bump) {
  const [major, minor, patch] = forge.version.split(".").map(Number)
  if (bump === "major") forge.version = `${major + 1}.0.0`
  else if (bump === "minor") forge.version = `${major}.${minor + 1}.0`
  else if (bump === "patch") forge.version = `${major}.${minor}.${patch + 1}`
  else throw new Error(`Unknown bump "${bump}", expected major, minor, or patch`)
  await Bun.write(forgeFile, JSON.stringify(forge, null, 2) + "\n")
}

const version = `${opencode}-v${forge.version}`
const output = [`forge=${forge.version}`, `opencode=${opencode}`, `version=${version}`, `tag=v${version}`].join("\n")

console.log(output)
if (process.env.GITHUB_OUTPUT) await Bun.write(process.env.GITHUB_OUTPUT, output + "\n")
