# Effect loose ends

Small follow-ups that do not fit neatly into the main facade, route, tool, or schema migration checklists.

## Config / mini

- [x] `env/index.ts` - already uses `InstanceState.make(...)`.
- Note: the full terminal UI was removed. `cli/mini/config.ts` is the remaining
  keybind/diff-style loader for `--mini`; the TUI config migration items below
  are obsolete.

## ConfigPaths

- [ ] `config/paths.ts` - split pure helpers from effectful helpers.
      Keep `fileInDirectory(...)` as a plain function.
- [ ] `config/paths.ts` - add a `ConfigPaths.Service` for the effectful operations so callers do not inherit `FSUtil.Service` directly.
      Initial service surface should cover:
  - `projectFiles(...)`
  - `directories(...)`
  - `readFile(...)`
  - `parseText(...)`
- [ ] `config/config.ts` - switch internal config loading from `Effect.promise(() => ConfigPaths.*(...))` to `yield* paths.*(...)` once the service exists.

## Notes

- Prefer small, semantics-preserving config migrations. Config precedence, legacy key migration, and plugin origin tracking are easy to break accidentally.
- When changing config loading internals, rerun the config and TUI suites first before broad package sweeps.
