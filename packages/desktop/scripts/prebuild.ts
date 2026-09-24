#!/usr/bin/env bun
import { $ } from "bun"

import { downloadCliToResources, resolveChannel, resolveOpencodeVersion } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

process.env.OPENCODE_VERSION ??= await resolveOpencodeVersion()
await $`cd ../opencode && bun script/build-node.ts`
if (channel === "dev") await downloadCliToResources()
