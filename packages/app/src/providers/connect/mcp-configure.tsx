import { Show, createResource, onCleanup } from "solid-js"
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
 * Signs an MCP server in without dynamic client registration, such as GitHub: with the GitHub CLI's login, an access
 * token sent as a Bearer header, or the client of a pre-registered OAuth app. All are stored as credentials, never in
 * config.
 */
const toastKey = {
  cli: "mcp.configure.toast.cli",
  token: "mcp.configure.toast.saved",
  oauth: "mcp.configure.toast.signingIn",
} as const

export function DialogMcpConfigure(props: { name: string; integrationID: string; directory: string }) {
  const dialog = useDialog()
  const data = useData()
  const sdk = useServerSDK()
  const platform = usePlatform()
  const language = useLanguage()

  const [form, setForm] = createStore({
    // SAFETY: this only widens the initial value to the modes the form can take; nothing is read from outside.
    mode: "cli" as "cli" | "token" | "oauth",
    token: "",
    clientID: "",
    clientSecret: "",
    // SAFETY: only widens the initial value to the optional message the store later holds.
    error: undefined as string | undefined,
    // stderr of the running `gh auth login`, which carries the one-time code and URL.
    output: "",
    // SAFETY: only widens the initial value to the optional attempt ID the store later holds.
    attemptID: undefined as string | undefined,
  })

  const location = () => ({ directory: props.directory })

  const [integration] = createResource(() =>
    sdk.api.integration
      .get({ integrationID: props.integrationID, location: location() })
      .then((response) => response.data),
  )

  const cliMethod = () => integration()?.methods.find((item) => item.type === "command")
  // Servers without a CLI sign-in open on the token tab once their methods load.
  const mode = () => (form.mode === "cli" && integration.state === "ready" && !cliMethod() ? "token" : form.mode)
  const code = () => form.output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0]
  const url = () => form.output.match(/https:\/\/\S+/)?.[0]

  // Closing the dialog stops a login still waiting for the browser.
  let closed = false
  onCleanup(() => {
    closed = true

    if (form.attemptID)
      void sdk.api.integration.command
        .cancel({ integrationID: props.integrationID, attemptID: form.attemptID, location: location() })
        .catch(() => undefined)
  })

  const signInWithCli = async () => {
    const method = cliMethod()

    if (method?.type !== "command") throw new Error(language.t("mcp.configure.cli.unavailable"))

    const started = await sdk.api.integration.command.connect({
      integrationID: props.integrationID,
      methodID: method.id,
      location: location(),
    })

    setForm({ attemptID: started.data.attemptID, output: "" })

    while (!closed) {
      await new Promise((resolve) => setTimeout(resolve, 500))

      const result = await sdk.api.integration.command.status({
        integrationID: props.integrationID,
        attemptID: started.data.attemptID,
        location: location(),
      })

      if (result.data.status === "pending") {
        setForm("output", result.data.message ?? "")
        continue
      }

      setForm("attemptID", undefined)

      if (result.data.status === "complete") return
      throw new Error(
        result.data.status === "failed" ? result.data.message : language.t("provider.connect.command.expired"),
      )
    }
  }

  const copyAndOpen = () => {
    const value = code()
    const link = url()

    if (value)
      void (platform.writeClipboardText?.(value) ?? navigator.clipboard.writeText(value)).catch(() => undefined)

    if (link) platform.openExternal(link)
  }

  const save = useMutation(() => ({
    mutationFn: async () => {
      if (mode() === "cli") {
        await signInWithCli()
        await sdk.api.experimental.mcp.connect({ server: props.name, location: location() })

        return
      }

      if (mode() === "token") {
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

      const clientSecret = form.clientSecret.trim()

      const attempt = await sdk.api.integration.oauth.connect({
        integrationID: props.integrationID,
        methodID: method.id,
        location: location(),
        answer: clientSecret
          ? { client_id: form.clientID.trim(), client_secret: clientSecret }
          : { client_id: form.clientID.trim() },
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
        title: language.t(toastKey[mode()], { name: mcpDisplayName(props.name) }),
      })
    },
    onError: (error) => {
      setForm({ attemptID: undefined, output: "" })

      if (closed) return
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    },
  }))

  const submit = (event: SubmitEvent) => {
    event.preventDefault()

    if (save.isPending) return

    if (mode() === "token" && !form.token.trim()) return setForm("error", language.t("mcp.configure.token.required"))

    if (mode() === "oauth" && !form.clientID.trim())
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
            value={mode()}
            onChange={(value) => {
              if (save.isPending) return

              if (value === "cli" || value === "token" || value === "oauth") setForm({ mode: value, error: undefined })
            }}
          >
            <Tabs.List>
              <Show when={cliMethod()}>
                <Tabs.Trigger value="cli">{language.t("mcp.configure.mode.cli")}</Tabs.Trigger>
              </Show>
              <Tabs.Trigger value="token">{language.t("mcp.configure.mode.token")}</Tabs.Trigger>
              <Tabs.Trigger value="oauth">{language.t("mcp.configure.mode.oauth")}</Tabs.Trigger>
            </Tabs.List>
          </Tabs>
          <Show when={mode() === "cli"}>
            <div class="flex flex-col gap-3">
              <span class="text-13-regular text-v2-text-text-muted">{language.t("mcp.configure.cli.description")}</span>
              <Show when={save.isPending}>
                <Show
                  when={code()}
                  fallback={
                    <span class="text-13-regular text-v2-text-text-muted">
                      {language.t("mcp.configure.cli.waiting")}
                    </span>
                  }
                >
                  {(value) => (
                    <div class="flex flex-col gap-2 rounded-md bg-v2-background-bg-layer-03 px-3 py-3">
                      <span class="text-12-regular text-v2-text-text-muted">
                        {language.t("mcp.configure.cli.code")}
                      </span>
                      <span class="font-mono text-[20px] leading-7 tracking-[2px] text-v2-text-text-base select-all">
                        {value()}
                      </span>
                      <div>
                        <Button type="button" variant="neutral" size="small" onClick={copyAndOpen}>
                          {language.t("mcp.configure.cli.open")}
                        </Button>
                      </div>
                    </div>
                  )}
                </Show>
              </Show>
            </div>
          </Show>
          <Show when={mode() === "token"}>
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
          </Show>
          <Show when={mode() === "oauth"}>
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
            <Button type="submit" variant="contrast" size="large" disabled={save.isPending || integration.loading}>
              {language.t(
                save.isPending
                  ? mode() === "cli"
                    ? "dialog.mcp.signingIn"
                    : "common.saving"
                  : mode() === "token"
                    ? "common.save"
                    : "dialog.mcp.signIn",
              )}
            </Button>
          </div>
        </form>
      </DialogBody>
    </Dialog>
  )
}
