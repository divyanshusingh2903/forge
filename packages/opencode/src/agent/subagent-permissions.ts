import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Agent } from "./agent"
import { Permission } from "@/permission"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent session's deny rules and external_directory rules.
 *    Parent agent restrictions only govern that agent; the subagent's own
 *    permissions determine its capabilities.
 * 2. Default `todowrite` and `task` denies if the subagent's own ruleset
 *    doesn't already permit them.
 * 3. An `edit` deny on native memory notes, so only primary agents write
 *    memory and parallel subagents never race on the index.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
  memoryEditPattern?: string
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  // A trailing path-specific rule would un-hide an edit tool the subagent already disables wholesale.
  const memoryPattern = Permission.disabled(["edit"], input.subagent.permission).has("edit")
    ? undefined
    : input.memoryEditPattern
  return [
    ...input.parentSessionPermission.filter(
      (rule) => rule.permission === "external_directory" || rule.action === "deny",
    ),
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(memoryPattern ? [{ permission: "edit" as const, pattern: memoryPattern, action: "deny" as const }] : []),
  ]
}
