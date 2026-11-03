import path from "node:path"
import { describe, expect } from "bun:test"
import { Effect, Exit, Option, Stream, Types } from "effect"
import { Message } from "@opencode/ai/effect"
import type { Plugin } from "@opencode/plugin/effect"
import type { Tool as ToolDefinition } from "@opencode/schema/tool"
import { Agent } from "@opencode/core/agent"
import { FileSystem } from "@opencode/core/filesystem"
import { Form } from "@opencode/core/form"
import { Permission } from "@opencode/core/permission"
import { ForgePlanPlugin } from "@opencode/core/plugin/forge-plan"
import { Session } from "@opencode/core/session"
import { Event } from "@opencode/schema/event"
import { ForgeMode } from "@opencode/schema/forge-mode"
import { ForgePlan } from "@opencode/schema/forge-plan"
import type { SessionEvent } from "@opencode/core/session/event"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_forge_plan")
const plan = Agent.ID.make("plan")
const build = Agent.ID.make("build")

const selected = (agent: Agent.ID, previous: Agent.ID): SessionEvent.AgentSelected => ({
  id: Event.ID.create(),
  created: 0,
  durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
  type: "session.agent.selected",
  data: { sessionID, agent, previous },
})

/**
 * Runs the plugin against stubbed domains: session metadata in memory, a form that answers `answer`, and a plan file
 * that exists when `written`. Returns the registered tools and what the plugin did to the session.
 */
const run = Effect.fnUntraced(function* (input: {
  answer?: string
  written?: boolean
  events?: ReadonlyArray<SessionEvent.AgentSelected>
  metadata?: Record<string, ForgePlan.Info | ForgeMode.Mode>
}) {
  const state = { metadata: { ...input.metadata } as Session.Info["metadata"], agents: new Array<Agent.ID>() }
  const synthetic = new Array<string>()
  const hooks = new Map<string, (event: never) => Effect.Effect<void>>()
  const tools = new Map<string, ToolDefinition.Info>()
  const agents = new Map<Agent.ID, Types.DeepMutable<Agent.Info>>(
    [plan, build, Agent.ID.make("explore")].map((id) => [id, { ...Agent.Info.default(id), permissions: [] }]),
  )
  const session: Partial<Plugin.Context["session"]> = {
    // SAFETY: the plugin reads only the metadata of a Session.
    get: () => Effect.sync(() => ({ id: sessionID, metadata: state.metadata }) as unknown as Session.Info),
    update: (update) =>
      Effect.sync(() => {
        if (update.metadata) state.metadata = update.metadata
      }),
    switchAgent: (update) => Effect.sync(() => void state.agents.push(Agent.ID.make(update.agent))),
    // SAFETY: the plugin ignores what synthetic returns.
    synthetic: (message) => Effect.sync(() => void synthetic.push(message.text)) as never,
    // SAFETY: tests call hooks with only the fields the plugin reads.
    hook: ((name: string, callback: (event: never) => Effect.Effect<void>) => {
      hooks.set(name, callback)
      return Effect.succeed({ dispose: Effect.void })
    }) as never,
  }
  yield* ForgePlanPlugin.Plugin.effect(
    host({
      session,
      event: { subscribe: () => Stream.fromIterable(input.events ?? []) },
      agent: {
        get: () => Effect.die("unused agent.get"),
        list: () => Effect.die("unused agent.list"),
        reload: () => Effect.die("unused agent.reload"),
        transform: (callback) => {
          callback({
            list: () => Array.from(agents.values()),
            get: (id) => agents.get(Agent.ID.make(id)),
            default: () => {},
            update: (id, update) => {
              const agent = agents.get(Agent.ID.make(id))
              if (agent) update(agent)
            },
            remove: () => {},
          })
          return Effect.succeed({ dispose: Effect.void })
        },
      },
      tool: {
        reload: () => Effect.die("unused tool.reload"),
        list: () => Effect.die("unused tool.list"),
        hook: () => Effect.succeed({ dispose: Effect.void }),
        transform: (callback) => {
          // SAFETY: the plugin only adds tools.
          callback({ add: (tool: ToolDefinition.Info) => void tools.set(tool.name, tool) } as never)
          return Effect.succeed({ dispose: Effect.void })
        },
      },
    }),
  ).pipe(
    Effect.provideService(
      Form.Service,
      // SAFETY: the plugin only asks forms.
      {
        ask: () =>
          Effect.succeed(
            input.answer === undefined
              ? { status: "cancelled" as const }
              : { status: "answered" as const, answer: { decision: input.answer, switch: input.answer } },
          ),
      } as unknown as Form.Interface,
    ),
    Effect.provideService(
      FileSystem.Service,
      // SAFETY: the plugin reads only the size of the plan file.
      {
        read: () => (input.written ? Effect.succeed({ size: 10 }) : Effect.fail(new Error("missing"))),
      } as unknown as FileSystem.Interface,
    ),
    Effect.scoped,
  )

  const call = (name: string, agent = plan) => {
    const tool = tools.get(name)
    if (!tool) return Effect.die(`${name} was not registered`)
    // SAFETY: the tools read only these fields of their context.
    const context = { sessionID, agent, messageID: "msg_forge_plan", id: "call_forge_plan" } as never
    return Effect.exit(tool.execute({}, context) as Effect.Effect<{ content: string }, Error>)
  }

  // Runs the context hook for one provider request and returns the messages it sends.
  const context = (agent: Agent.ID, messages: Message[]) => {
    const event = { sessionID, agent, messages }
    const hook = hooks.get("context")
    if (!hook) return Effect.die("context hook was not registered")
    return hook(event as never).pipe(Effect.as(event.messages))
  }

  return { state, synthetic, agents, call, context }
})

