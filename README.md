<p align="center"><b>Forge</b></p>
<p align="center">A personal, human-in-the-loop fork of OpenCode.</p>

> Forge is a fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT licensed). See [NOTICE.md](NOTICE.md) for attribution.

---

### What this is

Forge is a personal fork of [OpenCode](https://github.com/anomalyco/opencode), steering it closer to how [Claude Code](https://claude.com/claude-code) feels to use: more human-in-the-loop, more transparent about what the agent is about to do before it does it, and less inclined to act autonomously without asking first.

This is a real GitHub fork of `anomalyco/opencode` (not a one-off copy), so it shares upstream's history and can pull in new OpenCode releases normally. It's not a published product — there's no install script, hosted releases, or separate community channels. Build and run it from source.

### Running it

```bash
git clone git@github.com:divyanshusingh2903/forge.git
cd forge
bun install

bun dev             # CLI, equivalent to the built `opencode` command
bun dev web         # headless server + web UI
bun dev serve       # headless API server only
```

To run the desktop app (Electron) in development:

```bash
bun run --cwd packages/desktop dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full package breakdown, dev commands, and debugging notes.

### Agents

Two built-in agents, switchable with the `Tab` key:

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration; denies file edits and asks permission before running bash commands

Also included is a **general** subagent for complex searches and multistep tasks, invoked with `@general` in messages.

### Documentation

Forge shares most of its functionality with OpenCode, so [OpenCode's docs](https://opencode.ai/docs) are the best reference for configuration, providers, and agent behavior — nearly all of it applies here too.

### Contributing

This is a personal project, but if you're poking around the code, [CONTRIBUTING.md](./CONTRIBUTING.md) has the dev setup and architecture notes.

---

**Upstream:** [OpenCode on GitHub](https://github.com/anomalyco/opencode) · [opencode.ai](https://opencode.ai)
