import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Schema, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Artifact } from "@opencode/core/artifact"
import { Bus } from "@opencode/core/bus"
import { KV } from "@opencode/core/kv"
import { Config } from "@opencode/core/config"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { ArtifactTools } from "@opencode/core/tool/plugin/artifact"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { AbsolutePath } from "@opencode/schema/schema"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { codeModeListings, executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const toolPaths = [
  "opencode.artifact_create",
  "opencode.artifact_read",
  "opencode.artifact_update",
  "opencode.artifact_delete",
]

const buildLayer = (artifactsEnabled: boolean, dir: string) => {
  const entries = artifactsEnabled
    ? [
        new Document({
          type: "document",
          info: new Info({
            experimental: new ConfigExperimental.Info({ artifacts: true }),
          }),
        }),
      ]
    : []
  const ref = Location.Ref.make({ directory: AbsolutePath.make(dir) })
  return AppNodeBuilder.build(
    LayerNode.group([
      Artifact.node,
      Bus.node,
      Config.node,
      Global.node,
      KV.node,
      Location.node,
      Permission.node,
      Session.node,
      Tool.node,
    ]),
    [
      Config.node.replace(Config.testLayer(entries)),
      Global.node.replace(Global.layerWith({ data: path.join(dir, ".data") })),
      Image.node.replace(imagePassthrough),
      Location.node.replace(Location.boundNode(ref)),
      Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
    ],
  )
}

const callCodeMode = (registry: Tool.Interface, sessionID: Session.ID, name: string, input: unknown) =>
  executeTool(registry, {
    sessionID,
    ...toolIdentity,
    call: {
      type: "tool-call",
      id: `call-${name}`,
      name: "execute",
      input: { code: `return await tools.opencode.${name}(${JSON.stringify(input)})` },
    },
  }).pipe(
    Effect.map((result) => {
      if (result.status !== "completed") {
        throw new Error(`Tool ${name} failed: ${JSON.stringify(result.error)}`)
      }
      return JSON.parse(result.content?.[0]?.type === "text" ? result.content[0].text : "")
    }),
  )

const it = testEffect(Layer.empty)

describe("experimental.artifacts service and tools", () => {
  it.live("stays disabled and hides artifact tools when experimental.artifacts is unset", () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-artifact-off-")).path
      yield* Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const registry = yield* Tool.Service
        expect(yield* artifacts.enabled()).toBe(false)
        expect(
          yield* artifacts
            .create({ title: "Draft", files: { "index.html": "<h1>hi</h1>" } })
            .pipe(Effect.flip),
        ).toBeInstanceOf(Artifact.DisabledError)

        yield* registerToolPlugin(ArtifactTools.Plugin, {
          event: { subscribe: () => Stream.never },
        })
        const snap = yield* registry.snapshot()
        const listed = snap.codeModeCatalog ? codeModeListings(snap.codeModeCatalog).map((item) => item.path) : []
        for (const name of toolPaths) {
          expect(listed).not.toContain(name)
        }
      }).pipe(Effect.provide(buildLayer(false, dir)))
    }),
  )

  it.live("registers custom providers, routes overrides, and runs the 4 CRUD tools", () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-artifact-on-")).path

      yield* Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const registry = yield* Tool.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({
          location: Location.Ref.make({ directory: AbsolutePath.make(dir) }),
        })

        const remoteStore = new Map<Artifact.ID, Record<string, Uint8Array>>()
        yield* artifacts.transform((editor) => {
          editor.add({
            id: Artifact.ProviderID.make("cloudflare"),
            name: "Cloudflare",
            capabilities: ["static", "server-code", "sqlite", "durable-objects"],
            prompt: "Artifacts deploy to Cloudflare with SQLite and Durable Objects.",
            create: (input) =>
              Effect.sync(() => {
                remoteStore.set(input.id, { ...input.files })
                return { url: `https://cf.example.test/${input.id}/` }
              }),
            read: (id) => Effect.sync(() => remoteStore.get(id) ?? {}),
            update: (id, input) =>
              Effect.sync(() => {
                remoteStore.set(id, { ...input.files })
                return { url: `https://cf.example.test/${id}/` }
              }),
            delete: (id) =>
              Effect.sync(() => {
                remoteStore.delete(id)
              }),
          })
          editor.default.set(Artifact.ProviderID.make("cloudflare"))
        })

        yield* registerToolPlugin(ArtifactTools.Plugin, {
          event: { subscribe: () => Stream.never },
        })
        const snap = yield* registry.snapshot()
        const listings = snap.codeModeCatalog ? codeModeListings(snap.codeModeCatalog) : []
        expect(listings.map((item) => item.path)).toEqual(expect.arrayContaining(toolPaths))
        const rawTools = yield* registry.list()
        const createTool = rawTools.find((item) => item.id === "opencode_artifact_create")
        expect(createTool?.description).toContain(
          "Default provider (cloudflare [static, server-code, sqlite, durable-objects]): Artifacts deploy to Cloudflare with SQLite and Durable Objects.",
        )
        expect(createTool?.description).toContain(
          "Other active providers (pass provider to override): local [static].",
        )

        const createdInfo = (yield* callCodeMode(registry, session.id, "artifact_create", {
          title: "Flamegraph report",
          files: {
            "index.html": "<!doctype html><script src='./assets/app.js'></script>",
            "assets/app.js": "console.log('v1')",
          },
        })) as Artifact.Info

        expect(createdInfo).toMatchObject({
          provider: "cloudflare",
          sessionID: session.id,
          title: "Flamegraph report",
          entry: "index.html",
          url: `https://cf.example.test/${createdInfo.id}/`,
        })

        const content = (yield* callCodeMode(registry, session.id, "artifact_read", {
          id: createdInfo.id,
        })) as Artifact.Content
        expect(Object.keys(content.files).toSorted()).toEqual(["assets/app.js", "index.html"])
        expect(content.files["assets/app.js"]).toBe("console.log('v1')")

        // Per-request provider override ("local") stores independently of default ("cloudflare")
        const localInfo = (yield* callCodeMode(registry, session.id, "artifact_create", {
          title: "Local scratch",
          files: { "index.html": "<h1>Notes</h1>" },
          provider: "local",
        })) as Artifact.Info
        expect(localInfo.provider).toBe(Artifact.LocalProviderID)

        // Update replaces files at the same ID and URL
        const updatedInfo = (yield* callCodeMode(registry, session.id, "artifact_update", {
          id: createdInfo.id,
          files: { "index.html": "<h1>v2</h1>" },
        })) as Artifact.Info
        expect(updatedInfo.url).toBe(createdInfo.url)

        yield* callCodeMode(registry, session.id, "artifact_delete", { id: createdInfo.id })
        expect(yield* artifacts.get(createdInfo.id).pipe(Effect.flip)).toBeInstanceOf(Artifact.NotFoundError)

        // Reject path traversal
        const traversal = yield* artifacts
          .create({
            title: "Bad path",
            files: { "../escape.html": "nope" },
          })
          .pipe(Effect.flip)
        expect(traversal).toBeInstanceOf(Artifact.InvalidError)
      }).pipe(Effect.provide(buildLayer(true, dir)))
    }),
  )

  it.live("keeps numbered versions, restores without rewriting history, prunes the oldest, and publishes item events", () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-artifact-versions-")).path

      yield* Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const bus = yield* Bus.Service
        const kv = yield* KV.Service
        const sessions = yield* Session.Service
        const location = Location.Ref.make({ directory: AbsolutePath.make(dir) })
        const first = yield* sessions.create({ location })
        const second = yield* sessions.create({ location })

        const events = yield* bus
          .subscribe([Artifact.Event.ItemCreated, Artifact.Event.ItemUpdated, Artifact.Event.ItemDeleted])
          .pipe(Stream.take(6), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

        const created = yield* artifacts.create({
          title: "Explainer",
          files: { "index.html": "<h1>v1</h1><script src='./app.js'></script>", "app.js": "window.v = 1" },
          sessionID: first.id,
        })
        expect(created.version).toBe(1)
        yield* artifacts.update(created.id, { files: { "index.html": "<h1>v2</h1>" } })
        const third = yield* artifacts.update(created.id, { title: "Explainer v3", files: { "index.html": "<h1>v3</h1>" } })
        expect(third).toMatchObject({ id: created.id, url: created.url, version: 3, title: "Explainer v3" })

        const versions = yield* artifacts.versions(created.id)
        expect(versions.map((item) => [item.version, item.title])).toEqual([
          [3, "Explainer v3"],
          [2, "Explainer"],
          [1, "Explainer"],
        ])
        expect((yield* artifacts.version(created.id, 1)).files).toEqual({
          "index.html": "<h1>v1</h1><script src='./app.js'></script>",
          "app.js": "window.v = 1",
        })

        // A pinned read serves that version's files; the latest read serves version 3.
        const pinned = yield* artifacts.readLocalFile(created.id, "app.js", 1)
        expect(new TextDecoder().decode(pinned.bytes)).toBe("window.v = 1")
        expect(new TextDecoder().decode((yield* artifacts.readLocalFile(created.id)).bytes)).toBe("<h1>v3</h1>")
        expect(yield* artifacts.readLocalFile(created.id, "app.js").pipe(Effect.flip)).toBeInstanceOf(
          Artifact.FileMissingError,
        )
        expect(yield* artifacts.version(created.id, 9).pipe(Effect.flip)).toBeInstanceOf(Artifact.VersionNotFoundError)

        const restored = yield* artifacts.restore(created.id, 1, second.id)
        expect(restored).toMatchObject({ version: 4, title: "Explainer", sessionID: second.id })
        expect((yield* artifacts.get(created.id)).files["app.js"]).toBe("window.v = 1")
        expect((yield* artifacts.versions(created.id)).map((item) => item.version)).toEqual([4, 3, 2, 1])

        const sessionless = yield* artifacts.create({ title: "Loose", files: { "index.html": "<p>loose</p>" } })
        yield* artifacts.remove(created.id)
        expect(yield* artifacts.versions(created.id).pipe(Effect.flip)).toBeInstanceOf(Artifact.NotFoundError)
        expect(
          yield* Effect.promise(() =>
            fs.stat(path.join(dir, ".data", "artifact-versions", created.id)).then(
              () => true,
              () => false,
            ),
          ),
        ).toBe(false)

        const received = Array.from(yield* Fiber.join(events))
        expect(
          received.map((event) => [
            event.type,
            event.type === "artifact.item.deleted" ? event.data.artifactID : event.data.artifact.id,
            event.type === "artifact.item.deleted" ? event.data.sessionID : event.data.artifact.sessionID,
            event.type === "artifact.item.deleted" ? undefined : event.data.artifact.version,
          ]),
        ).toEqual([
          ["artifact.item.created", created.id, first.id, 1],
          ["artifact.item.updated", created.id, first.id, 2],
          ["artifact.item.updated", created.id, first.id, 3],
          ["artifact.item.updated", created.id, second.id, 4],
          ["artifact.item.created", sessionless.id, undefined, 1],
          ["artifact.item.deleted", created.id, second.id, undefined],
        ])

        // Publishing past the limit drops only the oldest versions.
        yield* Effect.forEach(
          Array.from({ length: Artifact.MaxVersions + 1 }, (_, index) => index + 2),
          (index) => artifacts.update(sessionless.id, { files: { "index.html": `<p>${index}</p>` } }),
          { discard: true },
        )
        const kept = (yield* artifacts.versions(sessionless.id)).map((item) => item.version)
        expect(kept.length).toBe(Artifact.MaxVersions)
        expect(kept[0]).toBe(Artifact.MaxVersions + 2)
        expect(kept.at(-1)).toBe(3)
        expect(new TextDecoder().decode((yield* artifacts.readLocalFile(sessionless.id)).bytes)).toBe(
          `<p>${Artifact.MaxVersions + 2}</p>`,
        )

        // A record stored before versions existed reads as version 1, and its next update is version 2.
        const legacy = yield* artifacts.create({ title: "Legacy", files: { "index.html": "<p>old</p>" } })
        const key = `artifact:item:${legacy.id}`
        const stored = Schema.decodeUnknownSync(
          Schema.Struct({ info: Schema.Record(Schema.String, Schema.Json), directory: Schema.String, projectID: Schema.String }),
        )(yield* kv.get(key))
        const { version: _version, ...withoutVersion } = stored.info
        yield* kv.set(key, { ...stored, info: withoutVersion })
        expect((yield* artifacts.info(legacy.id)).version).toBe(1)
        expect((yield* artifacts.update(legacy.id, { files: { "index.html": "<p>new</p>" } })).version).toBe(2)
      }).pipe(Effect.provide(buildLayer(true, dir)))
    }),
  )
})
