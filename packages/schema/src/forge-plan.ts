export * as ForgePlan from "./forge-plan.js"

import { Schema } from "effect"
import type { SessionMetadata } from "./session-metadata.js"

/**
 * The session's current plan, kept in its metadata under `key`. Each planning cycle writes its own file, relative to
 * the session's directory: `drafting` while the plan agent works on it, `ready` while the user reviews it, and
 * `accepted` or `denied` once they decide, after which the next time the session enters Plan starts a new file.
 */
export const Status = Schema.Literals(["drafting", "ready", "accepted", "denied"]).annotate({
  identifier: "ForgePlan.Status",
})
export type Status = typeof Status.Type

export const Info = Schema.Struct({
  path: Schema.String,
  status: Status,
}).annotate({ identifier: "ForgePlan.Info" })
export type Info = typeof Info.Type

export const key = "forge.plan"

/** Where plan files live, relative to the session's directory. */
export const directory = ".opencode/plans"

const decode = Schema.decodeUnknownOption(Info)

export function read(metadata: SessionMetadata | undefined): Info | undefined {
  const value = decode(metadata?.[key])

  return value._tag === "Some" ? value.value : undefined
}

/** Whether the plan is still being written or reviewed, so entering Plan again keeps working on it. */
export function open(info: Info | undefined): info is Info {
  return info?.status === "drafting" || info?.status === "ready"
}

/** The subject of text quoted from a plan file, which tells the app a quote belongs to that plan's review. */
export function quoteSubject(path: string) {
  return `the plan ${path}`
}
