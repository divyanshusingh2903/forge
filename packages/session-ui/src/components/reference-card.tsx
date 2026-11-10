import type { LinkPreviewResult } from "@opencode/client/promise"
import { useI18n } from "@opencode/ui/context/i18n"
import { createSignal, For, type JSXElement, Show } from "solid-js"
import { Donut } from "./reference-chart"
import { referenceLabel, type Reference } from "./reference"
import { compactNumber, initials, relativeTime, stateTone, visiblePriority } from "./reference-view"

const MAX_LABELS = 3

// The popup body for a resolved reference. It is purely presentational so stories can render it from fixtures.
export function ReferenceCard(props: {
  reference: Reference
  result: LinkPreviewResult
  // The item's own page, which makes the title a link.
  href?: string
  onRefresh?: () => void
  // The last refresh failed, so what shows may be out of date.
  stale?: boolean
}) {
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

    // A Notion page is placed by where it sits in the workspace, after its emoji.
    if (reference.kind === "notion-page")
      return [props.result.icon, props.result.path ?? referenceLabel(reference)].filter(Boolean).join(" ")

    if ("tag" in reference) return reference.repository

    if ("number" in reference) return referenceLabel(reference)
    const identifier = props.result.identifier ?? reference.id

    const owner =
      props.result.team ??
      props.result.project ??
      (reference.kind === "linear-project" ? i18n.t("ui.reference.project") : undefined)

    return owner ? `${identifier} · ${owner}` : identifier
  }

  // The timestamp that matters most for the item's current state.
  const timestamp = () => {
    const result = props.result

    if (result.state === "merged" && result.mergedAt)
      return i18n.t("ui.reference.merged", { when: when(result.mergedAt) ?? "" })

    if (kind() === "github-release" && result.publishedAt)
      return i18n.t("ui.reference.published", { when: when(result.publishedAt) ?? "" })

    if (result.closedAt && result.state !== "open" && result.state !== "draft")
      return i18n.t("ui.reference.closed", { when: when(result.closedAt) ?? "" })

    if (result.createdAt) return i18n.t("ui.reference.opened", { when: when(result.createdAt) ?? "" })

    if (result.updatedAt) return i18n.t("ui.reference.updated", { when: when(result.updatedAt) ?? "" })
  }

  const date = (value: string) =>
    new Date(value).toLocaleDateString(i18n.locale(), {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })

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
    ].filter((item): item is string => item !== false)

  return (
    <div data-component="reference-card" data-kind={kind()}>
      <div data-slot="reference-card-head">
        <span data-slot="reference-card-eyebrow">{eyebrow()}</span>
        <span data-slot="reference-card-head-end">
          <Show when={state()}>
            {(label) => (
              <span data-slot="reference-card-state" data-tone={stateTone(props.reference, props.result)}>
                {label()}
              </span>
            )}
          </Show>
          <Show when={props.onRefresh}>
            {(refresh) => (
              <button
                type="button"
                data-slot="reference-card-refresh"
                aria-label={i18n.t("ui.reference.refresh")}
                title={i18n.t("ui.reference.refresh")}
                onClick={refresh()}
              >
                <span aria-hidden="true">↻</span>
              </button>
            )}
          </Show>
        </span>
      </div>

      <Show when={props.href} fallback={<span data-slot="reference-card-title">{props.result.title}</span>}>
        {(href) => (
          <a data-slot="reference-card-title" href={href()} target="_blank" rel="noopener noreferrer">
            {props.result.title}
          </a>
        )}
      </Show>

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

      <Show when={props.result.summary}>
        {(summary) => <span data-slot="reference-card-summary">{summary()}</span>}
      </Show>

      <Show when={props.result.author || timestamp()}>
        <span data-slot="reference-card-meta">
          <Show when={props.result.author}>{(author) => <Avatar name={author().name} url={author().avatarUrl} />}</Show>
          <Show when={props.result.author}>
            {(author) => <span data-slot="reference-card-author">{author().name}</span>}
          </Show>
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

      <Show when={props.result.fields?.length}>
        <span data-slot="reference-card-facts">
          <For each={props.result.fields}>
            {(field) => (
              <span data-slot="reference-card-fact">
                {field.name}: {field.value}
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

      <Show when={props.result.progress}>{(progress) => <Progress progress={progress()} />}</Show>

      <Show when={props.result.ci}>{(ci) => <CiSummary ci={ci()} />}</Show>

      <Show when={props.stale}>
        <span data-slot="reference-card-stale" role="status">
          {i18n.t("ui.reference.stale")}
        </span>
      </Show>
    </div>
  )
}

// Linear and Jira facts. The project shows here only when the eyebrow names the team instead.
function linearMeta(result: LinkPreviewResult) {
  const priority = visiblePriority(result.priority)

  return [
    result.issueType ? { text: result.issueType } : undefined,
    priority ? { text: priority, priority: true } : undefined,
    result.assignee ? { text: result.assignee } : undefined,
    result.project && result.team ? { text: result.project } : undefined,
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

type Progress = NonNullable<LinkPreviewResult["progress"]>

type Ci = NonNullable<LinkPreviewResult["ci"]>

// Sub-issue progress. Only direct children are counted, and the card says so.
function Progress(props: { progress: Progress }) {
  const i18n = useI18n()

  const rows = () => [
    { key: "completed", glyph: "✓", value: props.progress.completed },
    { key: "cancelled", glyph: "∅", value: props.progress.cancelled },
    { key: "open", glyph: "○", value: props.progress.open },
  ]

  return (
    <section
      data-slot="reference-card-section"
      data-section="progress"
      aria-label={i18n.t("ui.reference.progress.label")}
    >
      <Show
        when={props.progress.status === "ok"}
        fallback={<span data-slot="reference-card-note">{i18n.t("ui.reference.progress.unavailable")}</span>}
      >
        <div data-slot="reference-card-chart">
          <Donut slices={rows().map((row) => ({ key: row.key, value: row.value }))} />
          <div data-slot="reference-card-chart-text">
            <span data-slot="reference-card-headline">
              {i18n.plural("ui.reference.progress.summary", props.progress.total, {
                completed: props.progress.completed,
                percent: Math.round((props.progress.completed / props.progress.total) * 100),
              })}
            </span>
            <span data-slot="reference-card-note">
              {i18n.t(props.progress.partial ? "ui.reference.progress.partial" : "ui.reference.progress.direct")}
            </span>
            <Legend rows={rows().map((row) => ({ ...row, label: i18n.t(`ui.reference.progress.${row.key}`) }))} />
          </div>
        </div>
      </Show>
    </section>
  )
}

// CI for the head revision. Zero failing is only shown as passing when nothing is still running or missing.
function CiSummary(props: { ci: Ci }) {
  const i18n = useI18n()

  const rows = () => [
    { key: "passed", glyph: "✓", value: props.ci.passed },
    { key: "failed", glyph: "✕", value: props.ci.failed },
    { key: "pending", glyph: "…", value: props.ci.pending },
    { key: "skipped", glyph: "–", value: props.ci.skipped },
    { key: "cancelled", glyph: "∅", value: props.ci.cancelled },
  ]

  const headline = () => {
    const ci = props.ci

    if (ci.failed > 0) return i18n.plural(`ui.reference.ci.failing.${ci.unit}`, ci.total, { failed: ci.failed })

    if (ci.pending > 0) return i18n.plural(`ui.reference.ci.running.${ci.unit}`, ci.total, { pending: ci.pending })

    return i18n.plural(`ui.reference.ci.passing.${ci.unit}`, ci.total)
  }

  return (
    <section data-slot="reference-card-section" data-section="ci" aria-label={i18n.t("ui.reference.ci.label")}>
      <Show when={props.ci.reason === "authentication" || props.ci.reason === "rate-limit"}>
        <span data-slot="reference-card-note">
          {i18n.t(props.ci.reason === "rate-limit" ? "ui.reference.rateLimit" : "ui.reference.authentication")}
        </span>
      </Show>
      <Show
        when={props.ci.status === "ok"}
        fallback={<span data-slot="reference-card-note">{i18n.t(`ui.reference.ci.${props.ci.status}`)}</span>}
      >
        <div data-slot="reference-card-chart">
          <Donut slices={rows().map((row) => ({ key: row.key, value: row.value }))} />
          <div data-slot="reference-card-chart-text">
            <span data-slot="reference-card-headline" data-failing={props.ci.failed > 0 ? "" : undefined}>
              {headline()}
            </span>
            <Show when={!props.ci.complete}>
              <span data-slot="reference-card-note">{i18n.t("ui.reference.ci.partial")}</span>
            </Show>
            <Legend rows={rows().map((row) => ({ ...row, label: i18n.t(`ui.reference.ci.${row.key}`) }))} />
          </div>
        </div>
        <Show when={props.ci.failures.length > 0}>
          <ul data-slot="reference-card-failures" aria-label={i18n.t("ui.reference.ci.failures")}>
            <For each={props.ci.failures}>
              {(failure) => (
                <li>
                  <Show when={failure.url} fallback={<span>{failure.name}</span>}>
                    {(url) => (
                      <a href={url()} target="_blank" rel="noopener noreferrer">
                        {failure.name}
                      </a>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  )
}

// Every entry is a glyph, a label and a count, so the legend reads the same without colour. Empty entries are left out.
function Legend(props: { rows: { key: string; glyph: string; label: string; value: number }[] }) {
  return (
    <ul data-slot="reference-card-legend">
      <For each={props.rows.filter((row) => row.value > 0)}>
        {(row) => (
          <li data-slice={row.key}>
            <span data-slot="reference-card-glyph" aria-hidden="true">
              {row.glyph}
            </span>
            {row.label} {row.value}
          </li>
        )}
      </For>
    </ul>
  )
}

const SKELETON_WIDTHS = [34, 78, 52, 64, 88, 46, 72]

const SKELETON_ROW = 22

// Stands in for the card while a refresh is under way, so what is on screen is never the old numbers. It is the
// card's own height, with as many bars as fit, so the popup neither shrinks nor leaves a gap.
export function ReferenceSkeleton(props: { height: number }) {
  const i18n = useI18n()
  const rows = () => Math.max(3, Math.round(props.height / SKELETON_ROW))

  return (
    <div
      data-component="reference-skeleton"
      role="status"
      aria-label={i18n.t("ui.reference.refreshing")}
      style={{ height: `${props.height}px` }}
    >
      <For each={Array.from({ length: rows() }, (_, index) => SKELETON_WIDTHS[index % SKELETON_WIDTHS.length])}>
        {(width) => <span data-bar style={{ width: `${width}%` }} />}
      </For>
    </div>
  )
}
