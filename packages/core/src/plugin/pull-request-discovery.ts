export * as PullRequestDiscovery from "./pull-request-discovery.js"

import { ForgePullRequests } from "@opencode/schema/forge-pull-requests"
import { Option, Schema } from "effect"
import { ShellScan } from "../shell/scan.js"

const object = Schema.Record(Schema.String, Schema.Unknown)
const decodeObject = Schema.decodeUnknownOption(object)
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/**
 * The request a creation result names. Only its canonical URL counts: a link to one of its pages, an issue, a
 * comment or a compare view is not the request that was created.
 */
export function identity(value: string) {
  const parsed = ForgePullRequests.parse(value)
  if (!parsed) return
  const canonical = URL.parse(ForgePullRequests.href(parsed))
  if (URL.parse(value)?.pathname.replace(/\/$/, "") !== canonical?.pathname) return
  return { ...parsed, key: ForgePullRequests.key(parsed), url: ForgePullRequests.href(parsed) }
}

/** Conservative CLI provenance: a standalone creation invocation, not a URL printed by another command. */
export function cli(command: string) {
  const scanned = ShellScan.scan(command, "posix")
  if (scanned.kind !== "scanned" || scanned.commands.length !== 1) return
  const words = scanned.commands[0].words
  if (words[0] === "gh" && words[1] === "pr" && words[2] === "create") return "github"
  if (words[0] === "glab" && words[1] === "mr" && words[2] === "create") return "gitlab"
}

/** Namespaces are user-configurable; match the creation method, then require its provider's canonical result URL. */
export function provider(tool: string) {
  if (/(?:^|_|\.)create_pull_request$/.test(tool)) return "github"
  if (/(?:^|_|\.)create_merge_request$/.test(tool)) return "gitlab"
}

export function command(input: unknown) {
  const value = Option.getOrUndefined(decodeObject(input))
  return typeof value?.command === "string" ? value.command : undefined
}

/** MCP creation results may be structured JSON or a text content envelope, but never scan arbitrary nested prose. */
export function created(output: unknown, provider: "github" | "gitlab") {
  if (typeof output === "string") {
    const parsed = Option.getOrUndefined(decodeJson(output))
    if (parsed !== undefined) return fromObject(parsed, provider)
    const links = output.split(/\r?\n/).flatMap((line) => {
      const item = identity(line.trim())
      return item ? [item] : []
    })
    const item = links.length === 1 ? links[0] : undefined
    return item?.provider === provider ? item : undefined
  }
  return fromObject(output, provider)
}

function fromObject(output: unknown, provider: "github" | "gitlab") {
  const data = Option.getOrUndefined(decodeObject(output))
  if (!data || data.isError === true) return
  const url = [data.html_url, data.web_url, data.url].find((value) => typeof value === "string" && identity(value))
  const item = typeof url === "string" ? identity(url) : undefined
  if (item?.provider === provider) return item
  const structured = Option.getOrUndefined(decodeObject(data.structuredContent))
  if (!structured) return
  const link = [structured.html_url, structured.web_url, structured.url].find(
    (value) => typeof value === "string" && identity(value),
  )
  const nested = typeof link === "string" ? identity(link) : undefined
  return nested?.provider === provider ? nested : undefined
}
