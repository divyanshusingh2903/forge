import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "../session/schema"
import PRESENT_PLAN_DESCRIPTION from "./present-plan.txt"
import ENTER_PLAN_DESCRIPTION from "./plan-enter.txt"

export const Parameters = Schema.Struct({})

type PresentMetadata = {
  switched: boolean
  autoAccept: boolean
}

type EnterMetadata = {
  switched: boolean
}

const ACCEPT_MANUAL = "Accept (Manual)"
const ACCEPT_AUTO = "Accept (Auto)"
const REVISE = "Revise"
const DENY = "Deny"

export const PresentPlanTool = Tool.define(
  "present_plan",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: PRESENT_PLAN_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context<PresentMetadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(
            instance.worktree,
            Session.plan(Session.planCycleAnchor(ctx.messages, info) ?? info, instance),
          )
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: `Plan at ${plan} is complete. How would you like to proceed?`,
                header: "Plan Review",
                custom: false,
                options: [
                  { label: ACCEPT_MANUAL, description: "Switch to build agent; approve each edit yourself" },
                  { label: ACCEPT_AUTO, description: "Switch to build agent; auto-accept edits" },
                  { label: REVISE, description: "Keep refining the plan with the plan agent" },
                  { label: DENY, description: "Stop here, don't implement this plan" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const choice = answers[0]?.[0]
          if (choice === DENY) yield* new Question.RejectedError()
          if (choice === REVISE) {
            return {
              title: "Continuing to revise the plan",
              output:
                "The user wants to keep revising the plan. Ask what they'd like changed and continue refining the plan file.",
              metadata: { switched: false, autoAccept: false },
            }
          }

          const autoAccept = choice === ACCEPT_AUTO

          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
          const model =
            lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : yield* provider.defaultModel()

          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: `The plan at ${plan} has been approved, you can now edit files. Execute the plan`,
            synthetic: true,
          } satisfies SessionV1.TextPart)

          return {
            title: "Switching to build agent",
            output: "User approved switching to build agent. Wait for further instructions.",
            metadata: { switched: true, autoAccept },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const PlanEnterTool = Tool.define(
  "plan_enter",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: ENTER_PLAN_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context<EnterMetadata>) =>
        Effect.gen(function* () {
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: "This looks like it needs planning before implementation. Switch to plan mode?",
                header: "Plan Mode",
                custom: false,
                options: [
                  { label: "Yes", description: "Switch to plan mode: research and design before making changes" },
                  { label: "No", description: "Continue directly with the request" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          if (answers[0]?.[0] !== "Yes") {
            return {
              title: "Continuing without planning",
              output: "The user chose to continue without switching to plan mode. Proceed with their request directly.",
              metadata: { switched: false },
            }
          }

          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
          const model =
            lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : yield* provider.defaultModel()

          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "plan",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: "Switched to plan mode. Research and design the approach before writing any code, then use present_plan once you've written the plan file.",
            synthetic: true,
          } satisfies SessionV1.TextPart)

          return {
            title: "Switching to plan agent",
            output: "User approved switching to plan agent. Research and design before implementing.",
            metadata: { switched: true },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
