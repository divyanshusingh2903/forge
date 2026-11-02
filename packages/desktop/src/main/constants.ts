import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "Forge Dev",
  beta: "Forge Beta",
  prod: "Forge",
}

const appIDs: Record<string, string> = {
  dev: "io.github.divyanshusingh2903.forge.dev",
  beta: "io.github.divyanshusingh2903.forge.beta",
  prod: "io.github.divyanshusingh2903.forge",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "Forge Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "io.github.divyanshusingh2903.forge.dev"
