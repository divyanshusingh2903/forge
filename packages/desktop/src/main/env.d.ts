interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
  readonly OPENCODE_VERSION?: string
  readonly FORGE_BUILD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
