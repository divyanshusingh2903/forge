import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ForgePullRequests } from "@opencode/schema/forge-pull-requests"
import type { LinkPreviewResult } from "@opencode/client/promise"
import type { Reference } from "@opencode/session-ui/reference"
import { ReferenceCard } from "@opencode/session-ui/reference-card"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"

type Item = ForgePullRequests.Item

type Params = Record<string, string | number>

const REFRESH_MS = 15_000

/** Failing first, then running, then the rest. */
function rank(item: Item) {
  if (failing(item)) return 0

  if (running(item)) return 1

  return 2
}

function failing(item: Item) {
  return item.status?.ci?.status === "ok" && item.status.ci.failed > 0
}

// CI that has not finished, or whose counts stop short, is never shown as passing.
function running(item: Item) {
  const ci = item.status?.ci

  return ci?.status === "ok" && (ci.pending > 0 || !ci.complete)
}

/** The tracked pull and merge requests of a session: compact rows that expand into the full card. */
export default function PullRequestsPanel(props: {
  state: () => ForgePullRequests.State
  actions: {
    refresh: (key?: string) => Promise<void>
    track: (url: string) => Promise<"tracked" | "exists" | "unsupported" | undefined>
    untrack: (key: string) => Promise<void>
    autoFix: (key: string, enabled: boolean) => Promise<void>
  }
  t: (key: string, params?: Params) => string
  plural: (key: string, count: number, params?: Params) => string
}) {
  const [open, setOpen] = createStore<Record<string, boolean>>({})
  const [url, setUrl] = createSignal("")
  const [message, setMessage] = createSignal<string>()

  const groups = createMemo(() => {
    const items = props.state().items

    return {
      active: items.filter((item) => !ForgePullRequests.finished(item)).toSorted((a, b) => rank(a) - rank(b)),
      finished: items.filter(ForgePullRequests.finished),
    }
  })

  // Look again when the tab opens, then every few seconds while CI is running, and only while it stays open.
  onMount(() => {
    void props.actions.refresh()

    const timer = setInterval(() => {
      if (groups().active.some(running)) void props.actions.refresh()
    }, REFRESH_MS)

    onCleanup(() => clearInterval(timer))
  })

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const value = url().trim()

    if (!value) return
    setMessage(undefined)
    const outcome = await props.actions.track(value)

    if (outcome === "unsupported") return setMessage(props.t("track.unsupported"))

    if (outcome === "exists") setMessage(props.t("track.exists"))

    if (outcome) setUrl("")
  }

  return (
    <div data-component="pull-requests-panel" class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <form class="flex items-center gap-2" onSubmit={submit}>
        <input
          type="text"
          class="h-8 min-w-0 flex-1 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base placeholder:text-v2-text-text-muted"
          value={url()}
          placeholder={props.t("track.placeholder")}
          aria-label={props.t("track.placeholder")}
          onInput={(event) => setUrl(event.currentTarget.value)}
        />
        <Button type="submit" size="small" variant="neutral" disabled={url().trim() === ""}>
          {props.t("track.submit")}
        </Button>
      </form>
      <Show when={message()}>{(text) => <p role="status" class="text-[12px] text-v2-text-text-muted">{text()}</p>}</Show>

      <Show
        when={props.state().items.length > 0}
        fallback={
          <div class="flex flex-col gap-1 py-6 text-center">
            <p class="text-[13px] [font-weight:530] text-v2-text-text-base">{props.t("empty.title")}</p>
            <p class="text-[12px] text-v2-text-text-muted">{props.t("empty.description")}</p>
          </div>
        }
      >
        <p class="text-[12px] text-v2-text-text-muted">{props.plural("count", props.state().items.length)}</p>
        <ul class="flex flex-col gap-1">
          <For each={groups().active}>{(item) => <Row item={item} open={open} setOpen={setOpen} {...props} />}</For>
        </ul>
        <Show when={groups().finished.length > 0}>
          <details class="flex flex-col gap-1">
            <summary class="cursor-default text-[12px] [font-weight:530] text-v2-text-text-muted">
              {props.t("group.finished")} ({groups().finished.length})
            </summary>
            <ul class="mt-1 flex flex-col gap-1">
              <For each={groups().finished}>{(item) => <Row item={item} open={open} setOpen={setOpen} {...props} />}</For>
            </ul>
          </details>
        </Show>
      </Show>
    </div>
  )
}

