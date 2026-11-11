import type { DiscoverOptions, Info } from "./service.js"

export function matchesVersion(version: string | undefined, options: DiscoverOptions) {
  if (options.version === undefined) return true
  if (version === undefined) return false
  if (typeof options.version === "function") return options.version(version)
  return version === options.version
}

/** Whether a probed service meets the required version and, when one is required, the required build. */
export function matchesService(
  service: { readonly version?: string; readonly info: Pick<Info, "build"> },
  options: DiscoverOptions,
) {
  if (options.build !== undefined && service.info.build !== options.build) return false
  return matchesVersion(service.version, options)
}
