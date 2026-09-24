import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __FORGE__?: {
      deepLinks?: string[]
    }
  }
}
