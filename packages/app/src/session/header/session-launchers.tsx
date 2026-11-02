import { For, Show, createMemo } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import type { SessionPanelMenuItem } from "@opencode/plugin/gui"
import { useCommand } from "@/shell/commands/command"
import { createSessionPanelMenu } from "@/runtime/plugin/panel-menu"

/** The side region's launchers that ask for a header button, such as Review, Browser and Terminal. */
export function SessionLaunchers() {
  const menu = createSessionPanelMenu()
  const items = createMemo(() => menu().filter((item) => item.header && item.icon))

  return (
    <For each={items()}>
      {(item) => <Launcher item={item} />}
    </For>
  )
}

function Launcher(props: { item: SessionPanelMenuItem }) {
  const command = useCommand()
  const keybind = createMemo(() => (props.item.keybind ? command.keybindParts(props.item.keybind) : []))

  return (
    <Tooltip
      value={
        <>
          {props.item.title}
          <Show when={keybind().length > 0}>
            <Keybind keys={keybind()} variant="neutral" />
          </Show>
        </>
      }
      placement="bottom"
      class="flex items-center"
    >
      <IconButton
        icon={<Icon name={props.item.icon ?? "plus"} />}
        variant="ghost-muted"
        size="small"
        onClick={() => props.item.run()}
        aria-label={props.item.title}
      />
    </Tooltip>
  )
}
