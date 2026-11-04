import type { ElectronAPI } from "../api-types"

const deepLinkEvent = "forge:deep-link"

export function startDeepLinks(api: ElectronAPI) {
  void api.consumeInitialDeepLinks().then(emitDeepLinks)
  api.onDeepLink(emitDeepLinks)
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  window.__FORGE__ ??= {}
  window.__FORGE__.deepLinks = [...(window.__FORGE__.deepLinks ?? []), ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}
