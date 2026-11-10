import { createMemo, For, Show } from "solid-js"
import { Option, Schema } from "effect"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { PermissionRequest } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Icon } from "@opencode/ui/icon"
import { useI18n } from "@opencode/ui/context/i18n"
import { browserPermissionSummary } from "@opencode/session-ui/tools/browser-call"
import { Keybind } from "@opencode/ui/keybind"
import { useLanguage } from "@/runtime/i18n/language"

const decodeMcp = Schema.decodeUnknownOption(Schema.Struct({ server: Schema.String, tool: Schema.String }))

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  const i18n = useI18n()
  const mcp = createMemo(() => Option.getOrUndefined(decodeMcp(props.request.metadata?.mcp)))

  // MCP's wildcard is a permission scope, not a useful description of the operation awaiting approval.
  const pattern = (resource: string) => {
    const call = mcp()

    if (call && resource === "*") return `${call.server}.${call.tool}`

    const summary =
      props.request.action === "browser" ? browserPermissionSummary(resource, props.request.metadata, i18n) : undefined

    return summary ? `${resource} ${summary}` : resource
  }

  const toolDescription = () => {
    const call = mcp()

    if (call) return language.t("permission.mcp.description", { server: call.server, tool: call.tool })

    const key = `settings.permissions.tool.${props.request.action}.description`
    // SAFETY: an action without a description key comes back unchanged from t(), which the check below catches.
    const value = language.t(key as Parameters<typeof language.t>[0])

    if (value === key) return ""

    return value
  }

  // Numbered in the order the buttons show, as in v1.
  const decisions = [
    { response: "reject", label: "ui.permission.deny", variant: "ghost" },
    { response: "always", label: "ui.permission.allowAlways", variant: "neutral" },
    { response: "once", label: "ui.permission.allowOnce", variant: "submit" },
  ] as const

  // Like the plan dock, number keys answer from anywhere but a text field, so the dock works without clicking into it.
  makeEventListener(window, "keydown", (event) => {
    if (props.responding || event.defaultPrevented || event.repeat || event.isComposing) return

    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return

    if (editable(event.target)) return

    const decision = /^[1-3]$/.test(event.key) ? decisions[Number(event.key) - 1] : undefined

    if (!decision) return

    event.preventDefault()
    props.onDecide(decision.response)
  })

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <For each={decisions}>
              {(decision, index) => (
                <Button
                  variant={decision.variant}
                  size="normal"
                  class="gap-2"
                  aria-keyshortcuts={String(index() + 1)}
                  onClick={() => props.onDecide(decision.response)}
                  disabled={props.responding}
                >
                  {language.t(decision.label)}
                  {/* The plan dock's number hint. The theme's fill vanishes on the light submit button, so there it is a
                      shade of the button's own text color. */}
                  <Keybind
                    keys={[String(index() + 1)]}
                    variant="neutral"
                    aria-hidden="true"
                    style={
                      decision.variant === "submit"
                        ? {
                            "--v2-background-bg-layer-03": "color-mix(in srgb, currentColor 14%, transparent)",
                            "--v2-text-text-muted": "color-mix(in srgb, currentColor 70%, transparent)",
                          }
                        : undefined
                    }
                  />
                </Button>
              )}
            </For>
          </div>
        </>
      }
    >
      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={props.request.resources.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.resources}>
              {(resource) => <code class="text-text-base break-all">{pattern(resource)}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}

function editable(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))
}
