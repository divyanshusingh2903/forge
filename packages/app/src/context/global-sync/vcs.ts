import type { VcsInfo } from "@opencode-ai/sdk/v2/client"

export function createVcsSync(input: {
  read: (directory: string) => Promise<VcsInfo | undefined>
  target: (directory: string) => { identity: object; apply: (info: VcsInfo) => void } | undefined
  missingResponseMessage: string
}) {
  const state = { disposed: false }
  const entries = new Map<
    string,
    { identity: object; revision: number; trailing: boolean; pending?: Promise<void> }
  >()
  const refresh = (directory: string): Promise<void> => {
    if (state.disposed) return Promise.resolve()
    const target = input.target(directory)
    if (!target) return Promise.resolve()
    const previous = entries.get(directory)
    const entry =
      previous?.identity === target.identity ? previous : { identity: target.identity, revision: 0, trailing: false }
    entries.set(directory, entry)
    const revision = ++entry.revision
    if (entry.pending) {
      entry.trailing = true
      return entry.pending
    }
    const pending = Promise.resolve()
      .then(() => input.read(directory))
      .then((info) => {
        if (
          entries.get(directory) !== entry ||
          entry.revision !== revision ||
          input.target(directory)?.identity !== target.identity
        )
          return
        if (!info) throw new Error(input.missingResponseMessage)
        // Missing fields are authoritative, including a detached HEAD's absent branch.
        target.apply({ branch: info.branch, default_branch: info.default_branch })
      })
      .finally(() => {
        if (entries.get(directory) !== entry) return
        entry.pending = undefined
        if (!entry.trailing) return
        entry.trailing = false
        return refresh(directory)
      })
    entry.pending = pending
    return pending
  }
  return {
    refresh,
    clear: (directory: string) => entries.delete(directory),
    dispose: () => {
      state.disposed = true
      entries.clear()
    },
  }
}
