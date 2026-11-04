<div align="center">

[![Forge logo](.github/assets/forge-logo.svg)](https://divyanshusingh.site/forge)

**The coding agent that keeps you in the loop.**

The power of OpenCode, with the transparency and human-in-the-loop feel of Claude Code.

[![Latest release](https://img.shields.io/github/v/release/divyanshusingh2903/forge?style=flat-square)](https://github.com/divyanshusingh2903/forge/releases/latest) [![MIT License](https://img.shields.io/github/license/divyanshusingh2903/forge?style=flat-square)](LICENSE) [![Website](https://img.shields.io/badge/website-forge-black?style=flat-square)](https://divyanshusingh.site/forge)

</div>

> Forge is a fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT licensed). See [NOTICE.md](NOTICE.md) for attribution.

---

### What this is

Forge is a personal fork of [OpenCode](https://github.com/anomalyco/opencode), steering it closer to how [Claude Code](https://claude.com/claude-code) feels to use: more human-in-the-loop, more transparent about what the agent is about to do before it does it, and less inclined to act autonomously without asking first.

This is a real GitHub fork of `anomalyco/opencode` (not a one-off copy), so it shares upstream's history and can pull in new OpenCode releases normally. It's a personal project, not a supported product. There's no install script or separate community channels.

### Status

Forge is being moved from the OpenCode v1 line onto OpenCode v2 (tracked in [#60](https://github.com/divyanshusingh2903/forge/issues/60)). This branch has the Forge branding on top of v2. Forge's own features come back one at a time, so they are not here yet: the plan agent and plan tab, the browser tools and pane, the Git review panel, local memory, and the edit-mode picker. The v1 releases (`forge-v1-final`) have all of them.

There is no full-screen terminal interface. The desktop app is the interface, and the `opencode` binary hosts its server. `opencode mini` and `opencode run <message>` still work from a terminal.

### Download

Desktop installers for macOS, Windows, and Linux are published on [GitHub Releases](https://github.com/divyanshusingh2903/forge/releases/latest), or grab the right one for your OS from the [Forge website](https://divyanshusingh.site/forge).

The installers aren't code-signed yet. On macOS, if the first launch is blocked, open System Settings → Privacy & Security and click **Open Anyway** (or run `xattr -dr com.apple.quarantine /Applications/Forge.app`). On Windows, when SmartScreen appears, click **More info → Run anyway**. On Linux, make the AppImage executable.

### Running from source

```bash
git clone git@github.com:divyanshusingh2903/forge.git
cd forge
bun install

bun dev             # CLI, equivalent to the built `opencode` command
bun dev serve       # headless API server only
```

To run the desktop app (Electron) in development:

```bash
bun run dev:desktop
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the package breakdown and dev commands.

### Documentation

Forge shares most of its functionality with OpenCode, so [OpenCode's docs](https://opencode.ai/docs) are the best reference for configuration, providers, and agent behavior. Nearly all of it applies here too.

### Contributing

This is a personal project, but if you're poking around the code, [CONTRIBUTING.md](./CONTRIBUTING.md) has the dev setup and architecture notes.

---

**Website:** [Forge](https://divyanshusingh.site/forge) · **Upstream:** [OpenCode on GitHub](https://github.com/anomalyco/opencode) · [opencode.ai](https://opencode.ai)
