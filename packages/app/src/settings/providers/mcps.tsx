import { Predicate } from "effect"
import { Component, For, Show, createEffect, createMemo, type JSX } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import { IconButton } from "@opencode/ui/icon-button"
import { McpIcon, isMcpIconName, mcpDisplayName } from "@opencode/ui/mcp-icon"
import { Switch } from "@opencode/ui/switch"
import { TruncatedText } from "@opencode/ui/truncated-text"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { manualSignIn, useMcpToggle } from "@/providers/connect/mcp"
import { DialogMcp } from "@/providers/connect/mcp-dialog"
import { DialogMcpConfigure } from "@/providers/connect/mcp-configure"
import { SettingsList } from "@/settings/list"
import "@/settings/settings.css"
import "@/shell/search-list.css"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

export const SettingsMcps: Component<{ directory?: string; headerAction?: JSX.Element }> = (props) => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const data = useData()
  const dialog = useDialog()
  // MCP connections are per Location, so read and toggle them where the active session runs, as the TUI does. The
  // names come from the default Location so this page lists only the servers available to all projects.
  const location = () => (props.directory ? { directory: props.directory } : data.location.default())
  const toggleMcp = useMcpToggle(() => props.directory)

  // The synced lists follow mcp.status.changed, so a finished sign-in shows up without a refetch.
  createEffect(() => {
    if (serverSdk.connection.status() !== "connected") return
    void data.location.mcp.server.sync(data.location.default()).catch(() => undefined)

    if (props.directory) void data.location.mcp.server.sync(location()).catch(() => undefined)
  })

  // Built-in servers lead, in name order, ahead of the ones from config.
  const mcps = createMemo(() => {
    const active = data.location.mcp.server.list(location())

    return (data.location.mcp.server.list(data.location.default()) ?? [])
      .map((server) => active?.find((item) => item.name === server.name) ?? server)
      .toSorted(
        (a, b) => Number(isMcpIconName(b.name)) - Number(isMcpIconName(a.name)) || a.name.localeCompare(b.name),
      )
  })

  const configure = (name: string, integrationID: string) =>
    dialog.show(() => (
      <DialogMcpConfigure name={name} integrationID={integrationID} directory={location().directory} />
    ))

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.mcps")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.mcps.description")}</span>
          </div>
          <div class="settings-tab-header-actions">{props.headerAction}</div>
        </div>
      </div>

      <div class="settings-tab-body">
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <span class="settings-extension-heading text-13-medium">
              {language.t("settings.extensions.availableAll")}
            </span>
            <span class="text-13-regular text-v2-text-text-muted">{language.t("settings.extensions.manageConfig")}</span>
          </div>
          <SettingsList variant="catalog">
            <For each={mcps()}>
              {(item) => {
                const busy = () => {
                  const target = toggleMcp.isPending ? toggleMcp.variables : undefined

                  return (Predicate.isString(target) ? target : target?.name) === item.name
                }

                // The dot shows the status, as in the MCPs dialog; the words stay for assistive technology.
                const label = () =>
                  item.status.status === "pending" ? undefined : language.t(statusLabels[item.status.status])

                const signIn = () => {
                  if (item.integrationID && manualSignIn.has(item.name)) return configure(item.name, item.integrationID)

                  if (!toggleMcp.isPending) toggleMcp.mutate(item.name)
                }

                return (
                  <div class="settings-extension-row settings-mcp-row" data-status={item.status.status}>
                    <div class="settings-extension-lead">
                      <span class="settings-mcp-status">
                        <span class="mcp-status-dot" data-status={item.status.status} aria-hidden="true" />
                      </span>
                      <McpIcon id={item.name} class="size-4 shrink-0 text-v2-icon-icon-base" />
                      <TruncatedText text={mcpDisplayName(item.name)} class="settings-extension-name" />
                    </div>
                    <div class="settings-extension-trailing">
                      <Show when={item.status.status === "failed"}>
                        <Button
                          size="small"
                          variant="ghost-muted"
                          class="mcp-status-action"
                          aria-label={language.t("dialog.mcp.error.viewLabel", { name: item.name })}
                          onClick={() =>
                            dialog.show(() => <DialogMcp directory={location().directory} server={item.name} />)
                          }
                        >
                          {language.t("dialog.mcp.error.view")}
                        </Button>
                      </Show>
                      <Show when={item.integrationID}>
                        {(integrationID) => (
                          <IconButton
                            icon="settings-gear"
                            variant="ghost"
                            size="small"
                            aria-label={language.t("mcp.configure.open", { name: item.name })}
                            onClick={() => configure(item.name, integrationID())}
                          />
                        )}
                      </Show>
                      <Show
                        when={item.status.status === "needs_auth" && item.integrationID}
                        fallback={
                          <Switch
                            checked={item.status.status !== "disabled"}
                            disabled={item.status.status === "pending" || busy()}
                            description={label()}
                            class="[&_[data-slot=switch-description]]:sr-only"
                            onChange={(enabled) => {
                              if (toggleMcp.isPending) return
                              toggleMcp.mutate({ name: item.name, enabled })
                            }}
                          >
                            <span class="sr-only">{item.name}</span>
                          </Switch>
                        }
                      >
                        <Button
                          size="small"
                          variant="ghost-muted"
                          class="mcp-status-action"
                          disabled={busy()}
                          aria-busy={busy()}
                          aria-label={language.t("dialog.mcp.signIn.open", { name: item.name })}
                          onClick={signIn}
                        >
                          {language.t(busy() ? "dialog.mcp.signingIn" : "dialog.mcp.signIn")}
                        </Button>
                      </Show>
                    </div>
                  </div>
                )
              }}
            </For>
          </SettingsList>
        </div>
      </div>
    </>
  )
}
