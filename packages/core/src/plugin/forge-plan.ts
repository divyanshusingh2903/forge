export * as ForgePlanPlugin from "./forge-plan.js"

import { Message, ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import { ForgeMode } from "@opencode/schema/forge-mode"
import { ForgePlan } from "@opencode/schema/forge-plan"
import type { Session } from "@opencode/schema/session"
import type { SessionEvent } from "@opencode/schema/session-event"
import { Effect, Schema, Stream } from "effect"
import path from "path"
import { FileSystem } from "../filesystem.js"
import { Form } from "../form.js"
import { Permission } from "../permission.js"
import { RelativePath } from "../schema.js"
import { QuestionTool } from "../tool/plugin/question.js"
import { Slug } from "../util/slug.js"
import PLAN_MODE from "./forge-plan/plan-mode.txt"
import PRESENT_PLAN from "./forge-plan/present-plan.txt"
import PLAN_ENTER from "./forge-plan/plan-enter.txt"

const plan = Agent.ID.make("plan")
const build = Agent.ID.make("build")

export const presentName = "present_plan"
export const enterName = "plan_enter"

const enterPrefix = PLAN_MODE.slice(0, PLAN_MODE.indexOf("${planFile}"))

const leave = `<system-reminder>
You are NO LONGER in Plan mode. The previous Plan restrictions no longer apply. Any Plan mode instructions from earlier in this conversation are no longer active.
</system-reminder>`

const planRequested = `<system-reminder>
The user asked for a plan. Call ${enterName} now, before reading code, exploring, or answering. Do not write a plan in chat: Plan mode writes it to a plan file the user reviews.
</system-reminder>`

const Decision = {
  manual: "Accept (Manual)",
  edits: "Accept (Auto)",
  revise: "Revise",
  deny: "Deny",
} as const

const Empty = Schema.Struct({})

/**
 * Forge's Plan mode, in place of upstream's discuss-in-chat Plan agent. Each planning cycle writes one plan file under
 * `.opencode/plans/` in the session's directory, which the session's metadata names so the app can show it for review.
 * The plan agent may edit only plan files, and presents its plan with `present_plan`, whose answer switches the session
 * to Build in the chosen mode, keeps revising, or rejects the plan. The build agent can suggest Plan with `plan_enter`.
 */
export const Plugin = {
  id: "forge.plan",
  effect: Effect.fn("ForgePlanPlugin.Plugin")(function* (ctx: Context) {
    const forms = yield* Form.Service
    const files = yield* FileSystem.Service
    const directory = path.join(ctx.location.directory, ForgePlan.directory)
    const absolute = (relative: string) => path.join(ctx.location.directory, relative)
    const enter = (info: ForgePlan.Info) => PLAN_MODE.replace("${planFile}", absolute(info.path))

    yield* ctx.agent.transform((editor) => {
      editor.update(plan, (item) => {
        item.name = Agent.Name.make("Plan")
        item.description =
          "Read-only agent that researches the task and writes a plan for review before implementation."
        item.mode = "primary"
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
        item.permissions.push({ action: "edit", resource: "*", effect: "deny" })
        // Edits inside the session's directory are checked by their slash-separated relative path, so plan files are
        // allowed, without asking, by that form rather than the absolute one.
        item.permissions.push({ action: "edit", resource: `${ForgePlan.directory}/*`, effect: "allow" })
        item.permissions.push({ action: "subagent", resource: "general", effect: "deny" })
        item.permissions.push({ action: presentName, resource: "*", effect: "allow" })
        item.permissions.push({ action: enterName, resource: "*", effect: "deny" })
      })
      // Each tool belongs to one agent; every other agent loses it, so it never reaches their tool list.
      for (const item of editor.list()) {
        if (item.id !== plan) item.permissions.push({ action: presentName, resource: "*", effect: "deny" })
        if (item.id !== build) item.permissions.push({ action: enterName, resource: "*", effect: "deny" })
      }
    })

    const setPlan = Effect.fn("ForgePlanPlugin.setPlan")(function* (
      sessionID: Session.ID,
      info: ForgePlan.Info,
      mode?: ForgeMode.Mode,
    ) {
      // Metadata is replaced as a whole, so the plan is merged into what the session already holds.
      const session = yield* ctx.session.get({ sessionID })
      yield* ctx.session.update({
        sessionID,
        metadata: { ...session.metadata, [ForgePlan.key]: info, ...(mode ? { [ForgeMode.key]: mode } : {}) },
      })
    })

    // The plan being written or reviewed, or a new file for a new cycle once the last one was decided.
    const current = Effect.fn("ForgePlanPlugin.current")(function* (sessionID: Session.ID) {
      const session = yield* ctx.session.get({ sessionID })
      const existing = ForgePlan.read(session.metadata)
      if (ForgePlan.open(existing)) return existing
      const next: ForgePlan.Info = {
        // Slash-separated on every platform, since the edit rule above and the app both match it that way.
        path: path.posix.join(ForgePlan.directory, `${Date.now()}-${Slug.create()}.md`),
        status: "drafting",
      }
      yield* setPlan(sessionID, next)
      return next
    })

    yield* ctx.tool.hook("execute.after", (event) => {
      if (event.agent !== plan) return Effect.void
      if (event.status !== "error") return Effect.void
      if (event.tool !== "edit" && event.tool !== "write" && event.tool !== "patch") return Effect.void
      if (!(event.error.error instanceof Permission.BlockedError)) return Effect.void
      event.error = new ToolFailure({
        message: `Cannot use ${event.tool} outside the plan file in Plan mode. Write the plan under ${directory}.`,
      })
      return Effect.void
    })

    // Compaction and committed reverts can strip reminders while the session's agent stays put. Reconcile per request,
    // appending near the tail so the cached prefix stays warm.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        // The tool description alone lets a model research and answer with a plan in chat, so a prompt that asks for a
        // plan gets a nudge for this request only. Later provider turns end in tool results and drop it.
        if (event.agent === build && asksForPlan(event.messages.at(-1)))
          event.messages.push(Message.user(planRequested))

        const reminder = lastReminder(event.messages)
        const stale = event.agent !== plan && reminder?.startsWith(enterPrefix)
        if (event.agent !== plan && !stale) return
        const text = stale ? leave : enter(yield* current(event.sessionID))
        if (text === reminder) return
        // Before the user's prompt, matching where agent-switch reminders land.
        const at = event.messages.at(-1)?.role === "user" ? event.messages.length - 1 : event.messages.length
        event.messages.splice(at, 0, Message.user(text))
        yield* ctx.session.synthetic({ sessionID: event.sessionID, text, resume: false })
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to persist Plan mode reminder", { sessionID: event.sessionID, cause }),
        ),
      ),
    )

    yield* ctx.event.subscribe({ types: ["session.created", "session.agent.selected"] }).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const change = switchKind(event)
          if (!change) return
          const text = change === "enter" ? enter(yield* current(event.data.sessionID)) : leave
          yield* ctx.session.synthetic({ sessionID: event.data.sessionID, text, resume: false })
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to inject Plan mode reminder", { sessionID: event.data.sessionID, cause }),
          ),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: presentName,
          options: { codemode: false },
          description: PRESENT_PLAN,
          input: Empty,
          output: Schema.Struct({ decision: Schema.String }),
          execute: (_input, context) =>
            Effect.gen(function* () {
              if (context.agent !== plan)
                return yield* new ToolFailure({ message: `${presentName} is only available in Plan mode` })
              const info = yield* current(context.sessionID)
              const written = yield* files.read({ path: RelativePath.make(info.path) }).pipe(
                Effect.map((file) => file.size > 0),
                Effect.orElseSucceed(() => false),
              )
              if (!written)
                return yield* new ToolFailure({
                  message: `Write the plan to ${absolute(info.path)} before presenting it.`,
                })
              yield* setPlan(context.sessionID, { ...info, status: "ready" })
              const state = yield* forms
                .ask({
                  sessionID: context.sessionID,
                  title: "Plan review",
                  metadata: {
                    kind: "question",
                    forge: "plan.review",
                    plan: info.path,
                    tool: { messageID: context.messageID, id: context.id },
                  },
                  fields: [
                    {
                      key: "decision",
                      title: "Plan review",
                      description: `The plan at ${info.path} is ready. How would you like to proceed?`,
                      type: "string",
                      options: [
                        {
                          value: Decision.manual,
                          label: Decision.manual,
                          description: "Switch to Build; approve each edit yourself",
                        },
                        {
                          value: Decision.edits,
                          label: Decision.edits,
                          description: "Switch to Build; accept edits automatically",
                        },
                        { value: Decision.revise, label: Decision.revise, description: "Keep refining the plan" },
                        { value: Decision.deny, label: Decision.deny, description: "Stop here; don't implement it" },
                      ],
                      custom: true,
                    },
                  ],
                })
                .pipe(Effect.orDie)
              if (state.status === "cancelled") {
                yield* setPlan(context.sessionID, { ...info, status: "drafting" })
                // Dismissal ends the step, as a dismissed question does; a message is feedback the model acts on.
                if (state.message !== undefined) return yield* new ToolFailure({ message: state.message })
                return yield* Effect.die(new QuestionTool.CancelledError())
              }
              const decision = String(state.answer.decision ?? "")
              const done = (content: string) => ({ output: { decision }, content, metadata: { decision } })

              if (decision === Decision.manual || decision === Decision.edits) {
                const mode = decision === Decision.edits ? "edits" : "manual"
                yield* setPlan(context.sessionID, { ...info, status: "accepted" }, mode)
                yield* ctx.session.switchAgent({ sessionID: context.sessionID, agent: build })
                return done(
                  `The user accepted the plan at ${absolute(info.path)}. You are now in Build mode${
                    mode === "edits" ? ", and file edits are accepted automatically" : ""
                  }. Implement the plan now, step by step.`,
                )
              }
              if (decision === Decision.deny) {
                yield* setPlan(context.sessionID, { ...info, status: "denied" })
                return done("The user rejected the plan. Do not implement it. Stop and wait for further instructions.")
              }
              yield* setPlan(context.sessionID, { ...info, status: "drafting" })
              const feedback = decision === Decision.revise ? "" : ` Their feedback: ${decision}`
              return done(
                `The user wants to revise the plan.${feedback} Ask what to change if it isn't clear, edit ${absolute(
                  info.path,
                )}, then call ${presentName} again.`,
              )
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: String(error) }),
              ),
            ),
        })
        editor.add({
          name: enterName,
          options: { codemode: false },
          description: PLAN_ENTER,
          input: Empty,
          output: Schema.Struct({ switched: Schema.Boolean }),
          execute: (_input, context) =>
            Effect.gen(function* () {
              const state = yield* forms
                .ask({
                  sessionID: context.sessionID,
                  title: "Plan mode",
                  metadata: {
                    kind: "question",
                    forge: "plan.enter",
                    tool: { messageID: context.messageID, id: context.id },
                  },
                  fields: [
                    {
                      key: "switch",
                      title: "Plan mode",
                      description: "This looks like it needs planning before implementation. Switch to Plan mode?",
                      type: "string",
                      options: [
                        { value: "Yes", label: "Yes", description: "Research and write a plan before making changes" },
                        { value: "No", label: "No", description: "Continue directly with the request" },
                      ],
                      custom: false,
                    },
                  ],
                })
                .pipe(Effect.orDie)
              if (state.status === "cancelled") return yield* Effect.die(new QuestionTool.CancelledError())
              const switched = state.answer.switch === "Yes"
              if (switched) yield* ctx.session.switchAgent({ sessionID: context.sessionID, agent: plan })
              return {
                output: { switched },
                content: switched
                  ? "The user switched to Plan mode. Research the task and write the plan file named in the Plan mode reminder."
                  : "The user wants to continue without a plan. Carry on with the request directly.",
                metadata: { switched },
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: String(error) }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}

function switchKind(event: SessionEvent.Created | SessionEvent.AgentSelected) {
  if (event.type === "session.created") return event.data.agent === plan ? ("enter" as const) : undefined
  if (event.data.agent === event.data.previous) return undefined
  if (event.data.agent === plan) return "enter" as const
  if (event.data.previous === plan) return "leave" as const
  return undefined
}

// Requests for a plan, not mentions of one: "plan all the changes", "make a plan", "plan this first", "let's plan".
const planRequest =
  /\b(?:plan\s+(?:it|this|that|out|all|the|everything|first|before|how|for)\b|(?:make|create|write|draft|prepare|come up with|give me|need)\s+(?:a|an|the)?\s*(?:detailed\s+|full\s+|implementation\s+)?plan\b|let'?s\s+plan\b|start\s+(?:by\s+)?planning\b)/i

function asksForPlan(message: Message | undefined) {
  if (message?.role !== "user") return false
  return message.content.some((part) => part.type === "text" && planRequest.test(part.text))
}

function lastReminder(messages: ReadonlyArray<Message>) {
  return messages.reduce<string | undefined>((found, message) => {
    const part = message.role === "user" && message.content.length === 1 ? message.content[0] : undefined
    if (part?.type !== "text") return found
    return part.text.startsWith(enterPrefix) || part.text === leave ? part.text : found
  }, undefined)
}
