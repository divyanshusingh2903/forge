import type { ComponentProps } from "solid-js"
import { Keybind } from "@opencode/ui/keybind"
import { Menu } from "@opencode/ui/menu"
import { useLanguage } from "@/runtime/i18n/language"

/**
 * A session's options menu: Rename, Export and Delete, as on the session title and on sidebar sessions. While it is
 * open, R, E and D choose an item directly instead of only moving focus to it.
 */
export function SessionOptionsContent(
  props: {
    rename: () => void
    export: () => void
    delete: () => void
    /** Closes the menu after a letter chose an item, which keyboard selection does not do by itself. */
    close: () => void
  } & Pick<ComponentProps<typeof Menu.Content>, "class" | "style" | "onCloseAutoFocus">,
) {
  const language = useLanguage()
  const keys: Record<string, () => void> = { r: props.rename, e: props.export, d: props.delete }

  return (
    <Menu.Content
      class={props.class}
      style={props.style}
      onCloseAutoFocus={props.onCloseAutoFocus}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const run = keys[event.key.toLowerCase()]
        if (!run) return
        event.preventDefault()
        event.stopPropagation()
        props.close()
        run()
      }}
    >
      <Menu.Item onSelect={props.rename} shortcut={<Keybind keys={["R"]} variant="neutral" />}>
        {language.t("common.rename")}
      </Menu.Item>
      <Menu.Item onSelect={props.export} shortcut={<Keybind keys={["E"]} variant="neutral" />}>
        {language.t("common.export")}
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item onSelect={props.delete} shortcut={<Keybind keys={["D"]} variant="neutral" />}>
        {language.t("common.delete")}
      </Menu.Item>
    </Menu.Content>
  )
}
