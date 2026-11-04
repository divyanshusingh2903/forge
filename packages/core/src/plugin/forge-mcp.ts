export * as ForgeMcpPlugin from "./forge-mcp.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"

/**
 * Remote MCP servers Forge ships with. Each starts disabled and connects when the user turns it on. GitHub's OAuth
 * server has no dynamic client registration, so it signs in with an access token or a pre-registered OAuth app
 * instead; the rest use a normal browser OAuth login.
 */
export const servers = {
  github: "https://api.githubcopilot.com/mcp/",
  gitlab: "https://gitlab.com/api/v4/mcp",
  linear: "https://mcp.linear.app/mcp",
  notion: "https://mcp.notion.com/mcp",
  sentry: "https://mcp.sentry.dev/mcp",
  jira: "https://mcp.atlassian.com/v1/mcp",
} as const

// Runs after the config plugin, so a server of the same name in config replaces the built-in one entirely.
export const Plugin = define({
  id: "forge.mcp",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.mcp.transform((editor) => {
      for (const [name, url] of Object.entries(servers)) {
        if (editor.get(name)) continue
        editor.set(name, { type: "remote", url, disabled: true })
      }
    })
  }),
})
