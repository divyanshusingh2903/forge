import { createSignal } from "solid-js"
import type { ForgeChapters } from "@opencode/schema/forge-chapters"
import en from "./i18n/en"
import ChaptersRail from "./rail"

type Params = Record<string, string | number>

const dictionary: Record<string, string> = en

const translate = (key: string, params?: Params) =>
  (dictionary[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ""))

const now = Date.parse("2026-11-10T08:00:00Z")

const mixed: ForgeChapters.State = {
  seen: ["github-issue:github.com/forge/app#4"],
  chapters: [
    {
      title: "Set up the release workflow",
      anchorMessageID: "msg_01",
      turnMessageID: "msg_01",
      role: "user",
      source: "pin",
      createdAt: now,
    },
    {
      title: "#4 Chapters tab in the session side panel",
      anchorMessageID: "msg_04",
      turnMessageID: "msg_03",
      role: "assistant",
      source: "reference",
      reference: "github-issue:github.com/forge/app#4",
      createdAt: now,
    },
    {
      title: "Now write the tests for the plugin, the pin button and the rail",
      anchorMessageID: "msg_09",
      turnMessageID: "msg_08",
      role: "assistant",
      source: "compaction",
      createdAt: now,
    },
  ],
}

export default {
  title: "OpenCode/Plugins/Chapters",
  id: "plugins-chapters",
  component: ChaptersRail,
  parameters: {
    docs: {
      description: {
        component:
          "The chapters rail: one notch per chapter on the transcript's start edge. Pointing at the notches opens the titled list; a row jumps to its message, and can be renamed or removed.",
      },
    },
  },
}

// Stands in for the transcript the rail floats over. Applies renames and removals the way the server would, and
// names the last chapter jumped to.
function Frame(props: { state: ForgeChapters.State }) {
  const [state, setState] = createSignal(props.state)
  const [jumped, setJumped] = createSignal("")

  return (
    <div
      data-testid="transcript"
      style={{ position: "relative", width: "520px", height: "420px", border: "1px solid var(--v2-border-border-strong)" }}
    >
      <div style={{ position: "absolute", "inset-inline-start": "0", top: "56px" }}>
        <ChaptersRail
          state={state}
          // The viewport is inside the second chapter's turn.
          turnMessageID={() => "msg_05"}
          actions={{
            jump: (chapter) => setJumped(`${chapter.turnMessageID} ${chapter.anchorMessageID}`),
            rename: async (messageID, title) => {
              setState((current) => ({
                ...current,
                chapters: current.chapters.map((chapter) =>
                  chapter.anchorMessageID === messageID ? { ...chapter, title: title.trim(), renamed: true } : chapter,
                ),
              }))
            },
            remove: async (messageID) => {
              setState((current) => ({
                ...current,
                chapters: current.chapters.filter((chapter) => chapter.anchorMessageID !== messageID),
              }))
            },
          }}
          t={translate}
        />
      </div>
      <output data-testid="jumped" hidden>
        {jumped()}
      </output>
    </div>
  )
}

export const Mixed = { render: () => <Frame state={mixed} /> }

export const Empty = { render: () => <Frame state={{ chapters: [], seen: [] }} /> }
