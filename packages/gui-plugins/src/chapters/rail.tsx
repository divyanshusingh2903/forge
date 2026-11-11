import { createMemo, createSignal, For, Show } from "solid-js"
import type { ForgeChapters } from "@opencode/schema/forge-chapters"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"

type Chapter = ForgeChapters.Chapter

type Params = Record<string, string | number>

const sourceIcon = { pin: "pin-filled", compaction: "collapse", reference: "branch" } as const

/**
 * A session's chapters as notches on the transcript's edge, one per chapter in transcript order. Pointing at the
 * notches, or focusing them, opens the titled list over them: a row jumps to its message, and can be renamed or
 * removed. Renders nothing for a session without chapters.
 */
export default function ChaptersRail(props: {
  state: () => ForgeChapters.State
  /** The user message whose turn is at the top of the transcript's viewport. */
  turnMessageID: () => string | undefined
  actions: {
    jump: (chapter: Chapter) => void
    rename: (messageID: string, title: string) => Promise<void>
    remove: (messageID: string) => Promise<void>
  }
  t: (key: string, params?: Params) => string
}) {
  // The chapter being read: the last one that starts at or before the turn in view. Message IDs ascend, so the
  // comparison follows the transcript. Above the first chapter nothing is current.
  const current = createMemo(() => {
    const turn = props.turnMessageID()

    return turn ? props.state().chapters.findLast((chapter) => chapter.turnMessageID <= turn)?.anchorMessageID : undefined
  })

  return (
    <Show when={props.state().chapters.length > 0}>
      <nav data-component="chapters-rail" aria-label={props.t("rail.label")} class="group relative">
        {/* Starts on the session name's start edge: the header's 10px inset plus the 4px its first item is padded by. */}
        <ol aria-hidden="true" class="flex flex-col gap-2 py-2 ps-3.5 pe-3 group-focus-within:opacity-0 group-hover:opacity-0">
          <For each={props.state().chapters}>
            {(chapter) => (
              <li
                data-slot="chapter-notch"
                data-source={chapter.source}
                data-current={current() === chapter.anchorMessageID ? "" : undefined}
                class="h-0.5 w-3 rounded-full bg-v2-text-text-muted opacity-60 data-[current]:h-[3px] data-[current]:bg-v2-text-text-base data-[current]:opacity-100"
              />
            )}
          </For>
        </ol>
        <ol
          data-slot="chapters-list"
          class="pointer-events-none absolute start-2.5 top-0 flex max-h-[60vh] w-64 flex-col gap-0.5 overflow-y-auto rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-base p-1 opacity-0 shadow-lg group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
        >
          <For each={props.state().chapters}>
            {(chapter) => (
              <Row chapter={chapter} current={current() === chapter.anchorMessageID} actions={props.actions} t={props.t} />
            )}
          </For>
        </ol>
      </nav>
    </Show>
  )
}

function Row(props: {
  chapter: Chapter
  current: boolean
  actions: Parameters<typeof ChaptersRail>[0]["actions"]
  t: (key: string, params?: Params) => string
}) {
  const [editing, setEditing] = createSignal(false)

  const save = (value: string) => {
    setEditing(false)

    if (value.trim() && value.trim() !== props.chapter.title)
      void props.actions.rename(props.chapter.anchorMessageID, value)
  }

  return (
    <li
      data-slot="chapter-row"
      data-source={props.chapter.source}
      data-role={props.chapter.role}
      data-current={props.current ? "" : undefined}
      aria-current={props.current ? "location" : undefined}
      class="group/row flex items-center rounded-[6px] hover:bg-v2-background-bg-layer-01"
    >
      <Show
        when={editing()}
        fallback={
          <button
            type="button"
            class="flex min-w-0 flex-1 cursor-default items-center gap-2 rounded-[6px] px-2 py-1 text-left"
            title={`${props.t(`source.${props.chapter.source}`)} · ${props.t(`role.${props.chapter.role}`)}`}
            aria-label={props.t("jump", { title: props.chapter.title })}
            onClick={() => props.actions.jump(props.chapter)}
          >
            {/* Fixed size: a long title must not squeeze its icon. */}
            <Icon name={sourceIcon[props.chapter.source]} size="small" class="shrink-0" aria-hidden="true" />
            <span class="truncate text-[12px] text-v2-text-text-base" classList={{ "[font-weight:530]": props.current }}>
              {props.chapter.title}
            </span>
          </button>
        }
      >
        <input
          ref={(element) => queueMicrotask(() => element.select())}
          type="text"
          class="m-0.5 h-6 min-w-0 flex-1 rounded-[4px] border border-v2-border-border-base bg-v2-background-bg-base px-1.5 text-[12px] text-v2-text-text-base"
          value={props.chapter.title}
          aria-label={props.t("rename.label")}
          onKeyDown={(event) => {
            if (event.key === "Enter") save(event.currentTarget.value)

            if (event.key === "Escape") setEditing(false)
          }}
          onBlur={(event) => {
            if (editing()) save(event.currentTarget.value)
          }}
        />
      </Show>
      <Show when={!editing()}>
        <span class="hidden shrink-0 items-center group-focus-within/row:flex group-hover/row:flex">
          <IconButton
            icon={<Icon name="edit" size="small" />}
            size="small"
            variant="ghost-muted"
            aria-label={props.t("rename")}
            onClick={() => setEditing(true)}
          />
          <IconButton
            icon={<Icon name="close" size="small" />}
            size="small"
            variant="ghost-muted"
            aria-label={props.t("remove")}
            onClick={() => void props.actions.remove(props.chapter.anchorMessageID)}
          />
        </span>
      </Show>
    </li>
  )
}
