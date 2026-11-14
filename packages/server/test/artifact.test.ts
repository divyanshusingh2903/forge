import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const client = (handler: (request: Request) => Promise<Response>) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })

it.live("manages local and plugin-backed artifacts through /api/experimental/artifacts when enabled", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-artifact-api-")).path
    const global = path.join(dir, "global")
    const enabled = path.join(dir, "enabled")
    const enabledOther = path.join(dir, "enabled-other")
    const disabled = path.join(dir, "disabled")
    const pluginDir = path.join(dir, "custom-artifact-plugin")

    yield* Effect.promise(async () => {
      await Promise.all([global, enabled, enabledOther, disabled, pluginDir].map((item) => fs.mkdir(item, { recursive: true })))
      await fs.writeFile(
        path.join(pluginDir, "package.json"),
        JSON.stringify({ name: "custom-artifact-plugin", type: "module", exports: "./index.js" }),
      )
      await fs.writeFile(
        path.join(pluginDir, "index.js"),
        `
const store = new Map()
const decoder = new TextDecoder()
const encoder = new TextEncoder()
export default {
  id: "test-s3-artifacts",
  async setup(ctx) {
    await ctx.experimental.artifact.transform((editor) => {
      editor.add({
        id: "s3",
        name: "S3 Static",
        capabilities: ["static"],
        prompt: "Artifacts go to a static S3 bucket.",
        async create(input) {
          store.set(input.id, Object.fromEntries(Object.entries(input.files).map(([k, v]) => [k, decoder.decode(v)])))
          return { url: "https://artifacts.example.test/" + input.id + "/" }
        },
        async read(id) {
          const item = store.get(id) ?? {}
          return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, encoder.encode(v)]))
        },
        async update(id, input) {
          store.set(id, Object.fromEntries(Object.entries(input.files).map(([k, v]) => [k, decoder.decode(v)])))
          return { url: "https://artifacts.example.test/" + id + "/" }
        },
        async delete(id) {
          store.delete(id)
        },
      })
    })
  },
}
`,
      )
      await fs.writeFile(
        path.join(enabled, "opencode.json"),
        JSON.stringify({
          plugins: [{ package: pluginDir }],
          experimental: { artifacts: true },
        }),
      )
      await fs.writeFile(
        path.join(enabledOther, "opencode.json"),
        JSON.stringify({
          experimental: { artifacts: true },
        }),
      )
    })

    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: path.join(dir, "opencode.db") },
      config: { directory: global, project: true, claude: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const api = client(handler)

    yield* Effect.promise(async () => {
      // Disabled location returns ForbiddenError
      await expect(
        api.experimental.artifacts.list({ location: { directory: disabled } }),
      ).rejects.toMatchObject({ _tag: "ForbiddenError" })

      // Providers list includes built-in local (default) and plugin-registered s3
      const providers = await api.experimental.artifacts.providers({ location: { directory: enabled } })
      expect(providers.data).toEqual([
        { id: "local", name: "Local", capabilities: ["static"], default: true },
        { id: "s3", name: "S3 Static", capabilities: ["static"], default: false },
      ])

      const session = await api.session.create({ location: { directory: enabled } })

      // Create local multi-file artifact linked to session
      const created = await api.experimental.artifacts.create({
        location: { directory: enabled },
        sessionID: session.id,
        title: "Wait stats",
        files: {
          "index.html": "<!doctype html><h1>v1</h1><script src='./assets/app.js'></script>",
          "assets/app.js": "window.VERSION = 1",
        },
      })
      expect(created.data).toMatchObject({
        provider: "local",
        sessionID: session.id,
        title: "Wait stats",
        entry: "index.html",
        url: `/api/experimental/artifacts/${encodeURIComponent(created.data.id)}/view/`,
      })

      // Redirects /view -> /view/ with 308 so relative "./assets/*" resolves
      const redirect = await handler(
        new Request(`http://opencode.local/api/experimental/artifacts/${created.data.id}/view`),
      )
      expect(redirect.status).toBe(308)
      expect(redirect.headers.get("location")).toBe(`/api/experimental/artifacts/${created.data.id}/view/`)

      // Serves entry HTML and relative JS in a sandboxed opaque origin without requiring location query
      const v1Html = await handler(
        new Request(`http://opencode.local/api/experimental/artifacts/${created.data.id}/view/`),
      )
      expect(v1Html.status).toBe(200)
      expect(v1Html.headers.get("content-type")).toContain("text/html")
      expect(v1Html.headers.get("content-security-policy")).toBe("sandbox allow-scripts")
      expect(await v1Html.text()).toContain("<h1>v1</h1>")

      // Sessionless SDK artifact also resolves its stored directory at /view/
      const sessionless = await api.experimental.artifacts.create({
        location: { directory: enabled },
        title: "Standalone report",
        files: { "index.html": "<h1>no-session</h1>" },
      })
      const sessionlessHtml = await handler(
        new Request(`http://opencode.local${sessionless.data.url}`),
      )
      expect(sessionlessHtml.status).toBe(200)
      expect(await sessionlessHtml.text()).toContain("<h1>no-session</h1>")

      // Another enabled project cannot list, read, update, or delete this project's artifacts
      const otherList = await api.experimental.artifacts.list({ location: { directory: enabledOther } })
      expect(otherList.data).toEqual([])
      await expect(
        api.experimental.artifacts.get({ artifactID: created.data.id, location: { directory: enabledOther } }),
      ).rejects.toMatchObject({ _tag: "ArtifactNotFoundError" })
      await expect(
        api.experimental.artifacts.delete({ artifactID: created.data.id, location: { directory: enabledOther } }),
      ).rejects.toMatchObject({ _tag: "ArtifactNotFoundError" })

      const v1Js = await handler(
        new Request(`http://opencode.local/api/experimental/artifacts/${created.data.id}/view/assets/app.js`),
      )
      expect(v1Js.status).toBe(200)
      expect(await v1Js.text()).toBe("window.VERSION = 1")

      // Update replaces files at the same ID and URL
      const updated = await api.experimental.artifacts.update({
        artifactID: created.data.id,
        files: {
          "index.html": "<!doctype html><h1>v2</h1>",
        },
      })
      expect(updated.data.url).toBe(created.data.url)

      const latestHtml = await handler(
        new Request(`http://opencode.local/api/experimental/artifacts/${created.data.id}/view/`),
      )
      expect(await latestHtml.text()).toContain("<h1>v2</h1>")

      // Every publish is a retained version, newest first
      expect(updated.data.version).toBe(2)
      const versions = await api.experimental.artifacts.versions({ artifactID: created.data.id })
      expect(versions.data.map((item) => item.version)).toEqual([2, 1])
      const first = await api.experimental.artifacts.version({ artifactID: created.data.id, version: "1" })
      expect(first.data.files["assets/app.js"]).toBe("window.VERSION = 1")
      await expect(
        api.experimental.artifacts.version({ artifactID: created.data.id, version: "9" }),
      ).rejects.toMatchObject({ _tag: "ArtifactNotFoundError" })

      // A version serves under its own prefix, so its relative assets resolve to the same version
      const versionPrefix = `/api/experimental/artifacts/${created.data.id}/versions/1/view`
      const versionRedirect = await handler(new Request(`http://opencode.local${versionPrefix}`))
      expect(versionRedirect.status).toBe(308)
      expect(versionRedirect.headers.get("location")).toBe(`${versionPrefix}/`)
      const versionHtml = await handler(new Request(`http://opencode.local${versionPrefix}/`))
      expect(versionHtml.headers.get("content-security-policy")).toBe("sandbox allow-scripts")
      expect(await versionHtml.text()).toContain("<h1>v1</h1>")
      const versionJs = await handler(new Request(`http://opencode.local${versionPrefix}/assets/app.js`))
      expect(await versionJs.text()).toBe("window.VERSION = 1")
      const missingVersion = await handler(
        new Request(`http://opencode.local/api/experimental/artifacts/${created.data.id}/versions/9/view/`),
      )
      expect(missingVersion.status).toBe(404)

      // Restoring publishes version 1's files as version 3
      const restored = await api.experimental.artifacts.restore({
        artifactID: created.data.id,
        version: "1",
        sessionID: session.id,
      })
      expect(restored.data).toMatchObject({ version: 3, url: created.data.url })
      const restoredJs = await handler(
        new Request(`http://opencode.local/api/experimental/artifacts/${created.data.id}/view/assets/app.js`),
      )
      expect(await restoredJs.text()).toBe("window.VERSION = 1")

      // Per-request override to plugin-registered "s3" provider
      const remote = await api.experimental.artifacts.create({
        location: { directory: enabled },
        sessionID: session.id,
        provider: "s3",
        title: "Shared bundle",
        files: { "index.html": "<p>remote</p>" },
      })
      expect(remote.data).toMatchObject({
        provider: "s3",
        url: `https://artifacts.example.test/${remote.data.id}/`,
      })

      const fetchedRemote = await api.experimental.artifacts.get({
        artifactID: remote.data.id,
        location: { directory: enabled },
      })
      expect(fetchedRemote.data.files).toEqual({ "index.html": "<p>remote</p>" })

      const listedS3 = await api.experimental.artifacts.list({
        sessionID: session.id,
        provider: "s3",
      })
      expect(listedS3.data.map((item) => item.id)).toEqual([remote.data.id])

      // Delete removes record and returns 404 thereafter
      await api.experimental.artifacts.delete({ artifactID: created.data.id, location: { directory: enabled } })
      await expect(
        api.experimental.artifacts.get({ artifactID: created.data.id, location: { directory: enabled } }),
      ).rejects.toMatchObject({
        _tag: "ArtifactNotFoundError",
      })
    })
  }),
  // It builds three servers and takes just over the default five seconds on a loaded Windows runner.
  30_000,
)
