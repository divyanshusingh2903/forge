import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/session-ui/pierre/selection-bridge"
import { createLineCommentControllerV2 } from "@opencode-ai/session-ui/v2/line-comment-annotations-v2"
import { LineCommentV2OverflowIcon } from "@opencode-ai/ui/v2/line-comment-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { showToast } from "@/utils/toast"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import {
  mapPlanMarkdownBlocks,
  planBlockForLine,
  planBlocksForRange,
  planRangeForBlocks,
} from "@/components/session/plan-markdown-map"

const selectionSide = (range: SelectedLineRange) => range.endSide ?? range.side ?? "additions"

function PlanCommentMenu(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <MenuV2 gutter={4}>
        <MenuV2.Trigger as="button" type="button" data-slot="line-comment-v2-overflow" aria-label={props.moreLabel}>
          <LineCommentV2OverflowIcon />
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content>
            <MenuV2.Item onSelect={props.onEdit}>{props.editLabel}</MenuV2.Item>
            <MenuV2.Item onSelect={props.onDelete}>{props.deleteLabel}</MenuV2.Item>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </div>
  )
}

export function SessionPlanTab(props: { path?: string; pendingRequest?: () => QuestionRequest | undefined }) {
  const file = useFile()
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  const sdk = useSDK()
  const { view } = useSessionLayout()

  createEffect(() => {
    const path = props.path
    if (!path) return
    void file.load(path)
  })

  const state = createMemo(() => {
    const p = props.path
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))
  const blocks = createMemo(() => mapPlanMarkdownBlocks(contents()))

  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = props.path
    if (!p) return null
    return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
  })

  const selectionPreview = (source: string, selection: FileSelection) =>
    previewSelectedLines(source, { start: selection.startLine, end: selection.endLine })

  const buildPreview = (lines: SelectedLineRange) => {
    const source = contents()
    if (!source) return undefined
    return selectionPreview(source, selectionFromLines(lines))
  }

  // Commenting on the plan while present_plan's Accept/Revise/Deny decision is
  // pending implies the user wants to revise -- answer that question on their
  // behalf instead of making them also click "Revise" separately.
  const answeredRequests = new Set<string>()
  const triggerRevise = () => {
    const request = props.pendingRequest?.()
    if (!request || answeredRequests.has(request.id)) return
    answeredRequests.add(request.id)
    void sdk()
      .api.question.reply({ sessionID: request.sessionID, requestID: request.id, answers: [["Revise"]] })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
  }

  const addCommentToContext = (input: { selection: SelectedLineRange; comment: string }) => {
    const p = props.path
    if (!p) return
    const selection = selectionFromLines(input.selection)
    const preview = buildPreview(input.selection)

    const saved = comments.add({ file: p, selection: input.selection, comment: input.comment })
    prompt.context.add({
      type: "file",
      path: p,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: "file",
      preview,
    })
    triggerRevise()
  }

  const updateCommentInContext = (input: { id: string; selection: SelectedLineRange; comment: string }) => {
    const p = props.path
    if (!p) return
    comments.update(p, input.id, input.comment)
    const preview = buildPreview(input.selection)
    prompt.context.updateComment(p, input.id, { comment: input.comment, ...(preview ? { preview } : {}) })
  }

  const removeCommentFromContext = (id: string) => {
    const p = props.path
    if (!p) return
    comments.remove(p, id)
    prompt.context.removeComment(p, id)
  }

  const planComments = createMemo(() => {
    const p = props.path
    if (!p) return []
    return comments.list(p)
  })
  const commentedLines = createMemo(() => planComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    selected: null as SelectedLineRange | null,
  })

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = props.path
    if (!p) return
    file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentControllerV2({
    comments: planComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => props.path ?? "plan",
    mention: {
      items: file.searchFilesAndDirectories,
    },
    getSide: selectionSide,
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    onSubmit: ({ comment, selection }) => addCommentToContext({ selection, comment }),
    onUpdate: ({ id, comment, selection }) => updateCommentInContext({ id, selection, comment }),
    onDelete: (comment) => removeCommentFromContext(comment.id),
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <PlanCommentMenu
        moreLabel={language.t("common.moreOptions")}
        editLabel={language.t("common.edit")}
        deleteLabel={language.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  createEffect(
    on(
      () => props.path,
      () => commentsUi.note.reset(),
      { defer: true },
    ),
  )

  let wrapper: HTMLDivElement | undefined
  let scroll: HTMLDivElement | undefined
  let frame: number | undefined

  const orderedBlockElements = () => {
    if (!wrapper) return []
    return Array.from(wrapper.querySelectorAll<HTMLElement>("[data-plan-block]"))
  }

  const blockRange = (index: number): SelectedLineRange | null => planRangeForBlocks(blocks(), index, index)

  // Tag each rendered markdown block with its source line span and ensure a
  // comment slot follows it. The Markdown component renders asynchronously via
  // a worker, so this re-runs on DOM mutations (observed below) until the
  // real blocks appear.
  const syncMarkdownDom = () => {
    if (!wrapper) return
    const list = blocks()
    if (list.length === 0) return
    const root = wrapper.querySelector('[data-component="markdown"]')
    if (!root) return
    const containers = Array.from(root.querySelectorAll(":scope > div[data-markdown-block]"))
    const scope: Element[] = containers.length > 0 ? containers : [root]
    const elements: HTMLElement[] = []
    for (const container of scope) {
      for (const child of Array.from(container.children)) {
        if (child instanceof HTMLElement && !child.hasAttribute("data-plan-comment-slot")) elements.push(child)
      }
    }
    if (elements.length === 0) return
    elements.forEach((el, i) => {
      const block = list[Math.min(i, list.length - 1)]!
      el.setAttribute("data-plan-block", String(i))
      el.setAttribute("data-source-start", String(block.start))
      el.setAttribute("data-source-end", String(block.end))
      const next = el.nextElementSibling
      if (next instanceof HTMLElement && next.hasAttribute("data-plan-comment-slot")) {
        next.setAttribute("data-plan-comment-slot", String(i))
        return
      }
      const slot = document.createElement("div")
      slot.setAttribute("data-plan-comment-slot", String(i))
      el.after(slot)
    })
    // Drop stale slots left behind if the block count shrank.
    Array.from(wrapper.querySelectorAll<HTMLElement>("[data-plan-comment-slot]")).forEach((slot) => {
      if (Number(slot.getAttribute("data-plan-comment-slot")) >= elements.length) slot.remove()
    })
    measureTops()
  }

  const [tops, setTops] = createSignal<number[]>([])
  const measureTops = () => {
    const elements = orderedBlockElements()
    if (elements.length === 0) return
    const offsetParent = wrapper?.offsetParent ?? null
    void offsetParent
    setTops(elements.map((el) => el.offsetTop))
  }

  createEffect(() => {
    blocks()
    contents()
    queueMicrotask(syncMarkdownDom)
  })

  createEffect(() => {
    if (!wrapper) return
    const observer = new MutationObserver(() => syncMarkdownDom())
    observer.observe(wrapper, { childList: true, subtree: true })
    const resize = new ResizeObserver(() => measureTops())
    resize.observe(wrapper)
    onCleanup(() => {
      observer.disconnect()
      resize.disconnect()
    })
  })

  // Highlight blocks intersecting the active selection or saved comments.
  createEffect(() => {
    const selection = activeSelection()
    const commented = commentedLines()
    blocks()
    for (const el of orderedBlockElements()) {
      const start = Number(el.getAttribute("data-source-start"))
      const end = Number(el.getAttribute("data-source-end"))
      if (!start || !end) continue
      const inSelection =
        !!selection && end >= Math.min(selection.start, selection.end) && start <= Math.max(selection.start, selection.end)
      const inComment =
        !inSelection &&
        commented.some(
          (range) => end >= Math.min(range.start, range.end) && start <= Math.max(range.start, range.end),
        )
      el.toggleAttribute("data-plan-selected", inSelection)
      el.toggleAttribute("data-plan-commented", inComment)
    }
  })

  // Mount comment/draft hosts into the slot following their block. The
  // controller owns host identity per comment/draft key, so re-appending moves
  // the same host instead of duplicating it.
  createEffect(() => {
    const annotations = commentsUi.annotations()
    if (!wrapper) return
    blocks()
    for (const slot of Array.from(wrapper.querySelectorAll<HTMLElement>("[data-plan-comment-slot]"))) {
      for (const child of Array.from(slot.children)) {
        if (child instanceof HTMLElement && child.innerHTML === "") child.remove()
      }
    }
    const list = blocks()
    for (const annotation of annotations) {
      const host = commentsUi.renderAnnotation(annotation)
      if (!(host instanceof HTMLElement)) continue
      const index = planBlockForLine(list, annotation.lineNumber)
      const slot = wrapper.querySelector(`[data-plan-comment-slot="${index < 0 ? 0 : index}"]`)
      if (slot && host.parentElement !== slot) slot.appendChild(host)
    }
  })

  createEffect(() => {
    const focus = comments.focus()
    const p = props.path
    if (!focus || !p || focus.file !== p) return
    const target = planComments().find((comment) => comment.id === focus.id)
    if (!target) return
    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    const line = Math.max(target.selection.start, target.selection.end)
    requestAnimationFrame(() => {
      const index = planBlockForLine(blocks(), line)
      const el = index >= 0 ? wrapper?.querySelector(`[data-plan-block="${index}"]`) : undefined
      if (el instanceof HTMLElement) el.scrollIntoView({ block: "center" })
      comments.clearFocus()
    })
  })

  const blockIndexFromPoint = (node: Node | null): number | null => {
    if (!(node instanceof Element)) node = node?.parentElement ?? null
    const el = (node as Element | null)?.closest?.("[data-plan-block]")
    if (!(el instanceof HTMLElement)) return null
    const index = Number(el.getAttribute("data-plan-block"))
    return Number.isInteger(index) ? index : null
  }

  const handleMouseUp = () => {
    if (!wrapper) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    if (!wrapper.contains(selection.anchorNode) && !wrapper.contains(selection.focusNode)) return
    const from = blockIndexFromPoint(selection.anchorNode)
    const to = blockIndexFromPoint(selection.focusNode)
    if (from === null || to === null) return
    const range = planRangeForBlocks(blocks(), from, to)
    if (!range) return
    if (selection.isCollapsed) {
      commentsUi.onLineSelected(range)
      return
    }
    commentsUi.onLineSelectionEnd(range)
  }

  const handleClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest("button, [data-plan-comment-slot], [data-prevent-autofocus]")) return
    if (!(target instanceof Node)) return
    if (window.getSelection() && !window.getSelection()?.isCollapsed) return
    const index = blockIndexFromPoint(target)
    if (index === null) {
      commentsUi.onLineSelected(null)
      return
    }
    const range = blockRange(index)
    commentsUi.onLineSelected(range)
  }

  const openDraftForBlock = (index: number) => (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const range = blockRange(index)
    if (range) commentsUi.onLineNumberSelectionEnd(range)
  }

  const restoreScroll = () => {
    const el = scroll
    if (!el) return
    const pos = view().scroll("plan")
    if (!pos) return
    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }
  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      view().setScroll("plan", { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop })
    })
  }
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  const selectedBlockIndexes = createMemo(() => {
    const selection = activeSelection()
    if (!selection) return []
    return planBlocksForRange(blocks(), selection)
  })

  return (
    <ScrollView
      class="h-full"
      viewportRef={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
    >
      <style>{`[data-plan-block][data-plan-selected]{box-shadow:inset 0 0 0 9999px var(--diffs-bg-selection);border-radius:var(--radius-md)}[data-plan-block][data-plan-commented]:not([data-plan-selected]){box-shadow:inset 0 0 0 9999px var(--diffs-bg-selection);border-radius:var(--radius-md)}[data-plan-gutter-btn]{opacity:0}[data-plan-block-wrap]:hover [data-plan-gutter-btn],[data-plan-gutter-btn]:focus-visible{opacity:1}`}</style>
      <Show
        when={contents()}
        fallback={
          <div class="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <div class="text-13-medium text-text-strong">{language.t("session.plan.empty.title")}</div>
            <div class="text-12-regular text-text-weak">{language.t("session.plan.empty.description")}</div>
          </div>
        }
      >
        <div
          data-plan-block-wrap=""
          ref={(el) => (wrapper = el)}
          class="relative select-text pb-40 pl-8 pr-4"
          onMouseUp={handleMouseUp}
          onClick={handleClick}
        >
          <Markdown text={contents()} cacheKey={cacheKey()} />
          <For each={blocks()}>
            {(block, i) => (
              <button
                type="button"
                data-plan-gutter-btn=""
                aria-label={language.t("ui.lineComment.submit")}
                class="absolute left-1 flex h-5 w-5 items-center justify-center rounded-md text-14-regular"
                style={{
                  top: `${(tops()[i()] ?? 0) + 2}px`,
                  background: selectedBlockIndexes().includes(i()) ? "var(--icon-interactive-base)" : "transparent",
                  color: selectedBlockIndexes().includes(i()) ? "var(--white)" : "var(--text-weak)",
                  border: "1px solid var(--border-weaker-base)",
                }}
                onClick={openDraftForBlock(i())}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                title={`${block.start}${block.start === block.end ? "" : `-${block.end}`}`}
              >
                +
              </button>
            )}
          </For>
        </div>
      </Show>
    </ScrollView>
  )
}
