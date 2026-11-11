import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// The build the bundled server reports, when this release names one. Only a packaged app runs the bundled server.
export const BUILD = app.isPackaged ? import.meta.env.FORGE_BUILD : undefined

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames: Partial<Record<Channel, string>> = {
  dev: "Forge Dev",
  beta: "Forge Beta",
  prod: "Forge",
}

const appIDs: Partial<Record<Channel, string>> = {
  dev: "io.github.divyanshusingh2903.forge.dev",
  beta: "io.github.divyanshusingh2903.forge.beta",
  prod: "io.github.divyanshusingh2903.forge",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? (appNames[CHANNEL] ?? "Forge Dev") : "Forge Dev"

export const APP_ID = app.isPackaged ? (appIDs[CHANNEL] ?? "io.github.divyanshusingh2903.forge.dev") : "io.github.divyanshusingh2903.forge.dev"
