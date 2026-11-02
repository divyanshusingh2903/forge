import { createMemo, For, onCleanup, Show } from "solid-js"
import { createKeyed, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import { uuid } from "@opencode/util/uuid"
import { ForgePlan } from "@opencode/schema/forge-plan"
import { Markdown } from "@opencode/session-ui/markdown"
import { Icon } from "@opencode/ui/icon"
import { PlanQuote } from "./quote"

/** The plan file, kept current while the agent edits it, under its path and review status. */
export default function PlanPanel(props: {
  session: MountedSession
  screen: SessionScreen
  plan: () => ForgePlan.Info | undefined
  t: (
    key:
      | "status.drafting"
      | "status.ready"
      | "status.accepted"
      | "status.denied"
      | "empty.title"
      | "empty.description"
      | "missing.description"
      | "outline.label"
      | "quote.label",
  ) => string
}) {
  // Loading the file starts the server's watch, so edits stream in; a new plan file or a closed tab stops it. A status
  // change loads it again, in case the watch started before the agent first wrote the file.
  createKeyed(
    () => {
      const info = props.plan()

      return info && `${info.path}\u0000${info.status}`
    },
    () => {
      const path = props.plan()?.path

      if (!path) return
      const files = props.screen.file
      void files.sync(path, { force: true, silent: true })
      onCleanup(() => files.unwatch(path))
    },
  )

  const file = () => {
    const path = props.plan()?.path

    return path ? props.screen.file.get(path) : undefined
  }

  const text = () => {
    const content = file()?.content

    return content?.type === "text" ? content.content : ""
  }

  let content: HTMLDivElement | undefined

  // Headings to level 3 in document order, skipping fenced code, so the nth entry is the nth rendered heading.
  const outline = createMemo(() => {
    const code = { fenced: false }

    return text()
      .split("\n")
      .flatMap((line) => {
        if (/^\s*(```|~~~)/.test(line)) {
          code.fenced = !code.fenced

          return []
        }

        const match = code.fenced ? undefined : /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line)

        return match ? [{ depth: match[1]!.length, title: match[2]! }] : []
      })
  })

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden bg-v2-background-bg-base" data-component="plan-panel">
      <Show
        when={props.plan()}
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
            <Icon name="file-document" class="text-v2-icon-icon-muted" />
            <div class="text-v2-text-text-base [font-weight:530]">{props.t("empty.title")}</div>
            <div class="max-w-80 text-v2-text-text-muted">{props.t("empty.description")}</div>
          </div>
        }
      >
        {(info) => (
          <>
            <div class="flex h-10 shrink-0 items-center gap-2 border-b border-v2-border-border-base px-4">
              <span class="min-w-0 flex-1 truncate font-mono text-[12px] text-v2-text-text-muted" title={info().path}>
                {info().path}
              </span>
              <span
                data-slot="plan-status"
                data-status={info().status}
                class="shrink-0 rounded-full px-2 py-0.5 text-[11px] [font-weight:530] bg-v2-background-bg-layer-02 text-v2-text-text-muted data-[status=ready]:text-v2-text-text-base data-[status=accepted]:text-v2-text-text-success data-[status=denied]:text-v2-text-text-faint"
              >
                {props.t(`status.${info().status}`)}
              </span>
            </div>
            <div class="@container flex min-h-0 flex-1">
              {/* The plan's sections, beside it once the pane is wide enough to spare the room. */}
              <Show when={outline().length > 1}>
                <nav
                  data-slot="plan-outline"
                  aria-label={props.t("outline.label")}
                  class="hidden w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-v2-border-border-base px-2 py-4 @[640px]:flex"
                >
                  <For each={outline()}>
                    {(heading, index) => (
                      <button
                        type="button"
                        class="truncate rounded-[6px] py-1 pr-2 text-left text-[12px] text-v2-text-text-muted hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base"
                        style={{ "padding-left": `${8 + (heading.depth - 1) * 10}px` }}
                        title={heading.title}
                        onClick={() =>
                          content
                            ?.querySelectorAll("h1, h2, h3")
                            [index()]?.scrollIntoView({ block: "start", behavior: "smooth" })
                        }
                      >
                        {heading.title}
                      </button>
                    )}
                  </For>
                </nav>
              </Show>
              <div ref={content} class="min-h-0 flex-1 overflow-y-auto px-6 py-5 select-text">
                <Show
                  when={text()}
                  fallback={<div class="text-v2-text-text-muted">{props.t("missing.description")}</div>}
                >
                  <Markdown text={text()} class="text-14-regular" />
                </Show>
              </div>
              {/* Selected plan text quotes into the composer of the screen showing this panel. */}
              <PlanQuote
                root={() => content}
                available={() => props.screen.composer.quotable()}
                add={(quoted, anchor) => {
                  const composer = props.screen.composer
                  const commentID = uuid()

                  composer.attach({
                    type: "quote",
                    commentID,
                    text: quoted,
                    source: {
                      label: props.t("quote.label"),
                      icon: "file-document",
                      subject: ForgePlan.quoteSubject(info().path),
                    },
                  })
                  composer.focus(anchor ? commentID : undefined, { anchor })
                }}
              />
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
