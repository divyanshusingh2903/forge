import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionBrowserCommand } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import type { BrowserTab } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"

const LEASE_RENEW_INTERVAL_MS = 10_000
const MAX_CONTENT_BYTES = 5 * 1024 * 1024
// Chromium reports a superseded navigation (redirect, new load) as a failed load with this code.
const ERR_ABORTED = -3

type WebviewElement = HTMLElement & {
  src: string
  partition: string
  loadURL: (url: string) => Promise<void>
  reload: () => void
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  getTitle: () => string
  executeJavaScript: <T>(code: string, userGesture?: boolean) => Promise<T>
}

type TabRuntimeState = {
  ready: boolean
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type BrowserResult = {
  ok: boolean
  error?: string
  tabID?: string
  url?: string
  title?: string
  html?: string
  text?: string
}

export function normalizeBrowserUrl(raw: string): string | undefined {
  const value = raw.trim()
  if (!value) return
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const parsed = URL.parse(value)
    return parsed && (parsed.protocol === "http:" || parsed.protocol === "https:") ? parsed.toString() : undefined
  }
  const isLocal =
    /^localhost(?::\d+)?(?:\/|$)/i.test(value) ||
    /^127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(value) ||
    /^\[::1\](?::\d+)?(?:\/|$)/.test(value)
  const parsed = URL.parse(`${isLocal ? "http" : "https"}://${value}`)
  return parsed && (parsed.protocol === "http:" || parsed.protocol === "https:") ? parsed.toString() : undefined
}

export function truncateToMaxBytes(input: string | undefined, maxBytes = MAX_CONTENT_BYTES): string | undefined {
  if (!input) return input
  const encoded = new TextEncoder().encode(input)
  if (encoded.byteLength <= maxBytes) return input
  // Back up to a UTF-8 character boundary so decoding cannot add a replacement character past the limit.
  let end = maxBytes
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--
  return new TextDecoder().decode(encoded.subarray(0, end))
}

function isHttpUrl(url: string | undefined): url is string {
  return !!url && (url.startsWith("http://") || url.startsWith("https://"))
}

function formatTabLabel(tab: BrowserTab, newTabLabel: string): string {
  if (tab.title?.trim()) return tab.title.trim()
  if (!tab.url) return newTabLabel
  const parsed = URL.parse(tab.url)
  if (parsed?.host) return parsed.host + (parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "")
  return tab.url
}

