import { describe, expect, mock, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { normalizeSessionMessages } from "@/utils/session-message"

mock.module("@opencode-ai/session-ui/message-part", () => ({
  renderable: (part: { type: string; tool?: string }) => part.tool !== "todowrite",
  groupParts: (refs: Array<{ messageID: string; part: { id: string } }>) =>
    refs.map((ref) => ({
      type: "part" as const,
      key: ref.part.id,
      ref: { messageID: ref.messageID, partID: ref.part.id },
    })),
}))

const { Timeline, TimelineRow } = await import("./rows")

describe("current session timeline rows", () => {
  test("derives turns and tagged rows from chronological current messages", () => {
    const source = [
      { id: "msg_1", type: "user", text: "first", time: { created: 1 } },
      {
        id: "msg_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "answer" }],
        time: { created: 2, completed: 3 },
      },
      { id: "msg_3", type: "user", text: "second", time: { created: 4 } },
      {
        id: "msg_4",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "reasoning", text: "working" }],
        time: { created: 5 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "busy",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.activeMessageID).toBe("msg_3")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_1",
      "assistant-part:msg_1:msg_2:text:0",
      "turn-gap:msg_3",
      "user-message:msg_3",
      "assistant-part:msg_3:msg_4:reasoning:0",
      "thinking:msg_3",
    ])
  })

  test("renders a current shell message as a standalone turn", () => {
    const source = [
      {
        id: "msg_shell",
        type: "shell",
        shellID: "shell_1",
        command: "pwd",
        status: "exited",
        exit: 0,
        output: { output: "/repo", cursor: 5, size: 5, truncated: false },
        time: { created: 1, completed: 2 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.activeMessageID).toBe("msg_shell")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_shell",
      "assistant-part:msg_shell:msg_shell:tool",
    ])
  })

  test("keeps a projected parent missing from the source page before newer turns", () => {
    const source = [
      { id: "msg_user_1", type: "user", text: "first question", time: { created: 1 } },
      {
        id: "msg_assistant_1",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "first answer" }],
        time: { created: 2, completed: 3 },
      },
      { id: "msg_user_2", type: "user", text: "second question", time: { created: 4 } },
      {
        id: "msg_assistant_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "second answer" }],
        time: { created: 5, completed: 6 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source.slice(1),
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user_1",
      "assistant-part:msg_user_1:msg_assistant_1:text:0",
      "turn-gap:msg_user_2",
      "user-message:msg_user_2",
      "assistant-part:msg_user_2:msg_assistant_2:text:0",
    ])
  })

  test("renders an optimistic user turn and thinking before the protocol message arrives", () => {
    const source = [
      { id: "msg_z", type: "user", text: "existing", time: { created: 1 } },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const optimistic = {
      id: "msg_a",
      sessionID: "ses_1",
      role: "user" as const,
      time: { created: 2 },
      agent: "build",
      model: { modelID: "model", providerID: "provider" },
    }
    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) =>
        messageID === optimistic.id ? optimistic : normalized.messages.find((message) => message.id === messageID),
      () => [],
      true,
      "busy",
      true,
      [...normalized.messages.filter((message) => message.role === "user"), optimistic],
    )

    expect(result.activeMessageID).toBe(optimistic.id)
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_z",
      "turn-gap:msg_a",
      "user-message:msg_a",
      "thinking:msg_a",
    ])
  })

  test("removes a failed assistant error when the turn continues streaming", () => {
    const source = [
      { id: "msg_user", type: "user", text: "recover", time: { created: 1 } },
      {
        id: "msg_failed",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [],
        error: { type: "ProviderError", message: "temporary failure" },
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_recovery",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "streaming again" }],
        time: { created: 4 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "busy",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map((row) => row._tag)).toEqual(["UserMessage", "AssistantPart", "Thinking"])
  })

  describe("thinking row while the session is busy", () => {
    const tool = (state: Record<string, unknown>) => ({
      type: "tool" as const,
      id: "call_1",
      name: "shell",
      state,
      time: { created: 2, ran: 3 },
    })

    function rowTags(
      content: unknown[],
      status: "busy" | "idle",
      options: { completed?: number; error?: { type: string; message: string }; showReasoning?: boolean } = {},
    ) {
      const source = [
        { id: "msg_user", type: "user", text: "go", time: { created: 1 } },
        {
          id: "msg_assistant",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content,
          error: options.error,
          time: { created: 2, completed: options.completed },
        },
      ] as SessionMessageInfo[]
      const normalized = normalizeSessionMessages("ses_1", source)
      const messages = new Map(normalized.messages.map((message) => [message.id, message]))
      return Timeline.constructSessionMessageRows(
        source,
        (messageID) => messages.get(messageID),
        (messageID) => normalized.parts.get(messageID) ?? [],
        options.showReasoning ?? true,
        status,
        true,
        normalized.messages.filter((message) => message.role === "user"),
      ).rows.map((row) => row._tag)
    }

    const finished = tool({ status: "completed", input: { command: "ls" }, content: [{ type: "text", text: "ok" }] })

    test("stays up between parts when every tool has finished", () => {
      expect(rowTags([{ type: "text", text: "looking" }, finished], "busy")).toEqual([
        "UserMessage",
        "AssistantPart",
        "AssistantPart",
        "Thinking",
      ])
    })

    test("stays up after streamed text", () => {
      expect(rowTags([{ type: "text", text: "Here is what I found" }], "busy").at(-1)).toBe("Thinking")
    })

    test("stays up after visible reasoning", () => {
      expect(rowTags([{ type: "reasoning", text: "Weighing options" }], "busy").at(-1)).toBe("Thinking")
    })

    test("stays up when reasoning summaries are off", () => {
      const reasoning = { type: "reasoning", text: "Weighing options" }
      expect(rowTags([reasoning, finished], "busy", { showReasoning: false }).at(-1)).toBe("Thinking")
    })

    test("stays up after a tool that failed", () => {
      const failed = tool({ status: "error", input: { command: "false" }, error: { message: "exit 1" } })
      expect(rowTags([failed], "busy").at(-1)).toBe("Thinking")
    })

    test("stays up when the assistant message is finished but the session is still busy", () => {
      expect(rowTags([finished], "busy", { completed: 4 }).at(-1)).toBe("Thinking")
    })

    test("stays up before the assistant has produced anything", () => {
      expect(rowTags([], "busy")).toEqual(["UserMessage", "Thinking"])
    })

    test("is hidden while a tool is running, which shows its own indicator", () => {
      const running = tool({ status: "running", input: { command: "sleep 20" } })
      expect(rowTags([running], "busy")).not.toContain("Thinking")
    })

    test("is hidden while a tool call is still streaming its input", () => {
      const streaming = tool({ status: "streaming", input: '{"command":"sl' })
      expect(rowTags([streaming], "busy")).not.toContain("Thinking")
    })

    test("stays up while only a hidden tool is running", () => {
      const todos = { ...tool({ status: "running", input: { todos: [] } }), name: "todowrite" }
      expect(rowTags([todos], "busy")).toContain("Thinking")
    })

    test("is hidden while a question waits on the user", () => {
      const question = { ...tool({ status: "running", input: { questions: [] } }), name: "question" }
      expect(rowTags([question], "busy")).not.toContain("Thinking")
    })

    test("is hidden once the session is idle", () => {
      expect(rowTags([finished], "idle", { completed: 4 })).not.toContain("Thinking")
    })

    test("is hidden when the turn failed", () => {
      expect(rowTags([], "busy", { completed: 4, error: { type: "ProviderError", message: "boom" } })).not.toContain(
        "Thinking",
      )
    })
  })
})
