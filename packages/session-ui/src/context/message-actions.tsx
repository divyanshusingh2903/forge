import { createContext, useContext, type ParentProps } from "solid-js"

/** A toggle the host adds to a message's actions, beside copy: on a user message, and on a turn's final reply. */
export type MessageAction = {
  readonly id: string
  readonly icon: (active: boolean) => "pin" | "pin-filled"
  readonly label: (active: boolean) => string
  /** Whether the action is on for this message. Reactive. */
  readonly active: (messageID: string) => boolean
  /** `turnMessageID` is the user message that opened the message's turn: the message itself for a user message. */
  readonly run: (input: {
    readonly messageID: string
    readonly turnMessageID: string
    readonly role: "user" | "assistant"
    readonly text: string
  }) => void | Promise<void>
}

const context = createContext<{ readonly actions: readonly MessageAction[] }>()

/** Adds the host's actions to every message below it. Without this provider messages show only their own. */
export function MessageActionsProvider(props: ParentProps<{ actions: readonly MessageAction[] }>) {
  return (
    <context.Provider
      value={{
        get actions() {
          return props.actions
        },
      }}
    >
      {props.children}
    </context.Provider>
  )
}

export const useMessageActions = () => useContext(context)?.actions ?? none

const none: readonly MessageAction[] = []
