import { createMemo, createSignal, Show } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { writeClipboard } from "./clipboard"
import { parseReference } from "./reference"
import { formatToolResponse, previewToolResponse } from "./tool-response-text"

// With `href`, the card is one source of a multi-result response: the link is the header and the body can be collapsed.
export function ToolResponse(props: { output?: string; href?: string; title?: string; defaultOpen?: boolean }) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(props.defaultOpen ?? true)
  const text = createMemo(() => formatToolResponse(props.output))
  const [expanded, setExpanded] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  const preview = createMemo(() => previewToolResponse(text(), expanded()))

  const handleCopy = async () => {
    if (!(await writeClipboard(text()))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Show when={text().trim() || props.href}>
      <div data-component="tool-response" dir="ltr">
        <div data-slot="tool-response-header">
          <Show when={props.href} fallback={<span data-slot="tool-response-label">{i18n.t("ui.tool.response")}</span>}>
            {(href) => (
              <>
                <button
                  data-slot="tool-response-collapse"
                  type="button"
                  aria-expanded={open()}
                  aria-label={props.title ?? href()}
                  onClick={() => setOpen((value) => !value)}
                >
                  <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" />
                </button>
                <div data-slot="tool-response-source">
                  <a
                    data-slot="tool-response-link"
                    href={href()}
                    title={parseReference(href()) ? undefined : href()}
                    data-reference={parseReference(href()) ? "" : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {props.title ?? href()}
                  </a>
                </div>
              </>
            )}
          </Show>
          <div data-slot="tool-response-copy">
            <TooltipV2 value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")} placement="top">
              <IconButtonV2
                icon={<IconV2 name={copied() ? "check" : "outline-copy"} size="small" />}
                size="normal"
                variant="ghost-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCopy}
                aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
              />
            </TooltipV2>
          </div>
        </div>
        <Show when={open() && text().trim()}>
          <div
            data-slot="tool-response-scroll"
            data-scrollable
            tabIndex={0}
            role="region"
            aria-label={i18n.t("ui.scrollView.ariaLabel")}
          >
            <pre data-slot="tool-response-pre">
              <code>{preview().visible}</code>
            </pre>
          </div>
          <Show when={preview().truncated}>
            <button data-slot="tool-response-toggle" type="button" onClick={() => setExpanded((value) => !value)}>
              {expanded() ? i18n.t("ui.tool.response.showLess") : i18n.t("ui.tool.response.showAll")}
            </button>
          </Show>
        </Show>
      </div>
    </Show>
  )
}
