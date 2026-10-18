import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

export function createManualUpdateUrl(input: {
  platform: string
  packaged: boolean
  executable: string
  inspect?: (bundle: string) => Promise<string>
}) {
  let manual: Promise<boolean> | undefined

  return async (version: string) => {
    if (input.platform !== "darwin" || !input.packaged) return
    // Cache failures too: an uninspectable signature must not reach Squirrel.
    manual ??= Promise.resolve()
      .then(async () => {
        const bundle = path.resolve(path.dirname(input.executable), "../..")
        const signature = input.inspect
          ? await input.inspect(bundle)
          : (
              await promisify(execFile)("/usr/bin/codesign", ["-dv", "--verbose=4", bundle], { timeout: 10000 })
            ).stderr
        return /^Signature=adhoc\s*$/m.test(signature) || !/^Authority=Developer ID Application:/m.test(signature)
      })
      .catch(() => true)
    if (!(await manual)) return
    return `https://github.com/divyanshusingh2903/forge/releases/tag/v${encodeURIComponent(version)}`
  }
}
