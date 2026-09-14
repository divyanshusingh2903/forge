import { Show } from "solid-js"
import { createSignal } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@/utils/toast"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { ensurePlanActive } from "@/pages/session/plan-tab-activation"
import { useSessionLayout } from "@/pages/session/session-layout"

export function SessionInterruptedDock(props: {
  sessionID: string
  exists: boolean
  onRecovered?: () => void
}) {
  const language = useLanguage()
  const sdk = useSDK()
  const { view, tabs } = useSessionLayout()
  const [dismissed, setDismissed] = createSignal(false)

  const openPlan = () => {
    ensurePlanActive(view(), tabs())
  }

  const fail = (err: unknown) => {
    showToast({
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })
  }

  const recoverMutation = useMutation(() => ({
    mutationFn: () => sdk().client.session.planRecover({ sessionID: props.sessionID, body: {} }),
    onSuccess: () => {
      setDismissed(true)
      props.onRecovered?.()
    },
    onError: fail,
  }))

  const sending = () => recoverMutation.isPending
  const recover = () => {
    if (sending()) return
    void recoverMutation.mutateAsync()
  }

  return (
    <Show when={!dismissed()}>
      <div data-component="session-interrupted-dock">
        <DockPrompt
          kind="permission"
          header={
            <div data-slot="permission-row" data-variant="header">
              <span data-slot="permission-icon">
                <Icon name="bubble-5" size="normal" />
              </span>
              <div data-slot="permission-header-title">{language.t("session.plan.interrupted.title")}</div>
            </div>
          }
          footer={
            <>
              <div>
                <Show when={props.exists}>
                  <Button variant="ghost" size="normal" onClick={openPlan}>
                    {language.t("session.plan.openButton")}
                  </Button>
                </Show>
              </div>
              <div data-slot="permission-footer-actions">
                <Button variant="ghost" size="normal" disabled={sending()} onClick={() => setDismissed(true)}>
                  {language.t("session.plan.dismiss")}
                </Button>
                <Button variant="primary" size="normal" disabled={sending()} onClick={recover}>
                  {language.t("session.plan.recover")}
                </Button>
              </div>
            </>
          }
        >
          <div data-slot="question-text">
            {props.exists
              ? language.t("session.plan.interrupted.withPlan")
              : language.t("session.plan.interrupted.noPlan")}
          </div>
        </DockPrompt>
      </div>
    </Show>
  )
}
