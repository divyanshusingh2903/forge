import type { SessionMessageInfo } from "@opencode/client/promise"
import { createStore } from "solid-js/store"
import { MessageActionsProvider, type MessageAction } from "../context/message-actions"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "../storybook/current-session-fixtures"
import { CurrentSessionTimelineStory } from "../storybook/current-session-story"

export default {
  title: "OpenCode/Conversation/Message actions",
  id: "current-message-actions",
  parameters: { layout: "fullscreen" },
}

const user = { id: "msg_actions_user", type: "user", text: "Fix the build", time: { created: STORY_TIME } } as const

const assistant = {
  id: "msg_actions_assistant",
  type: "assistant",
  agent: "build",
  model: STORY_MODEL,
  content: [{ type: "text", text: "The build is fixed." }],
  time: { created: STORY_TIME + 1, completed: STORY_TIME + 2 },
} satisfies SessionMessageInfo

/** A host toggle on both messages of a turn: each click flips it and records what the host was told. */
export const Pin = {
  render: () => {
    const [state, setState] = createStore<{ pinned: Record<string, boolean>; last: string }>({ pinned: {}, last: "" })

    const pin: MessageAction = {
      id: "pin",
      icon: (active) => (active ? "pin-filled" : "pin"),
      label: (active) => (active ? "Remove chapter" : "Pin as chapter"),
      active: (messageID) => state.pinned[messageID] === true,
      run: (input) => {
        setState("pinned", input.messageID, (value) => !value)
        setState("last", `${input.role} ${input.messageID} in ${input.turnMessageID}: ${input.text}`)
      },
    }

    return (
      <MessageActionsProvider actions={[pin]}>
        <CurrentSessionTimelineStory
          title="Host message actions"
          description="A host action, here the chapter pin, sits beside copy on the user message and on the turn's final reply."
          document={{
            sessionID: CURRENT_SESSION_ID,
            status: { type: "idle" },
            diffs: [],
            messages: [user, assistant],
          }}
        />
        <output data-testid="last-action" class="block px-6 text-13-regular text-text-weak">
          {state.last}
        </output>
      </MessageActionsProvider>
    )
  },
}
