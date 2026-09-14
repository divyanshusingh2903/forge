import { createPromptProjectController } from "@/components/prompt-project-selector"
import { SessionHeaderQuickActions } from "@/components/session/session-header"
import { createEffect, createResource } from "solid-js"
import { createNewSessionDraftController } from "./new-session/new-session-draft-controller"
import { NewSessionView } from "./new-session/new-session-view"
import { createNewSessionWorkspaceController } from "./new-session/new-session-workspace-controller"
import { useNewSessionCommands } from "./new-session/use-new-session-commands"

/** The draft-only V2 session page. Submitting promotes the draft into a real session. */
export default function NewSessionPage() {
  const workspace = createNewSessionWorkspaceController()
  const draft = createNewSessionDraftController({
    worktree: workspace.selection.value,
    resetWorktree: workspace.selection.reset,
  })
  const project = createPromptProjectController({
    controls: draft.project.controls,
    onDone: draft.input.restoreFocus,
  })
  useNewSessionCommands({
    restoreFocus: draft.input.restoreFocus,
    project: {
      empty: project.empty,
      open: () => project.setOpen(true),
    },
  })
  createEffect(() => {
    if (!draft.prompt.ready()) return
    draft.input.restoreFocus()
  })
  const ready = Promise.resolve()
  const [suspendUntilPromptReady] = createResource(
    () => draft.prompt.readyPromise() ?? ready,
    (promise) => promise.then(() => true),
  )

  return (
    <div class="relative size-full overflow-hidden flex flex-col p-2">
      {suspendUntilPromptReady()}
      <div class="relative flex-1 min-h-0 flex flex-col bg-v2-background-bg-base rounded-[10px] overflow-hidden shadow-[var(--v2-elevation-raised)]">
        <div class="h-12 w-full shrink-0 flex items-center justify-end gap-2 px-3">
          <SessionHeaderQuickActions plan={false} review={false} terminal={false} />
        </div>
        <div class="flex-1 min-h-0 flex flex-col">
          <NewSessionView input={draft.input} project={project} workspace={workspace} />
        </div>
      </div>
    </div>
  )
}
