import { createEffect, createMemo, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { useFileComponent } from "@opencode-ai/ui/context/file"
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
  const fileComponent = useFileComponent()
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

  createEffect(() => {
    const focus = comments.focus()
    const p = props.path
    if (!focus || !p || focus.file !== p) return
    const target = planComments().find((comment) => comment.id === focus.id)
    if (!target) return
    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    requestAnimationFrame(() => comments.clearFocus())
  })

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
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

  const renderPlan = (source: string) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: props.path ?? "plan.md",
          contents: source,
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        enableGutterUtility
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderGutterUtility={commentsUi.renderGutterUtility}
        onLineSelected={(range: SelectedLineRange | null) => commentsUi.onLineSelected(range)}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          if (!range) {
            commentsUi.note.select(null)
            commentsUi.note.cancelDraft()
            return
          }
          commentsUi.onLineSelectionEnd(range)
        }}
        onLineNumberSelectionEnd={(range: SelectedLineRange | null) => commentsUi.onLineNumberSelectionEnd(range)}
        class="select-text"
      />
    </div>
  )

  return (
    <ScrollView
      class="h-full"
      viewportRef={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
    >
      <Show
        when={contents()}
        fallback={
          <div class="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <div class="text-13-medium text-text-strong">{language.t("session.plan.empty.title")}</div>
            <div class="text-12-regular text-text-weak">{language.t("session.plan.empty.description")}</div>
          </div>
        }
      >
        {renderPlan(contents())}
      </Show>
    </ScrollView>
  )
}
