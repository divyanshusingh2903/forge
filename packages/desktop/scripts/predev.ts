import { $ } from "bun"
import { downloadCliToResources, resolveOpencodeVersion } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

process.env.OPENCODE_VERSION ??= await resolveOpencodeVersion()
await $`cd ../opencode && bun script/build-node.ts`
await downloadCliToResources()
