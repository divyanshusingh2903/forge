// One active read and one queued successor. Acceptance guards both newer events and scope changes.
export function createGitRefresh(read: (accept: () => boolean) => Promise<void>) {
  const state = { generation: 0, revision: 0, trailing: false, pending: undefined as Promise<void> | undefined }
  const load = (): Promise<void> => {
    const revision = ++state.revision
    if (state.pending) {
      state.trailing = true
      return state.pending
    }
    const generation = state.generation
    const pending = Promise.resolve()
      .then(() => read(() => generation === state.generation && revision === state.revision))
      .finally(() => {
        if (state.pending !== pending) return
        state.pending = undefined
        if (!state.trailing) return
        state.trailing = false
        return load()
      })
    state.pending = pending
    return pending
  }
  return {
    load,
    invalidate: () => {
      state.revision++
    },
    reset: () => {
      state.generation++
      state.revision++
      state.trailing = false
      state.pending = undefined
    },
  }
}
