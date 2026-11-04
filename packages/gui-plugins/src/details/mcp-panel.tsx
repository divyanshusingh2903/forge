import type { MountedSession } from "@opencode/plugin/gui"
import { ServiceBody, ServiceFooter, useMcp } from "./server-panel"

export type McpPanelProps = {
  session: MountedSession
  shown: boolean
  onClose: () => void
}

/** The session server's MCPs, as the header's MCP button lists them. */
export default function McpPanel(props: McpPanelProps) {
  const source = useMcp(
    {
      session: props.session,
      get directory() {
        return props.session.directory
      },
      get shown() {
        return props.shown
      },
      onClose: props.onClose,
    },
    props.onClose,
  )

  return (
    <div class="session-mcp-popover">
      <div class="session-service-pane" data-active data-service="mcp" aria-busy={source.loading}>
        <div class="session-service-scroll" data-scrollable>
          <div class="session-service-pane-content">
            <ServiceBody source={source}>
              <source.Body />
            </ServiceBody>
          </div>
        </div>
        <ServiceFooter source={source} />
      </div>
    </div>
  )
}
