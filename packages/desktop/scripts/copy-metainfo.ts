import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId =
  channel === "prod" ? "io.github.divyanshusingh2903.forge" : `io.github.divyanshusingh2903.forge.${channel}`
const productName = channel === "prod" ? "Forge" : `Forge ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = `A personal, human-in-the-loop fork of OpenCode${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="io.github.divyanshusingh2903">
    <name>Divyanshu Singh</name>
  </developer>

  <description>
    <p>
      Forge is a personal fork of OpenCode, an open source agent that helps you write and run
      code with any AI model, steered toward a more human-in-the-loop workflow.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/divyanshusingh2903/forge/issues</url>
  <url type="homepage">https://github.com/divyanshusingh2903/forge</url>
  <url type="vcs-browser">https://github.com/divyanshusingh2903/forge</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