describe("ForgePlanPlugin", () => {
  it.effect("lets the plan agent edit only plan files and gives each tool to one agent", () =>
    Effect.gen(function* () {
      const result = yield* run({})
      const rules = result.agents.get(plan)!.permissions
      expect(rules).toContainEqual({ action: "edit", resource: "*", effect: "deny" })
      expect(rules).toContainEqual({ action: "edit", resource: ".opencode/plans/*", effect: "allow" })
      // The write tool checks files inside the session's directory by their relative path.
      const settle = (resource: string) => Permission.evaluate("edit", resource, rules).effect
      expect(settle(".opencode/plans/1-calm-river.md")).toBe("allow")
      expect(settle("src/index.ts")).toBe("deny")
      expect(rules).toContainEqual({ action: "plan_enter", resource: "*", effect: "deny" })
      expect(result.agents.get(build)!.permissions).toContainEqual({
        action: "present_plan",
        resource: "*",
        effect: "deny",
      })
      expect(result.agents.get(Agent.ID.make("explore"))!.permissions).toContainEqual({
        action: "plan_enter",
        resource: "*",
        effect: "deny",
      })
    }),
  )

  it.effect("entering Plan starts a plan file and names it in the reminder", () =>
    Effect.gen(function* () {
      const result = yield* run({ events: [selected(plan, build)] })
      yield* Effect.yieldNow
      const info = ForgePlan.read(result.state.metadata)
      expect(info?.status).toBe("drafting")
      expect(info?.path).toStartWith(".opencode/plans/")
      // The reminder names the file by its native absolute path, so this matches on Windows too.
      expect(result.synthetic[0]).toContain(path.join("/workspace", info!.path))
    }),
  )

  it.effect("a prompt that asks Build for a plan is nudged to plan_enter", () =>
    Effect.gen(function* () {
      const result = yield* run({})
      const asked = yield* result.context(build, [
        Message.user("This is my personal website. Plan all the changes and work in a dedicated branch."),
      ])
      expect(asked).toHaveLength(2)
      expect(JSON.stringify(asked.at(-1))).toContain("Call plan_enter now")

      const mentioned = yield* result.context(build, [Message.user("Implement the plan you wrote earlier.")])
      expect(mentioned).toHaveLength(1)

      const planning = yield* result.context(plan, [Message.user("Make a plan for the new page.")])
      expect(JSON.stringify(planning)).not.toContain("Call plan_enter now")
    }),
  )

  it.effect("refuses to present a plan that was never written", () =>
    Effect.gen(function* () {
      const result = yield* run({ answer: "Accept (Manual)", written: false })
      const exit = yield* result.call("present_plan")
      expect(Exit.isFailure(exit)).toBe(true)
      expect(String(Option.getOrUndefined(Exit.findErrorOption(exit)))).toContain("Write the plan")
      expect(result.state.agents).toEqual([])
    }),
  )

  it.effect("accepting with auto edits switches to Build in edits mode", () =>
    Effect.gen(function* () {
      const result = yield* run({ answer: "Accept (Auto)", written: true })
      const exit = yield* result.call("present_plan")
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(ForgePlan.read(result.state.metadata)?.status).toBe("accepted")
      expect(ForgeMode.read(result.state.metadata)).toBe("edits")
      expect(result.state.agents).toEqual([build])
    }),
  )

  it.effect("custom feedback keeps revising the same plan", () =>
    Effect.gen(function* () {
      const existing = { path: ".opencode/plans/1-calm-river.md", status: "ready" as const }
      const result = yield* run({ answer: "Split step 2", written: true, metadata: { [ForgePlan.key]: existing } })
      const exit = yield* result.call("present_plan")
      expect(Exit.isSuccess(exit) && exit.value.content).toContain("Split step 2")
      expect(ForgePlan.read(result.state.metadata)).toEqual({ ...existing, status: "drafting" })
      expect(result.state.agents).toEqual([])
    }),
  )

  it.effect("a decided plan gives the next cycle a new file", () =>
    Effect.gen(function* () {
      const existing = { path: ".opencode/plans/1-calm-river.md", status: "accepted" as const }
      const result = yield* run({ answer: "Deny", written: true, metadata: { [ForgePlan.key]: existing } })
      yield* result.call("present_plan")
      const info = ForgePlan.read(result.state.metadata)
      expect(info?.path).not.toBe(existing.path)
      expect(info?.status).toBe("denied")
    }),
  )

  it.effect("plan_enter switches to Plan only when the user agrees", () =>
    Effect.gen(function* () {
      const yes = yield* run({ answer: "Yes" })
      yield* yes.call("plan_enter", build)
      expect(yes.state.agents).toEqual([plan])

      const no = yield* run({ answer: "No" })
      yield* no.call("plan_enter", build)
      expect(no.state.agents).toEqual([])
    }),
  )
})
