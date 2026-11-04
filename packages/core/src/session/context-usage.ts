export * as SessionContextUsage from "./context-usage.js"

import { Context, Effect, Schema } from "effect"
import { Token } from "../util/token.js"
import type { LocationServiceMap } from "../location-service-map.js"
import { Mcp } from "../mcp/index.js"
import { McpTool } from "../tool/mcp.js"
import { SessionCompaction } from "./compaction.js"
import { SessionContext } from "./context.js"
import { SessionModelRequest } from "./model-request.js"
import type { SessionSchema } from "./schema.js"
import { SessionSystemPrompt } from "./system-prompt.js"

export type CategoryID =
  | "system"
  | "tools"
  | "mcpTools"
  | "codeMode"
  | "mcpInstructions"
  | "skills"
  | "instructions"
  | "memory"
  | "references"
  | "other"
  | "messages"

export interface Item {
  readonly name: string
  readonly tokens: number
}

export interface Category {
  readonly id: CategoryID
  readonly tokens: number
  readonly items: ReadonlyArray<Item>
}

/** One part of the system prompt the next request sends, in order. */
export interface PromptPart {
  readonly id: CategoryID
  /** The Instruction Source key, or "base" for the agent's own prompt. */
  readonly name: string
  readonly text: string
}

export interface Usage {
  readonly model: { readonly providerID: string; readonly id: string }
  /** The model's input window, when known. */
  readonly limit?: number
  /** The prompt size at which automatic compaction starts, when it is on and the window is known. */
  readonly threshold?: number
  /** The next request's size: the provider's count at the latest response plus an estimate of what came after. */
  readonly total: number
  /** False when no response in this window reported usage, so every part is estimated. */
  readonly measured: boolean
  readonly categories: ReadonlyArray<Category>
  readonly prompt: ReadonlyArray<PromptPart>
}

/** The Session's model, agent, or Location could not be loaded, so its next request cannot be described. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("SessionContextUsage.UnavailableError", {
  message: Schema.String,
}) {}

// Instruction Sources by the part of the context they explain; unknown keys count as "other".
const SOURCES: Record<string, CategoryID> = {
  "core/date": "system",
  "core/environment": "system",
  "core/codemode": "codeMode",
  "core/mcp-guidance": "mcpInstructions",
  "core/skill-guidance": "skills",
  "core/instructions": "instructions",
  "core/reference-guidance": "references",
  "forge/memory": "memory",
}

/**
 * What the Session's next model request is made of. Each part is estimated from its text, then scaled so the parts
 * add up to the provider's latest count plus an estimate of what came after: the size compaction works from.
 */
export const get = Effect.fn("SessionContextUsage.get")(function* (
  locations: Context.Service.Shape<typeof LocationServiceMap.Service>,
  session: SessionSchema.Info,
) {
  return yield* Effect.gen(function* () {
    const contexts = yield* SessionContext.Service
    const compaction = yield* SessionCompaction.Service
    const mcp = yield* Mcp.Service
    const loaded = yield* contexts.load(yield* contexts.select(session.id))
    return breakdown(loaded, {
      servers: new Map(
        (yield* mcp.tools()).map((tool) => [McpTool.name(tool.server, tool.name), String(tool.server)] as const),
      ),
      threshold: compaction.threshold(loaded.model.limit),
    })
  }).pipe(
    Effect.provide(locations.get(session.location)),
    Effect.mapError((error) => new UnavailableError({ message: error.message })),
  )
})

/** Splits `loaded`'s next request by part. `servers` maps native MCP tool names to their server. */
export function breakdown(
  loaded: SessionContext.Loaded,
  input: { readonly servers: ReadonlyMap<string, string>; readonly threshold?: number },
): Usage {
  const definitions = loaded.tools.definitions.map((tool) => ({
    name: tool.name,
    server: input.servers.get(tool.name),
    tokens: SessionCompaction.estimateTool(tool),
  }))
  const base = loaded.agent.info.system || SessionSystemPrompt.make(loaded.tools.definitions.map((tool) => tool.name))
  const instructions = loaded.initial.map((part) => ({
    id: SOURCES[part.key] ?? "other",
    name: part.key,
    tokens: Token.estimate(part.text),
  }))
  const fixed: Category[] = [
    {
      id: "system",
      tokens: Token.estimate(base) + sum(instructions.filter((part) => part.id === "system")),
      items: [],
    },
    {
      id: "tools",
      tokens: sum(definitions.filter((tool) => !tool.server)),
      items: definitions.filter((tool) => !tool.server).map((tool) => ({ name: tool.name, tokens: tool.tokens })),
    },
    {
      id: "mcpTools",
      tokens: sum(definitions.filter((tool) => tool.server)),
      items: group(definitions.flatMap((tool) => (tool.server ? [{ name: tool.server, tokens: tool.tokens }] : []))),
    },
    ...(["codeMode", "mcpInstructions", "skills", "instructions", "memory", "references", "other"] as const).map(
      (id): Category => {
        const parts = instructions.filter((part) => part.id === id)
        return { id, tokens: sum(parts), items: id === "other" ? parts : [] }
      },
    ),
  ]

  const estimate = SessionCompaction.estimatePrompt(loaded)
  const history = SessionModelRequest.baseTranscript({
    agent: loaded.agent.info,
    model: loaded.model,
    tools: loaded.tools,
    initial: loaded.initial,
    messages: loaded.messages,
  }).messages
  const estimated = [
    ...fixed,
    {
      id: "messages" as const,
      tokens: history.reduce((count, message) => count + SessionCompaction.estimateMessage(message), 0),
      items: [],
    },
  ]
  // Text estimates can run high or low, so with a measured total each part keeps its estimated share of that total.
  const total = estimate.measured > 0 ? estimate.measured + estimate.estimated : sum(estimated)
  const scale = estimate.measured > 0 && sum(estimated) > 0 ? total / sum(estimated) : 1
  const scaled = estimated.map((category) => ({
    ...category,
    tokens: Math.round(category.tokens * scale),
    items: category.items.map((item) => ({ ...item, tokens: Math.round(item.tokens * scale) })),
  }))
  const limit = inputWindow(loaded.model.limit)

  return {
    model: { providerID: String(loaded.model.ref.providerID), id: String(loaded.model.ref.id) },
    ...(limit > 0 ? { limit } : {}),
    ...(input.threshold === undefined ? {} : { threshold: input.threshold }),
    total,
    measured: estimate.measured > 0,
    categories: scaled.filter((category) => category.tokens > 0 || category.id === "messages"),
    prompt: [
      { id: "system", name: "base", text: base },
      ...loaded.initial.map((part) => ({ id: SOURCES[part.key] ?? "other", name: part.key, text: part.text })),
    ],
  }
}

function sum(parts: ReadonlyArray<{ readonly tokens: number }>) {
  return parts.reduce((count, part) => count + part.tokens, 0)
}

function group(items: ReadonlyArray<Item>) {
  return Array.from(
    items.reduce(
      (totals, item) => totals.set(item.name, (totals.get(item.name) ?? 0) + item.tokens),
      new Map<string, number>(),
    ),
    ([name, tokens]) => ({ name, tokens }),
  )
}

function inputWindow(limit: SessionContext.Loaded["model"]["limit"]) {
  return limit.input && limit.context ? Math.min(limit.input, limit.context) : limit.input || limit.context
}
