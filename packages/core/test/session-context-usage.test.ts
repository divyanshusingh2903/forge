import { describe, expect, test } from "bun:test"
import { DateTime, Effect, Schema } from "effect"
import { LanguageModel, ToolDefinition } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Agent } from "@opencode/core/agent"
import { Instructions } from "@opencode/core/instructions/index"
import type { Session } from "@opencode/core/session"
import type { SessionContext } from "@opencode/core/session/context"
import { SessionContextUsage } from "@opencode/core/session/context-usage"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Token } from "@opencode/core/util/token"

const model = SessionRunnerModel.resolved(
  LanguageModel.make({ id: "usage-model", provider: "test", route: OpenAIChat.route }),
  {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    cost: [],
    limit: { context: 100_000, output: 8_000 },
  },
)

const tool = (name: string, description: string) =>
  ToolDefinition.make({ name, description, inputSchema: { type: "object" } })

const user = (text: string) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.create(),
    type: "user",
    text,
    time: { created: DateTime.makeUnsafe(0) },
  })

const answered = (input: number) =>
  Schema.decodeUnknownSync(SessionMessage.Assistant)({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: Agent.defaultID,
    model: { id: "usage-model", providerID: "test" },
    content: [{ type: "text", text: "Done" }],
    tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, completed: 0 },
  })

const loaded = (messages: ReadonlyArray<SessionMessage.Info>): SessionContext.Loaded => ({
  // SAFETY: the breakdown reads no Session fields.
  session: {} as Session.Info,
  agent: { id: Agent.defaultID, info: { ...Agent.Info.default(Agent.defaultID), system: "You are helpful." } },
  model,
  initial: [
    { key: Instructions.Key.make("core/environment"), text: "<env>linux</env>" },
    { key: Instructions.Key.make("core/instructions"), text: "Use tabs. ".repeat(40) },
    { key: Instructions.Key.make("forge/memory"), text: "# Memory\n<memory_index>\n- note\n</memory_index>" },
    { key: Instructions.Key.make("api/goal"), text: "Finish the port." },
  ],
  messages,
  tools: {
    definitions: [
      tool("read", "Read a file"),
      tool("github_search", "Search GitHub"),
      tool("github_issue", "Open an issue"),
    ],
    execute: () => Effect.die("unused"),
  },
})

const servers = new Map([
  ["github_search", "github"],
  ["github_issue", "github"],
])

const category = (usage: SessionContextUsage.Usage, id: SessionContextUsage.CategoryID) =>
  usage.categories.find((item) => item.id === id)

describe("SessionContextUsage.breakdown", () => {
  test("sorts the fixed parts by source and groups MCP tools by server", () => {
    const usage = SessionContextUsage.breakdown(loaded([user("Hello")]), { servers, threshold: 85_000 })

    expect(usage).toMatchObject({ limit: 100_000, threshold: 85_000, measured: false })
    expect(category(usage, "system")!.tokens).toBe(
      Token.estimate("You are helpful.") + Token.estimate("<env>linux</env>"),
    )
    expect(category(usage, "instructions")!.tokens).toBe(Token.estimate("Use tabs. ".repeat(40)))
    expect(category(usage, "memory")!.tokens).toBeGreaterThan(0)
    expect(category(usage, "tools")!.items.map((item) => item.name)).toEqual(["read"])
    expect(category(usage, "mcpTools")!.items.map((item) => item.name)).toEqual(["github"])
    expect(category(usage, "other")!.items.map((item) => item.name)).toEqual(["api/goal"])
    expect(category(usage, "skills")).toBeUndefined()
    // Unmeasured, every part is estimated and the total is their sum.
    expect(usage.total).toBe(usage.categories.reduce((sum, item) => sum + item.tokens, 0))
  })

  test("scales every part to the measured total", () => {
    const usage = SessionContextUsage.breakdown(loaded([user("Hello"), answered(100)]), { servers })
    const unmeasured = SessionContextUsage.breakdown(loaded([user("Hello")]), { servers })

    expect(usage.measured).toBe(true)
    expect(usage.threshold).toBeUndefined()
    // The estimates run past 100 tokens here; the parts shrink to the count instead of messages dropping to zero.
    expect(unmeasured.total).toBeGreaterThan(usage.total)
    expect(category(usage, "messages")!.tokens).toBeGreaterThan(0)
    expect(Math.abs(usage.categories.reduce((sum, item) => sum + item.tokens, 0) - usage.total)).toBeLessThanOrEqual(
      usage.categories.length,
    )
  })

  test("returns the system prompt by part", () => {
    const usage = SessionContextUsage.breakdown(loaded([]), { servers })

    expect(usage.prompt.map((part) => [part.id, part.name])).toEqual([
      ["system", "base"],
      ["system", "core/environment"],
      ["instructions", "core/instructions"],
      ["memory", "forge/memory"],
      ["other", "api/goal"],
    ])
    expect(usage.prompt[0].text).toBe("You are helpful.")
  })
})
