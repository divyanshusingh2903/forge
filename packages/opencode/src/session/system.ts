import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_ASTRA from "./prompt/gpt-astra.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"
import PROMPT_META from "./prompt/meta.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import PROMPT_MEMORY from "./prompt/memory.txt"
import type { Provider } from "@/provider/provider"
import { Agent } from "@/agent/agent"
import { Memory } from "@opencode-ai/core/memory"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Reference } from "@opencode-ai/core/reference"
import { MCP } from "@/mcp"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"

export function provider(model: Provider.Model) {
  if (model.api.id.includes("muse")) {
    const name = model.api.id.includes("muse-glimmer") ? "Muse Glimmer" : "Muse Spark"
    return [PROMPT_META.replaceAll("{{MODEL_NAME}}", name)]
  }
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("gpt-6")) return [PROMPT_ASTRA]
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (
    model.api.id.toLowerCase().includes("kimi") ||
    ["kimi-for-coding", "moonshotai", "moonshotai-cn"].includes(model.providerID)
  )
    return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
  readonly mcp: (agent: Agent.Info, permission?: PermissionV1.Ruleset) => Effect.Effect<string | undefined>
  /**
   * Memory guidance plus the bounded index. Snapshotted per Session and history window so the prompt
   * prefix stays stable for caching: it reloads at session start and after compaction, not after edits.
   */
  readonly memory: (input: {
    sessionID: string
    windowKey: string | undefined
    subagent: boolean
  }) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const mcp = yield* MCP.Service
    const locations = yield* LocationServiceMap.Service
    const agents = yield* Agent.Service
    const memory = yield* Memory.Service
    const memorySnapshots = yield* InstanceState.make(
      Effect.fn("SystemPrompt.memorySnapshots")(() =>
        Effect.succeed(new Map<string, { windowKey: string | undefined; text: string }>()),
      ),
    )

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        const references = yield* Effect.gen(function* () {
          return (yield* (yield* Reference.Service).list()).filter((reference) => reference.description !== undefined)
        }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))))
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
          references.length === 0
            ? undefined
            : [
                "Project references provide additional directories that can be accessed when relevant.",
                "<available_references>",
                ...references
                  .toSorted((a, b) => a.name.localeCompare(b.name))
                  .flatMap((reference) => [
                    "  <reference>",
                    `    <name>${reference.name}</name>`,
                    `    <path>${reference.path}</path>`,
                    ...(reference.description === undefined
                      ? []
                      : [`    <description>${reference.description}</description>`]),
                    "  </reference>",
                  ]),
                "</available_references>",
              ].join("\n"),
        ].filter((part): part is string => part !== undefined)
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),

      mcp: Effect.fn("SystemPrompt.mcp")(function* (agent: Agent.Info, permission?: PermissionV1.Ruleset) {
        const ruleset = Permission.merge(agent.permission, permission ?? [])
        const instructions = (yield* mcp.instructions()).filter(
          (item) => item.tools.length === 0 || Permission.disabled(item.tools, ruleset).size < item.tools.length,
        )

        const status = yield* mcp.status()
        const disabled = Object.entries(status)
          .filter(([, value]) => value.status === "disabled")
          .map(([name]) => name)
          .toSorted((a, b) => a.localeCompare(b))

        if (instructions.length === 0 && disabled.length === 0) return

        const parts: string[] = []
        if (instructions.length > 0) {
          parts.push(
            [
              "<mcp_instructions>",
              ...instructions.flatMap((item) => [
                `  <server name="${item.name}">`,
                ...item.instructions.split("\n").map((line) => `    ${line}`),
                "  </server>",
              ]),
              "</mcp_instructions>",
            ].join("\n"),
          )
        }
        if (disabled.length > 0) {
          parts.push(
            [
              "<mcp_servers_disabled>",
              `  These MCP servers are configured but disabled by default, so none of their tools are currently loaded: ${disabled.join(", ")}.`,
              `  If asked what MCP servers exist or are available, mention these rather than saying none are configured.`,
              `  To enable one, set "enabled": true for it in the mcp config, then run \`opencode mcp auth <name>\` if it requires OAuth.`,
              "</mcp_servers_disabled>",
            ].join("\n"),
          )
        }
        return parts.join("\n")
      }),

      memory: Effect.fn("SystemPrompt.memory")(function* (input: {
        sessionID: string
        windowKey: string | undefined
        subagent: boolean
      }) {
        const location = yield* agents.memory()
        if (!location) return
        const snapshots = yield* InstanceState.get(memorySnapshots)
        const cached = snapshots.get(input.sessionID)
        if (cached && cached.windowKey === input.windowKey) return cached.text
        const index = yield* memory.index(AbsolutePath.make(location.directory))
        const text = [memoryGuidance(location.directory, input.subagent), memoryIndex(index)].join("\n\n")
        snapshots.set(input.sessionID, { windowKey: input.windowKey, text })
        return text
      }),
    })
  }),
)

function memoryGuidance(directory: string, subagent: boolean) {
  if (subagent)
    return [
      "# Memory",
      "",
      `The user's persistent memory for this repository is at \`${directory}\`. Its index is loaded below.`,
      "Memory is read-only for you as a subagent: never create, edit, or delete files there.",
      "Read a topic note with your normal file tools only when it looks relevant to your task.",
    ].join("\n")
  return PROMPT_MEMORY.replaceAll("{{MEMORY_DIR}}", directory).replaceAll("{{MAX_LINES}}", String(Memory.MAX_LINES))
}

function memoryIndex(index: Memory.Index) {
  if (index.status === "missing") return "<memory_index>\n(empty: MEMORY.md does not exist yet)\n</memory_index>"
  if (index.status === "unreadable")
    return [
      "<memory_index>",
      "(MEMORY.md exists but could not be read.)",
      "</memory_index>",
      "Do not create or overwrite MEMORY.md or other memory notes; tell the user memory is unreadable if it matters.",
    ].join("\n")
  return [
    "<memory_index>",
    index.text,
    "</memory_index>",
    ...(index.truncated
      ? [
          `MEMORY.md exceeds ${Memory.MAX_LINES} lines or ${Memory.MAX_BYTES} bytes, so only the start is shown. Consolidate it by merging or removing entries next time you save a memory.`,
        ]
      : []),
  ].join("\n")
}

const locationServiceMapNode = LayerNode.make({
  service: LocationServiceMap.Service,
  layer: locationServiceMapLayer,
  deps: [],
})

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Skill.node, MCP.node, Agent.node, Memory.node, locationServiceMapNode],
})

export * as SystemPrompt from "./system"