function Row(props: {
  item: Item
  open: Record<string, boolean>
  setOpen: (key: string, value: boolean) => void
  actions: Parameters<typeof PullRequestsPanel>[0]["actions"]
  t: (key: string, params?: Params) => string
}) {
  const id = () => ForgePullRequests.key(props.item.identity)
  // A merged, closed or missing request has nothing left to fix, so it offers no auto-fix.
  const fixable = () => ForgePullRequests.canAutoFix(props.item)
  const expanded = () => props.open[id()] === true
  const status = () => props.item.status

  const label = () =>
    `${props.item.identity.repository}${props.item.identity.provider === "github" ? "#" : "!"}${props.item.identity.number}`

  const tone = () => {
    if (ForgePullRequests.finished(props.item)) return "muted"

    if (failing(props.item)) return "failing"

    if (running(props.item)) return "running"

    if (props.item.status?.ci?.status === "ok") return "passing"

    return "muted"
  }

  const summary = () => {
    const ci = status()?.ci

    if (!ci) return props.t("ci.unknown")

    if (ci.status === "none") return props.t("ci.none")

    if (ci.status !== "ok") return props.t("ci.unknown")

    if (ci.failed > 0) return props.t("ci.failing", { failed: ci.failed, total: ci.total })

    if (running(props.item)) return props.t("ci.running")

    return props.t("ci.passing")
  }

  const fixText = () => {
    const fix = props.item.autoFix

    if (!fix.enabled) return props.t("autofix.off")

    if (fix.state === "fixing")
      return props.t("autofix.fixing", { attempts: fix.attempts, max: ForgePullRequests.MAX_ATTEMPTS })

    if (fix.state === "paused") return props.t("autofix.paused")

    if (fix.state === "exhausted") return props.t("autofix.exhausted", { max: ForgePullRequests.MAX_ATTEMPTS })

    return props.t("autofix.idle")
  }

  // Copying has no visible effect of its own, so the button says "Copied" for a moment.
  const [copied, setCopied] = createSignal(false)
  const [timer, setTimer] = createSignal<ReturnType<typeof setTimeout>>()
  onCleanup(() => clearTimeout(timer()))

  const copy = () => {
    const clipboard = navigator.clipboard

    if (!clipboard) return
    void clipboard.writeText(props.item.url).then(
      () => {
        setCopied(true)
        clearTimeout(timer())
        setTimer(setTimeout(() => setCopied(false), 2000))
      },
      () => undefined,
    )
  }

  const time = (at: number) => new Date(at).toLocaleTimeString()

  const reference = (): Reference => ({
    kind: props.item.identity.provider === "github" ? "github-pr" : "gitlab-mr",
    repository: props.item.identity.repository,
    number: props.item.identity.number,
  })

  return (
    <li data-slot="pull-request-row" data-tone={tone()} class="rounded-[8px] border border-v2-border-border-muted">
      <button
        type="button"
        class="flex w-full cursor-default items-center gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-v2-background-bg-layer-01"
        aria-expanded={expanded()}
        aria-label={`${status()?.title ?? label()}, ${summary()}`}
        onClick={() => props.setOpen(id(), !expanded())}
      >
        <span
          aria-hidden="true"
          class="size-2 shrink-0 rounded-full"
          classList={{
            "bg-v2-state-fg-danger": tone() === "failing",
            "bg-v2-state-fg-warning": tone() === "running",
            "bg-v2-state-fg-success": tone() === "passing",
            "bg-v2-text-text-muted": tone() === "muted",
          }}
        />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-[13px] [font-weight:530] text-v2-text-text-base">{status()?.title ?? label()}</span>
          <span class="truncate text-[12px] text-v2-text-text-muted">
            {label()} · {summary()}
          </span>
        </span>
        <Show when={props.item.autoFix.enabled && fixable()}>
          <Icon name="outline-steer" size="small" aria-hidden="true" />
        </Show>
        <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" aria-hidden="true" />
      </button>

      <Show when={expanded()}>
        <div class="flex flex-col gap-2 border-t border-v2-border-border-muted px-2 py-2">
          <Show
            when={status()}
            fallback={<p class="text-[12px] text-v2-text-text-muted">{props.t("notChecked")}</p>}
          >
            {(result) => (
              <ReferenceCard
                reference={reference()}
                // SAFETY: the stored status differs from the card's result type only in readonly modifiers, and the card never writes it.
                result={result() as LinkPreviewResult}
                href={props.item.url}
                stale={props.item.failure !== undefined}
              />
            )}
          </Show>

          <p class="text-[12px] text-v2-text-text-muted">
            <Show when={props.item.failure} fallback={<>{props.item.checkedAt ? props.t("checked", { time: time(props.item.checkedAt) }) : props.t("notChecked")}</>}>
              {(failure) => (
                <>
                  {props.t("stale", { time: time(props.item.checkedAt ?? props.item.trackedAt) })} ·{" "}
                  {props.item.reason ? props.t(`reason.${props.item.reason}`) : props.t(`failure.${failure()}`)}
                </>
              )}
            </Show>
            {" · "}
            {props.t(`source.${props.item.source}`)}
          </p>

          <Show when={fixable()}>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={props.item.autoFix.enabled}
                title={props.t("autofix.hint")}
                class="flex cursor-default items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12px] [font-weight:530] text-v2-text-text-base hover:bg-v2-background-bg-layer-01"
                onClick={() => void props.actions.autoFix(id(), !props.item.autoFix.enabled)}
              >
                <span
                  aria-hidden="true"
                  class="relative h-4 w-7 rounded-full"
                  classList={{
                    "bg-v2-state-fg-success": props.item.autoFix.enabled,
                    "bg-v2-text-text-muted": !props.item.autoFix.enabled,
                  }}
                >
                  <span
                    class="absolute top-0.5 size-3 rounded-full bg-v2-background-bg-base"
                    classList={{ "left-0.5": !props.item.autoFix.enabled, "left-3.5": props.item.autoFix.enabled }}
                  />
                </span>
                {props.t("autofix.label")}
              </button>
              <span class="text-[12px] text-v2-text-text-muted">{fixText()}</span>
              <Show when={props.item.autoFix.state === "paused" || props.item.autoFix.state === "exhausted"}>
                <Button size="small" variant="ghost" onClick={() => void props.actions.autoFix(id(), true)}>
                  {props.item.autoFix.state === "paused" ? props.t("autofix.resume") : props.t("autofix.rearm")}
                </Button>
              </Show>
            </div>
          </Show>

          <div class="flex items-center gap-1">
            <Button size="small" variant="ghost" icon="refresh" onClick={() => void props.actions.refresh(id())}>
              {props.t("refresh")}
            </Button>
            <Button size="small" variant="ghost" icon={copied() ? "check" : "copy"} onClick={copy}>
              {copied() ? props.t("copied") : props.t("copy")}
            </Button>
            <Button size="small" variant="ghost" icon="close" onClick={() => void props.actions.untrack(id())}>
              {props.t("untrack")}
            </Button>
          </div>
        </div>
      </Show>
    </li>
  )
}
