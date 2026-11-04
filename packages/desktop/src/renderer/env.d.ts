import type { ElectronNative } from "../preload/types"

declare global {
  interface ImportMetaEnv {
    readonly OPENCODE_TEST_ONBOARDING: boolean
    readonly FORGE_VERSION?: string
  }

  interface Window {
    electron: ElectronNative
    __FORGE__?: {
      deepLinks?: string[]
    }
  }
}
