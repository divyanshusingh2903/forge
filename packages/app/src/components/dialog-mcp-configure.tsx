import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { McpIcon } from "@opencode-ai/ui/mcp-icon"
import { TextField } from "@opencode-ai/ui/text-field"
import type { McpRemoteConfig } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@/utils/toast"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"

// Only github needs this dialog — its OAuth server doesn't support dynamic client
// registration, so it needs a manually-supplied token or a pre-registered OAuth App's
// client ID. Linear and Notion support a normal browser OAuth flow already.
//
// Must match packages/opencode/src/config/config.ts's builtinMcp — the client can't
// discover this dynamically since GET /global/config returns the raw file config,
// not the runtime config that has built-in defaults re-asserted.
const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/"

type Mode = "token" | "oauth"

export function McpConfigureForm(props: { name: string }) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const language = useLanguage()

  const [form, setForm] = createStore({
    mode: "token" as Mode,
    token: "",
    clientId: "",
    clientSecret: "",
    err: undefined as string | undefined,
  })

  const setMode = (mode: Mode) => {
    setForm("mode", mode)
    setForm("err", undefined)
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      const url = GITHUB_MCP_URL
      const patch: McpRemoteConfig =
        form.mode === "token"
          ? {
              type: "remote",
              url,
              enabled: true,
              oauth: false,
              headers: { Authorization: `Bearer ${form.token.trim()}` },
            }
          : {
              type: "remote",
              url,
              enabled: true,
              // Config updates are deep-merged, and an empty `headers` object is a no-op
              // against that merge — so blank out any token from a previous "Personal
              // access token" submission instead of leaving it stale.
              headers: { Authorization: "" },
              oauth: {
                clientId: form.clientId.trim(),
                ...(form.clientSecret.trim() ? { clientSecret: form.clientSecret.trim() } : {}),
              },
            }
      await serverSync().updateConfig({ mcp: { [props.name]: patch } })
    },
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("mcp.configure.toast.saved.title", { name: props.name }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return

    if (form.mode === "token" && !form.token.trim()) {
      setForm("err", language.t("mcp.configure.token.required"))
      return
    }
    if (form.mode === "oauth" && !form.clientId.trim()) {
      setForm("err", language.t("mcp.configure.oauth.clientId.required"))
      return
    }
    setForm("err", undefined)
    saveMutation.mutate()
  }

  return (
    <div class="flex flex-col gap-6 px-2.5 pb-3">
      <div class="px-2.5 flex gap-4 items-center">
        <McpIcon id={props.name} class="size-5 shrink-0" />
        <div class="text-16-medium text-text-strong">{language.t("mcp.configure.title", { name: props.name })}</div>
      </div>

      <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
        <div class="flex gap-2">
          <Button
            type="button"
            size="small"
            variant={form.mode === "token" ? "primary" : "secondary"}
            onClick={() => setMode("token")}
          >
            {language.t("mcp.configure.mode.token")}
          </Button>
          <Button
            type="button"
            size="small"
            variant={form.mode === "oauth" ? "primary" : "secondary"}
            onClick={() => setMode("oauth")}
          >
            {language.t("mcp.configure.mode.oauth")}
          </Button>
        </div>

        <Show when={form.mode === "token"}>
          <TextField
            autofocus
            label={language.t("mcp.configure.token.label")}
            placeholder={language.t("mcp.configure.token.placeholder")}
            description={language.t("mcp.configure.token.description")}
            value={form.token}
            onChange={(v) => setForm("token", v)}
            validationState={form.err ? "invalid" : undefined}
            error={form.err}
          />
        </Show>

        <Show when={form.mode === "oauth"}>
          <div class="flex flex-col gap-4">
            <TextField
              autofocus
              label={language.t("mcp.configure.oauth.clientId.label")}
              placeholder={language.t("mcp.configure.oauth.clientId.placeholder")}
              value={form.clientId}
              onChange={(v) => setForm("clientId", v)}
              validationState={form.err ? "invalid" : undefined}
              error={form.err}
            />
            <TextField
              label={language.t("mcp.configure.oauth.clientSecret.label")}
              placeholder={language.t("mcp.configure.oauth.clientSecret.placeholder")}
              description={language.t("mcp.configure.oauth.clientSecret.description")}
              value={form.clientSecret}
              onChange={(v) => setForm("clientSecret", v)}
            />
          </div>
        </Show>

        <Button
          class="w-auto self-start"
          type="submit"
          size="large"
          variant="primary"
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
        </Button>
      </form>
    </div>
  )
}

export function DialogMcpConfigure(props: { name: string }) {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog
      class="h-full"
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={() => dialog.close()}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <McpConfigureForm name={props.name} />
    </Dialog>
  )
}