export function SessionBrowserPanel(props: { stacked?: boolean } = {}) {
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useSDK()
  const settings = useSettings()
  const sync = useSync()
  const { params, view } = useSessionLayout()

  const isDesktopApp = () => platform.platform === "desktop"
  const newLayout = createMemo(() => settings.general.newLayoutDesigns())
  const sessionID = createMemo(() => params.id)
  const tabs = createMemo(() => view().browser.tabs())
  // Webviews are keyed by tab ID: URL and title updates replace the tab objects, and keying by object would
  // destroy and recreate the webview (cancelling its in-flight load) on every update.
  const tabIds = createMemo(() => tabs().map((tab) => tab.id), [], {
    equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
  })
  const activeTabId = createMemo(() => view().browser.activeTabId())
  const activeTab = createMemo(() => view().browser.activeTab())
  const storedUrl = createMemo(() => activeTab().url ?? "")
  const storedTitle = createMemo(() => activeTab().title)

  const [inputValue, setInputValue] = createSignal(storedUrl())
  const [inputFocused, setInputFocused] = createSignal(false)
  const [runtime, setRuntime] = createStore<Record<string, TabRuntimeState | undefined>>({})

  // Each mounted panel holds its own lease so one window closing its panel does not detach another.
  const clientID = crypto.randomUUID()
  const webviewRefs = new Map<string, WebviewElement>()
  // Per tab: the URL waiting for the webview to become ready, the agent request awaiting the current load,
  // and callbacks waiting for the tab to finish loading.
  const pendingTargetUrl = new Map<string, string>()
  const pendingNavigation = new Map<string, { requestID: string; sessionID: string }>()
  const idleWaiters = new Map<string, Array<() => void>>()
  let urlInputRef: HTMLInputElement | undefined

  const activeRuntime = createMemo(() => runtime[activeTabId()])
  const canGoBack = createMemo(() => Boolean(activeRuntime()?.canGoBack))
  const canGoForward = createMemo(() => Boolean(activeRuntime()?.canGoForward))
  const loading = createMemo(() => Boolean(activeRuntime()?.loading))

  const ensureTabRuntime = (tabId: string) => {
    if (runtime[tabId]) return
    setRuntime(tabId, { ready: false, loading: false, canGoBack: false, canGoForward: false })
  }

  createEffect(() => {
    const url = storedUrl()
    if (!inputFocused()) setInputValue(url)
  })

  // Attach lease lifecycle on desktop when a session is active.
  createEffect(
    on(
      () => [isDesktopApp(), sessionID(), sdk().directory] as const,
      ([desktop, id, directory]) => {
        if (!desktop || !id) return
        const postAttach = (attached: boolean) => {
          void sdk()
            .client.session.browserAttach({ sessionID: id, directory, clientID, attached })
            .catch(() => undefined)
        }
        postAttach(true)
        const timer = window.setInterval(() => postAttach(true), LEASE_RENEW_INTERVAL_MS)
        onCleanup(() => {
          window.clearInterval(timer)
          postAttach(false)
        })
      },
    ),
  )

  // Keep the server's tab list (URL and title only) in sync so the agent can target tabs.
  createEffect(() => {
    const id = sessionID()
    if (!id) return
    const state = {
      sessionID: id,
      directory: sdk().directory,
      activeTabID: activeTabId(),
      tabs: tabs()
        .filter((tab) => isHttpUrl(tab.url))
        .map((tab) => ({ tabID: tab.id, url: tab.url, title: tab.title })),
    }
    void untrack(() => sdk().client.session.browserUpdate(state)).catch(() => undefined)
  })

  // Run agent commands once: clear them from the store before running so a remount never replays them.
  createEffect(() => {
    const id = sessionID()
    const pending = id ? sync().data.browser[id]?.command : undefined
    if (!id || !pending || !isDesktopApp()) return
    untrack(() => {
      sync().set("browser", id, "command", undefined)
      if (pending.expiresAt < Date.now()) return
      void runCommand(id, pending.requestID, pending.command, pending.tabID).catch((error: unknown) =>
        reply(id, pending.requestID, { ok: false, error: error instanceof Error ? error.message : String(error) }),
      )
    })
  })

  const reply = (id: string, requestID: string, result: BrowserResult) =>
    sdk()
      .client.session.browserResult({ sessionID: id, directory: sdk().directory, requestID, ...result })
      .catch(() => undefined)

  const runCommand = async (id: string, requestID: string, command: SessionBrowserCommand, tabID?: string) => {
    if (command.type === "read") {
      const tabId = tabID ?? activeTabId()
      if (!tabs().some((tab) => tab.id === tabId)) return reply(id, requestID, { ok: false, error: `Tab "${tabId}" is not open` })
      await whenIdle(tabId)
      const el = webviewRefs.get(tabId)
      if (!el) return reply(id, requestID, { ok: false, error: `Tab "${tabId}" is not loaded` })
      const page = await el.executeJavaScript<{ url: string; title: string; content: string }>(
        command.format === "text"
          ? `({ url: location.href, title: document.title, content: document.body ? document.body.innerText : "" })`
          : `({ url: location.href, title: document.title, content: document.documentElement ? document.documentElement.outerHTML : "" })`,
      )
      const content = truncateToMaxBytes(page.content)
      return reply(id, requestID, {
        ok: true,
        tabID: tabId,
        url: page.url,
        title: page.title || undefined,
        ...(command.format === "text" ? { text: content } : { html: content }),
      })
    }

    if (command.action === "goto") {
      const url = command.url ? normalizeBrowserUrl(command.url) : undefined
      if (!url) return reply(id, requestID, { ok: false, error: "Invalid URL" })
      const tabId = resolveGotoTab(url, tabID, command.newTab)
      view().browser.setActiveTab(tabId)
      return navigateTab(tabId, url, { requestID, sessionID: id })
    }

    const tabId = tabID ?? activeTabId()
    view().browser.setActiveTab(tabId)
    await whenIdle(tabId)
    const el = webviewRefs.get(tabId)
    if (!el) return reply(id, requestID, { ok: false, error: `Tab "${tabId}" is not loaded` })
    if (command.action === "back" && !el.canGoBack()) return reply(id, requestID, { ok: false, error: "Cannot go back" })
    if (command.action === "forward" && !el.canGoForward()) {
      return reply(id, requestID, { ok: false, error: "Cannot go forward" })
    }
    pendingNavigation.set(tabId, { requestID, sessionID: id })
    if (command.action === "back") return el.goBack()
    if (command.action === "forward") return el.goForward()
    el.reload()
  }

  // Prefer a tab already on this URL or origin, then an empty tab, so the agent leaves unrelated tabs alone.
  const resolveGotoTab = (url: string, tabID: string | undefined, newTab: boolean | undefined) => {
    const open = tabs()
    if (tabID && open.some((tab) => tab.id === tabID)) return tabID
    if (newTab) return view().browser.addTab("")
    const exact = open.find((tab) => tab.url === url)
    if (exact) return exact.id
    const origin = URL.parse(url)?.origin
    const sameOrigin =
      [activeTab(), ...open].find((tab) => tab.url && URL.parse(tab.url)?.origin === origin) ??
      [activeTab(), ...open].find((tab) => !tab.url)
    return sameOrigin?.id ?? view().browser.addTab("")
  }

  const whenIdle = (tabId: string) =>
    new Promise<void>((resolve) => {
      const state = runtime[tabId]
      if (state?.ready && !state.loading) return resolve()
      idleWaiters.set(tabId, [...(idleWaiters.get(tabId) ?? []), resolve])
    })

  const flushIdle = (tabId: string) => {
    const waiters = idleWaiters.get(tabId)
    idleWaiters.delete(tabId)
    waiters?.forEach((resolve) => resolve())
  }

  const syncHistoryState = (tabId: string) => {
    const el = webviewRefs.get(tabId)
    if (!el || !runtime[tabId]?.ready) return
    setRuntime(tabId, "canGoBack", el.canGoBack())
    setRuntime(tabId, "canGoForward", el.canGoForward())
  }

  const navigateTab = (tabId: string, url: string, request?: { requestID: string; sessionID: string }) => {
    ensureTabRuntime(tabId)
    view().browser.setUrl(url, tabId)
    if (tabId === activeTabId()) setInputValue(url)
    pendingTargetUrl.set(tabId, url)
    if (request) pendingNavigation.set(tabId, request)
    if (!isDesktopApp()) return
    const el = webviewRefs.get(tabId)
    if (!el || !runtime[tabId]?.ready) return
    void el.loadURL(url).catch(() => undefined)
  }

  const bindWebview = (tabId: string, el: HTMLElement) => {
    const webview = el as WebviewElement
    ensureTabRuntime(tabId)
    webviewRefs.set(tabId, webview)

    const onDomReady = () => {
      setRuntime(tabId, "ready", true)
      syncHistoryState(tabId)
      const target = pendingTargetUrl.get(tabId) || tabs().find((item) => item.id === tabId)?.url
      const current = webview.getURL()
      if (target && (!current || current === "about:blank")) {
        pendingTargetUrl.set(tabId, target)
        void webview.loadURL(target).catch(() => undefined)
        return
      }
      if (!runtime[tabId]?.loading) flushIdle(tabId)
    }

    const onStartLoading = () => setRuntime(tabId, "loading", true)

    const onNavigate = (event: Event & { url?: string }) => {
      if (isHttpUrl(event.url)) {
        view().browser.setUrl(event.url, tabId)
        if (tabId === activeTabId() && !inputFocused()) setInputValue(event.url)
      }
      syncHistoryState(tabId)
    }

    const onTitleUpdated = (event: Event & { title?: string }) => {
      if (event.title !== undefined) view().browser.setTitle(event.title, tabId)
    }

    const onStopLoading = () => {
      const url = webview.getURL()
      // The initial about:blank load finishes after the real target has been requested; wait for the target.
      if (url === "about:blank" && pendingTargetUrl.has(tabId)) return
      setRuntime(tabId, "loading", false)
      syncHistoryState(tabId)
      pendingTargetUrl.delete(tabId)
      const request = pendingNavigation.get(tabId)
      pendingNavigation.delete(tabId)
      if (request) void reply(request.sessionID, request.requestID, { ok: true, tabID: tabId, url, title: webview.getTitle() || undefined })
      flushIdle(tabId)
    }

    const onFailLoad = (event: Event & { isMainFrame?: boolean; errorCode?: number; validatedURL?: string; errorDescription?: string }) => {
      if (event.isMainFrame === false || event.errorCode === ERR_ABORTED) return
      setRuntime(tabId, "loading", false)
      syncHistoryState(tabId)
      pendingTargetUrl.delete(tabId)
      const request = pendingNavigation.get(tabId)
      pendingNavigation.delete(tabId)
      if (request) {
        void reply(request.sessionID, request.requestID, {
          ok: false,
          tabID: tabId,
          error: `Failed to load ${event.validatedURL ?? "page"}: ${event.errorDescription ?? `error ${event.errorCode}`}`,
        })
      }
      flushIdle(tabId)
    }

    webview.addEventListener("dom-ready", onDomReady)
    webview.addEventListener("did-start-loading", onStartLoading)
    webview.addEventListener("did-navigate", onNavigate)
    webview.addEventListener("did-navigate-in-page", onNavigate)
    webview.addEventListener("page-title-updated", onTitleUpdated)
    webview.addEventListener("did-stop-loading", onStopLoading)
    webview.addEventListener("did-fail-load", onFailLoad)

    onCleanup(() => {
      webview.removeEventListener("dom-ready", onDomReady)
      webview.removeEventListener("did-start-loading", onStartLoading)
      webview.removeEventListener("did-navigate", onNavigate)
      webview.removeEventListener("did-navigate-in-page", onNavigate)
      webview.removeEventListener("page-title-updated", onTitleUpdated)
      webview.removeEventListener("did-stop-loading", onStopLoading)
      webview.removeEventListener("did-fail-load", onFailLoad)
      if (webviewRefs.get(tabId) === webview) webviewRefs.delete(tabId)
      const request = pendingNavigation.get(tabId)
      if (request) void reply(request.sessionID, request.requestID, { ok: false, tabID: tabId, error: "The tab was closed" })
      pendingNavigation.delete(tabId)
      pendingTargetUrl.delete(tabId)
      // Release waiters; they find no webview and report the tab as not loaded.
      flushIdle(tabId)
      setRuntime(tabId, undefined)
    })
  }

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault()
    const normalized = normalizeBrowserUrl(inputValue())
    if (!normalized) return
    navigateTab(activeTabId(), normalized)
  }

  const handleAddTab = () => {
    view().browser.addTab("")
    setInputValue("")
    requestAnimationFrame(() => urlInputRef?.focus())
  }

  const handleCloseTab = (tabId: string) => view().browser.closeTab(tabId)

  const handleOpenExternal = () => {
    const url = normalizeBrowserUrl(inputValue()) ?? normalizeBrowserUrl(storedUrl())
    if (!url) return
    platform.openExternal(url)
  }

  const activeWebview = () => webviewRefs.get(activeTabId())

  return (
    <aside
      id="browser-panel"
      aria-label={language.t("browser.title")}
      class="relative min-w-0 flex flex-1 flex-col overflow-hidden"
      classList={{
        "bg-v2-background-bg-base rounded-[10px] shadow-[var(--v2-elevation-raised)]": newLayout(),
        "bg-background-base border-l border-border-weaker-base": !newLayout(),
        "h-full shrink-0": !props.stacked,
        "h-full min-h-0": props.stacked,
      }}
    >
      <div class="shrink-0 flex items-center h-10 border-b border-border-weaker-base pr-2">
        <Tabs
          variant="normal"
          value={activeTabId()}
          onChange={(id) => view().browser.setActiveTab(id)}
          class="flex-1 min-w-0 !h-10 !flex-none"
        >
          <Tabs.List class="h-10 overflow-x-auto no-scrollbar">
            <For each={tabs()}>
              {(tab) => (
                <Tabs.Trigger
                  value={tab.id}
                  onMiddleClick={() => handleCloseTab(tab.id)}
                  closeButton={
                    <Tooltip value={language.t("browser.closeTab")} placement="bottom">
                      <IconButton
                        icon="close-small"
                        variant="ghost"
                        class="h-5 w-5"
                        onClick={(event: MouseEvent) => {
                          event.stopPropagation()
                          handleCloseTab(tab.id)
                        }}
                        aria-label={language.t("browser.closeTab")}
                      />
                    </Tooltip>
                  }
                >
                  <span class="flex items-center gap-1.5 max-w-40 truncate">
                    <Icon name="browser" size="small" class="shrink-0 text-icon-weak" />
                    <span class="truncate">{formatTabLabel(tab, language.t("browser.newTab"))}</span>
                  </span>
                </Tabs.Trigger>
              )}
            </For>
            <Tooltip value={language.t("browser.newTab")} placement="bottom">
              <IconButton
                icon="plus-small"
                variant="ghost"
                class="h-6 w-6 shrink-0"
                onClick={handleAddTab}
                aria-label={language.t("browser.newTab")}
              />
            </Tooltip>
          </Tabs.List>
        </Tabs>

        <Tooltip value={language.t("browser.close")} placement="bottom">
          <IconButton
            icon="close-small"
            variant="ghost"
            class="h-6 w-6 shrink-0"
            onClick={() => view().browserPanel.close()}
            aria-label={language.t("browser.close")}
          />
        </Tooltip>
      </div>

      <div class="shrink-0 flex items-center gap-1.5 px-2.5 h-10 border-b border-border-weaker-base">
        <Show when={isDesktopApp()}>
          <Tooltip value={language.t("browser.back")} placement="bottom">
            <IconButton
              icon="arrow-left"
              variant="ghost"
              class="h-6 w-6 shrink-0"
              disabled={!canGoBack()}
              onClick={() => activeWebview()?.goBack()}
              aria-label={language.t("browser.back")}
            />
          </Tooltip>
          <Tooltip value={language.t("browser.forward")} placement="bottom">
            <IconButton
              icon="arrow-right"
              variant="ghost"
              class="h-6 w-6 shrink-0"
              disabled={!canGoForward()}
              onClick={() => activeWebview()?.goForward()}
              aria-label={language.t("browser.forward")}
            />
          </Tooltip>
          <Tooltip value={language.t("browser.reload")} placement="bottom">
            <IconButton
              icon="reset"
              variant="ghost"
              class="h-6 w-6 shrink-0"
              disabled={!storedUrl()}
              onClick={() => activeWebview()?.reload()}
              aria-label={language.t("browser.reload")}
            />
          </Tooltip>
        </Show>

        <form onSubmit={handleSubmit} class="flex-1 min-w-0 flex items-center">
          <input
            ref={urlInputRef}
            type="text"
            value={inputValue()}
            onInput={(event) => setInputValue(event.currentTarget.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => {
              setInputFocused(false)
              if (!inputValue().trim() && storedUrl()) {
                setInputValue(storedUrl())
              }
            }}
            placeholder={language.t("browser.url.placeholder")}
            aria-label={language.t("browser.url.placeholder")}
            class="w-full h-7 px-2.5 rounded-md text-12-regular text-text-strong bg-surface-base border border-border-weak-base focus:outline-none focus:border-border-strong-base truncate"
          />
        </form>

        <Tooltip value={language.t("browser.openExternal")} placement="bottom">
          <IconButton
            icon="square-arrow-top-right"
            variant="ghost"
            class="h-6 w-6 shrink-0"
            disabled={!storedUrl() && !inputValue().trim()}
            onClick={handleOpenExternal}
            aria-label={language.t("browser.openExternal")}
          />
        </Tooltip>
      </div>

      <div class="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        <Show
          when={isDesktopApp()}
          fallback={
            <div class="h-full px-6 flex flex-col items-center justify-center text-center gap-4">
              <Icon name="browser" size="large" class="text-icon-weak" />
              <Show when={storedTitle() || storedUrl()}>
                <div class="max-w-md flex flex-col items-center gap-1">
                  <Show when={storedTitle()}>
                    {(title) => <div class="text-14-medium text-text-strong truncate max-w-full">{title()}</div>}
                  </Show>
                  <Show when={storedUrl()}>
                    {(url) => <div class="text-12-regular text-text-weak break-all">{url()}</div>}
                  </Show>
                </div>
              </Show>
              <div class="text-13-regular text-text-weak max-w-sm">{language.t("browser.webNotice")}</div>
              <Show when={storedUrl()}>
                <Button variant="secondary" size="small" onClick={handleOpenExternal}>
                  <Icon name="square-arrow-top-right" size="small" />
                  <span>{language.t("browser.openExternal")}</span>
                </Button>
              </Show>
            </div>
          }
        >
          <For each={tabIds()}>
            {(tabId) => {
              const isActive = () => tabId === activeTabId()
              const tabLoading = () => Boolean(runtime[tabId]?.loading)
              const hasContent = () => Boolean(tabs().find((tab) => tab.id === tabId)?.url || tabLoading())
              return (
                <webview
                  ref={(el) => bindWebview(tabId, el)}
                  partition="persist:forge-browser"
                  src="about:blank"
                  class="size-full flex-1 min-h-0"
                  classList={{
                    hidden: !isActive() || !hasContent(),
                  }}
                />
              )
            }}
          </For>
          <Show when={!storedUrl() && !loading()}>
            <div class="h-full px-6 flex flex-col items-center justify-center text-center gap-3">
              <Icon name="browser" size="large" class="text-icon-weak" />
              <div class="text-13-medium text-text-strong max-w-xs">{language.t("browser.empty.title")}</div>
              <div class="text-12-regular text-text-weak max-w-xs">{language.t("browser.empty.description")}</div>
            </div>
          </Show>
        </Show>
      </div>
    </aside>
  )
}
