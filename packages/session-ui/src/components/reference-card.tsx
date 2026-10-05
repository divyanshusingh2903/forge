import type { LinkPreviewResult } from "@opencode-ai/sdk/v2"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { createSignal, For, type JSXElement, Show } from "solid-js"
import type { Reference } from "./reference"
import { compactNumber, initials, relativeTime, stateTone, visiblePriority } from "./reference-view"

const MAX_LABELS = 3

// The popup body for a resolved reference. It is purely presentational so stories can render it from fixtures.
export function ReferenceCard(props: { reference: Reference; result: LinkPreviewResult }) {
  const i18n = useI18n()
  const when = (iso: string | undefined) => relativeTime(iso, i18n.locale())
  const kind = () => props.reference.kind

  const state = () => {
    const value = props.result.state
    if (!value) return
    if (value === "open") return i18n.t("ui.reference.state.open")
    if (value === "closed") return i18n.t("ui.reference.state.closed")
    if (value === "merged") return i18n.t("ui.reference.state.merged")
    if (value === "draft") return i18n.t("ui.reference.state.draft")
    if (value === "not-planned") return i18n.t("ui.reference.state.notPlanned")
    if (value === "release") return i18n.t("ui.reference.state.release")
    if (value === "prerelease") return i18n.t("ui.reference.state.prerelease")
    // Linear workflow status names are shown as the workspace spells them.
    return value
  }

  const eyebrow = () => {
    const reference = props.reference
    if ("tag" in reference) return `${reference.owner}/${reference.repo}`
    if ("owner" in reference) return `${reference.owner}/${reference.repo} #${reference.number}`
    const identifier = props.result.identifier ?? reference.id
    const owner = props.result.team ?? (reference.kind === "linear-project" ? i18n.t("ui.reference.project") : undefined)
    return owner ? `${identifier} · ${owner}` : identifier
  }

  // The timestamp that matters most for the item's current state.
  const timestamp = () => {
    const result = props.result
    if (kind() === "github-pr" && result.state === "merged" && result.mergedAt)
      return i18n.t("ui.reference.merged", { when: when(result.mergedAt) ?? "" })
    if (kind() === "github-release" && result.publishedAt)
      return i18n.t("ui.reference.published", { when: when(result.publishedAt) ?? "" })
    if (result.closedAt && result.state !== "open" && result.state !== "draft")
      return i18n.t("ui.reference.closed", { when: when(result.closedAt) ?? "" })
    if (result.createdAt) return i18n.t("ui.reference.opened", { when: when(result.createdAt) ?? "" })
    if (result.updatedAt) return i18n.t("ui.reference.updated", { when: when(result.updatedAt) ?? "" })
  }

  const date = (value: string) =>
    new Date(value).toLocaleDateString(i18n.locale(), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })

  const schedule = () => {
    const parts = [
      props.result.startDate && i18n.t("ui.reference.startsOn", { date: date(props.result.startDate) }),
      props.result.targetDate && i18n.t("ui.reference.targetOn", { date: date(props.result.targetDate) }),
    ]
    return parts.filter(Boolean).join(" → ")
  }

  const stats = () =>
    [
      props.result.comments !== undefined &&
        props.result.comments > 0 &&
        i18n.plural("ui.reference.comments", props.result.comments),
      props.result.changedFiles !== undefined && i18n.plural("ui.reference.files", props.result.changedFiles),
      props.result.assets !== undefined && i18n.plural("ui.reference.assets", props.result.assets),
      props.result.downloads !== undefined &&
        props.result.downloads > 0 &&
        i18n.plural("ui.reference.downloads", props.result.downloads, {
          count: compactNumber(props.result.downloads, i18n.locale()),
        }),
    ].filter((item): item is string => typeof item === "string")

  return (
    <div data-component="reference-card" data-kind={kind()}>
      <div data-slot="reference-card-head">
        <span data-slot="reference-card-eyebrow">{eyebrow()}</span>
        <Show when={state()}>
          {(label) => (
            <span data-slot="reference-card-state" data-tone={stateTone(props.reference, props.result)}>
              {label()}
            </span>
          )}
        </Show>
      </div>

      <span data-slot="reference-card-title">{props.result.title}</span>

      <Show when={props.result.tag}>{(tag) => <code data-slot="reference-card-tag">{tag()}</code>}</Show>

      <Show when={props.result.head && props.result.base}>
        <span data-slot="reference-card-branches">
          <code>{props.result.head}</code>
          <span aria-hidden="true">→</span>
          <code>{props.result.base}</code>
          <Show when={props.result.additions !== undefined || props.result.deletions !== undefined}>
            <span data-slot="reference-card-diff">
              <span data-diff="add">+{props.result.additions ?? 0}</span>
              <span data-diff="del">−{props.result.deletions ?? 0}</span>
            </span>
          </Show>
        </span>
      </Show>

      <Show when={props.result.summary}>{(summary) => <span data-slot="reference-card-summary">{summary()}</span>}</Show>

      <Show when={props.result.author || timestamp()}>
        <span data-slot="reference-card-meta">
          <Show when={props.result.author}>{(author) => <Avatar name={author().name} url={author().avatarUrl} />}</Show>
          <Show when={props.result.author}>{(author) => <span data-slot="reference-card-author">{author().name}</span>}</Show>
          <Show when={timestamp()}>{(text) => <span>{text()}</span>}</Show>
        </span>
      </Show>

      <Show when={linearMeta(props.result).length > 0}>
        <span data-slot="reference-card-facts">
          <For each={linearMeta(props.result)}>
            {(item) => (
              <span data-slot="reference-card-fact" data-priority={item.priority ? "" : undefined}>
                {item.text}
              </span>
            )}
          </For>
        </span>
      </Show>

      <Show when={schedule()}>
        <span data-slot="reference-card-meta">{schedule()}</span>
      </Show>

      <Show when={props.result.labels?.length || props.result.initiatives?.length}>
        <span data-slot="reference-card-labels">
          <For each={props.result.labels?.slice(0, MAX_LABELS)}>
            {(label) => <Chip text={label.name} color={label.color} />}
          </For>
          <For each={props.result.initiatives}>{(name) => <Chip text={name} />}</For>
        </span>
      </Show>

      <Show when={stats().length > 0}>
        <span data-slot="reference-card-stats">{stats().join(" · ")}</span>
      </Show>
    </div>
  )
}

function linearMeta(result: LinkPreviewResult) {
  const priority = visiblePriority(result.priority)
  return [
    priority ? { text: priority, priority: true } : undefined,
    result.assignee ? { text: result.assignee } : undefined,
    result.project ? { text: result.project } : undefined,
  ].filter((item): item is { text: string; priority?: boolean } => !!item)
}

function Avatar(props: { name: string; url?: string }): JSXElement {
  const [failed, setFailed] = createSignal(false)
  return (
    <Show
      when={props.url && !failed()}
      fallback={
        <span data-slot="reference-card-avatar" data-fallback aria-hidden="true">
          {initials(props.name)}
        </span>
      }
    >
      <img
        data-slot="reference-card-avatar"
        src={props.url}
        alt=""
        width="16"
        height="16"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </Show>
  )
}

function Chip(props: { text: string; color?: string }) {
  return (
    <span data-slot="reference-card-chip">
      <Show when={props.color}>
        <span data-slot="reference-card-chip-dot" style={{ background: `#${props.color}` }} />
      </Show>
      {props.text}
    </span>
  )
}
