import type { ServerRef } from "@opencode/plugin/gui"
import type { TerminalModel } from "./model"
import type { TerminalQuoteTarget } from "./quote"
import type { TerminalRunConnection } from "./connection"

export type TerminalProps = {
  ptyID: string
  server: ServerRef
  ghostty: TerminalModel["ghostty"]
  quote?: TerminalQuoteTarget
  autoFocus?: boolean
  onAutoFocus?: () => void
  onSubmit?: () => void
  /** Publishes the mounted controller; withdrawn when its surface unmounts. */
  onConnection?: (value: TerminalRunConnection | undefined) => void
  /** The connection failed or closed; the pane shows why and stays until it unmounts. */
  onFailure?: () => void
  class?: string
}
