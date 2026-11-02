import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { McpIcon, mcpDisplayName } from "@opencode/ui/mcp-icon"
import { Tabs } from "@opencode/ui/tabs"
import { TextField } from "@opencode/ui/text-field"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"

/**
 * Signs an MCP server in without dynamic client registration, such as GitHub: with an access token sent as a Bearer
 * header, or with the client of a pre-registered OAuth app. Both are stored as credentials, never in config.
 */
export function DialogMcpConfigure(props: { name: string; integrationID: string; directory: string }) {
  const dialog = useDialog()
  const data = useData()
  const sdk = useServerSDK()
  const platform = usePlatform()
  const language = useLanguage()

  const [form, setForm] = createStore({
    mode: "token" as "token" | "oauth",
    token: "",
    clientID: "",
    clientSecret: "",
    error: undefined as string | undefined,
  })

  const location = () => ({ directory: props.directory })

  const save = useMutation(() => ({
    mutationFn: async () => {
      if (form.mode === "token") {
        await sdk.api.integration.connect.key({
          integrationID: props.integrationID,
          key: form.token.trim(),
          location: location(),
        })
        // A disabled server ignores credential changes, so connect it with the new token.
        await sdk.api.experimental.mcp.connect({ server: props.name, location: location() })
        return
      }
      const integration = await sdk.api.integration.get({ integrationID: props.integrationID, location: location() })
      const method = integration.data?.methods.find((item) => item.type === "oauth" && !!item.form?.length)

      if (method?.type !== "oauth") throw new Error(language.t("mcp.configure.oauth.unavailable", { name: props.name }))
      // Connecting first leaves the server waiting for sign-in, so the finished login brings it online.
      await sdk.api.experimental.mcp.connect({ server: props.name, location: location() })
      const attempt = await sdk.api.integration.oauth.connect({
        integrationID: props.integrationID,
        methodID: method.id,
        location: location(),
        answer: {
          client_id: form.clientID.trim(),
          ...(form.clientSecret.trim() ? { client_secret: form.clientSecret.trim() } : {}),
        },
      })
      platform.openExternal(attempt.data.url)
    },
    onSuccess: () => {
      data.location.mcp.server.invalidate(location())
      void data.location.mcp.server.sync(location())
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t(
          form.mode === "token" ? "mcp.configure.toast.saved" : "mcp.configure.toast.signingIn",
          { name: mcpDisplayName(props.name) },
        ),
      })
    },
    onError: (error) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))

  const submit = (event: SubmitEvent) => {
    event.preventDefault()

    if (save.isPending) return

    if (form.mode === "token" && !form.token.trim())
      return setForm("error", language.t("mcp.configure.token.required"))

    if (form.mode === "oauth" && !form.clientID.trim())
      return setForm("error", language.t("mcp.configure.oauth.clientId.required"))
    setForm("error", undefined)
    save.mutate()
  }

  return (
    <Dialog fit containerClass="!w-[min(calc(100vw_-_32px),440px)]">
      <DialogHeader closeLabel={language.t("common.close")}>
        <div class="flex items-center gap-3">
          <McpIcon id={props.name} class="size-5 shrink-0 text-v2-icon-icon-base" />
          <DialogTitleGroup
            title={language.t("mcp.configure.title", { name: mcpDisplayName(props.name) })}
            description={language.t("mcp.configure.description")}
          />
        </div>
      </DialogHeader>
      <DialogBody>
        <form onSubmit={submit} class="flex flex-col gap-4 px-6 pb-5">
          <Tabs
            variant="pill"
            value={form.mode}
            onChange={(value) => {
              if (value === "token" || value === "oauth") setForm({ mode: value, error: undefined })
            }}
          >
            <Tabs.List>
              <Tabs.Trigger value="token">{language.t("mcp.configure.mode.token")}</Tabs.Trigger>
              <Tabs.Trigger value="oauth">{language.t("mcp.configure.mode.oauth")}</Tabs.Trigger>
            </Tabs.List>
          </Tabs>
          <Show
            when={form.mode === "oauth"}
            fallback={
              <TextField
                autofocus
                type="password"
                label={language.t("mcp.configure.token.label")}
                placeholder={language.t("mcp.configure.token.placeholder")}
                description={language.t("mcp.configure.token.description")}
                value={form.token}
                onChange={(value) => setForm("token", value)}
                validationState={form.error ? "invalid" : undefined}
                error={form.error}
              />
            }
          >
            <TextField
              autofocus
              label={language.t("mcp.configure.oauth.clientId.label")}
              placeholder={language.t("mcp.configure.oauth.clientId.placeholder")}
              value={form.clientID}
              onChange={(value) => setForm("clientID", value)}
              validationState={form.error ? "invalid" : undefined}
              error={form.error}
            />
            <TextField
              type="password"
              label={language.t("mcp.configure.oauth.clientSecret.label")}
              placeholder={language.t("mcp.configure.oauth.clientSecret.placeholder")}
              description={language.t("mcp.configure.oauth.clientSecret.description")}
              value={form.clientSecret}
              onChange={(value) => setForm("clientSecret", value)}
            />
          </Show>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button type="submit" variant="contrast" size="large" disabled={save.isPending}>
              {language.t(
                save.isPending ? "common.saving" : form.mode === "token" ? "common.save" : "dialog.mcp.signIn",
              )}
            </Button>
          </div>
        </form>
      </DialogBody>
    </Dialog>
  )
}
