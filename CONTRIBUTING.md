# Contributing to Forge

Forge is a personal fork of [OpenCode](https://github.com/anomalyco/opencode), built on OpenCode V2. Changes that only make sense upstream (new providers, LSPs, formatters, general bug fixes) are best sent to OpenCode directly. Here are the most common types of changes that get merged here:

- Bug fixes
- Improvements to Forge's own features (plan mode, memory, the git review panel, the Projects sidebar, the context view)
- Fixes for environment-specific quirks
- Documentation improvements

Any UI or core product feature must go through a design discussion with the maintainer before implementation.

If you are unsure whether a PR would be accepted, open an issue first or look at the [open issues](https://github.com/divyanshusingh2903/forge/issues). Want to take on an issue? Leave a comment and the maintainer may assign it to you unless it is already in progress.

The default branch is `main`, and every PR targets it. Ignore `dev`: it is leftover upstream history. See [MAINTAINING.md](MAINTAINING.md) for how releases and upstream syncs work.

> While the V2 port is in progress ([#60](https://github.com/divyanshusingh2903/forge/issues/60)), Forge V2 lives on the `v2-port` branch and `main` still holds Forge V1. Base V2 work on `v2-port` until it replaces `main`.

## Adding New Providers

New providers rarely need Forge or OpenCode changes. Add the provider to [models.dev](https://github.com/anomalyco/models.dev) first.

## Developing Forge

Requirements: Bun 1.4.4 (the version pinned in `package.json`), Git, and the platform tools below. The pre-push hook checks your Bun version.

### Setup by platform

<details open>
<summary>Linux</summary>

```bash
curl -fsSL https://bun.sh/install | bash
git clone git@github.com:divyanshusingh2903/forge.git
cd forge
bun install
bun run dev:desktop
```

</details>

<details>
<summary>macOS</summary>

```bash
xcode-select --install          # Git and the C toolchain
curl -fsSL https://bun.sh/install | bash   # or: brew install oven-sh/bun/bun
git clone git@github.com:divyanshusingh2903/forge.git
cd forge
bun install
bun run dev:desktop
```

Unsigned local builds are blocked by Gatekeeper on first launch. Run `xattr -dr com.apple.quarantine /Applications/Forge.app` after installing, or use System Settings → Privacy & Security → **Open Anyway**.

</details>

<details>
<summary>Windows</summary>

Use PowerShell, or [WSL](https://learn.microsoft.com/windows/wsl/install) if you prefer a Linux workflow (the repo then lives in the WSL filesystem, not `/mnt/c`).

```powershell
winget install Git.Git
powershell -c "irm bun.sh/install.ps1 | iex"
git clone git@github.com:divyanshusingh2903/forge.git
cd forge
bun install
bun run dev:desktop
```

Notes:

- Install the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ("Desktop development with C++") if a native dependency fails to build.
- Enable long paths if `bun install` fails with path-length errors: `git config --global core.longpaths true`, and turn on `LongPathsEnabled` in the registry.
- Run the `./script/*.ts` commands below with `bun <path>` instead of executing them directly.

</details>

### Running Forge

The desktop app is the product. `bun run dev:desktop` starts it as **Forge Dev**, with its own app identity and data, so it can run next to an installed Forge. It runs the server from source and hot-reloads the UI.

Other entry points, all from the repository root:

```bash
bun dev serve --port 4096   # the V2 server on its own
bun run dev:web             # the web UI in a browser, against a running server
```

`bun dev` runs the `opencode` command line from `packages/cli`. Forge has removed the full-screen TUI, so it has no interactive terminal interface.

### Packages

- `packages/schema`: shared wire and storage contracts
- `packages/core`: sessions, tools, permissions, config, plugins and persistence (Forge's plan mode and memory live here as internal plugins)
- `packages/protocol`: public API definitions
- `packages/server`: HTTP server and runtime composition
- `packages/client`: generated TypeScript clients
- `packages/cli`: command line and the server the desktop app bundles
- `packages/app`, `packages/session-ui`, `packages/ui`: the web interface
- `packages/gui-plugins`: built-in session tabs such as Context and Details
- `packages/desktop`: the Electron desktop app
- `packages/plugin`: plugin API
- `packages/tui`: an internal library the CLI still imports; don't add features here

### Building the desktop app

The desktop build bundles the server from `packages/cli/dist`, so build that first. `OPENCODE_CHANNEL` picks the app identity, icons and name (`dev` is the default, `prod` builds Forge itself).

```bash
cd packages/cli && OPENCODE_CHANNEL=prod bun run build --skip-web-ui
cd ../desktop
NODE_OPTIONS=--max-old-space-size=4096 OPENCODE_CHANNEL=prod bun run build
OPENCODE_CHANNEL=prod bun run pack
```

`pack` writes unsigned installers to `dist/desktop/` at the repository root: a `.app` tarball on macOS, the unpacked app on Windows, and AppImage, `.deb` and `.rpm` on Linux. See [packages/desktop/README.md](packages/desktop/README.md) for the other build variables. Raise or drop `NODE_OPTIONS` depending on how much memory the renderer build needs on your machine.

### Verification

The pre-push hook runs `bun run check` (lint and the full typecheck). Run tests, and typechecks while you iterate, from the affected package rather than the repository root:

```bash
cd packages/core
bun run test
bun typecheck
```

For UI changes, run the desktop app and click through what you changed.

> [!NOTE]
> If you change the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Never edit generated client files by hand.

Follow package-specific instructions in nearby `AGENTS.md` files, and the repository [style guide](./AGENTS.md).

## Pull Request Expectations

### Issue First Policy

Bug fixes and features should reference an existing issue. Use `Fixes #123` or `Closes #123` in your PR description, and fill in the [PR template](.github/pull_request_template.md). For small fixes, a brief issue is fine.

### General Requirements

- Keep pull requests small and focused
- Explain the issue and why your change fixes it
- Before adding new functionality, ensure it doesn't already exist elsewhere in the codebase

### UI Changes

If your PR includes UI changes, please include screenshots or videos showing the before and after.

### Logic Changes

For non-UI changes (bug fixes, new features, refactors), explain **how you verified it works**:

- What did you test?
- How can a reviewer reproduce/confirm the fix?

### No AI-Generated Walls of Text

Long, AI-generated PR descriptions and issues may be ignored. Write short, focused descriptions that explain what changed and why in your own words. If you can't explain it briefly, your PR might be too large.

### Branch Names

Use a short branch name of at most three words separated by hyphens, with no slashes or type prefixes (`session-recovery`, not `feat/session-recovery`).

### PR Titles

Use `type(scope): summary`. Supported types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. The scope is optional; use the affected package or area, e.g. `core`, `server`, `app`, `desktop`, `sdk` or `plugin`.

Examples:

- `docs: update contributing guide`
- `fix(desktop): resolve crash on startup`
- `feat(app): add workspace search`

## Feature Requests

For net-new functionality, start with a design conversation. Open an issue describing the problem, your proposed approach (optional), and why it belongs in Forge. Please wait for the maintainer's approval instead of opening a feature PR directly.

## Issues

Bug reports and feature requests should use their issue templates. Blank issues are not allowed.
