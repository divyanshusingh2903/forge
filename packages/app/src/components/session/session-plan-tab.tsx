import { createEffect, createMemo, Show } from "solid-js"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"

export function SessionPlanTab(props: { path?: string }) {
  const file = useFile()
  const language = useLanguage()

  createEffect(() => {
    const path = props.path
    if (!path) return
    void file.load(path)
  })

  const content = createMemo(() => {
    const path = props.path
    if (!path) return
    return file.get(path)?.content?.content
  })

  return (
    <ScrollView class="h-full">
      <Show
        when={content()}
        fallback={
          <div class="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <div class="text-13-medium text-text-strong">{language.t("session.plan.empty.title")}</div>
            <div class="text-12-regular text-text-weak">{language.t("session.plan.empty.description")}</div>
          </div>
        }
      >
        {(text) => (
          <div class="px-6 pt-4 pb-10">
            <Markdown text={text()} />
          </div>
        )}
      </Show>
    </ScrollView>
  )
}
