import { ProviderAuth } from "@/provider/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"

import { mapValues } from "remeda"
import { Effect, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProviderAuthApiError } from "../groups/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"

function mapProviderAuthError<A, R>(self: Effect.Effect<A, ProviderAuth.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof ProviderAuth.OauthMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCodeMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCallbackFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: {} })
      }
      if (error instanceof ProviderAuth.ValidationFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: { field: error.field, message: error.message } })
      }
      return new ProviderAuthApiError({ name: "BadRequest", data: {} })
    }),
  )
}

// Converting the models.dev catalog (thousands of models) and validating it into public form costs hundreds of
// milliseconds on the single server thread, and every project directory asks for it again at startup. The
// models.dev provider objects are stable until the catalog refreshes, so keep the conversion per object.
type CatalogEntry = { serial: number; info: Provider.Info; public: Provider.Info; defaultModel: string }
const catalogEntries = new WeakMap<object, CatalogEntry>()
let catalogSerial = 0

function catalogEntry(item: Parameters<typeof Provider.fromModelsDevProvider>[0]) {
  const cached = catalogEntries.get(item)
  if (cached) return cached
  const info = Provider.fromModelsDevProvider(item)
  const entry = {
    serial: ++catalogSerial,
    info,
    public: Provider.toPublicInfo(info),
    defaultModel: Provider.defaultModelIDs({ [info.id]: info })[info.id],
  }
  catalogEntries.set(item, entry)
  return entry
}

// The encoded response (about 7 MB) only changes when the catalog, the provider filters, the connected
// providers or the stored credentials do. The parsed catalog is shared across project instances, so the serials of
// its converted entries identify the catalog part. Keep the last few serialized bodies.
const encodedResponses = new Map<string, string>()
const encodedResponseLimit = 4

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service
    const authStore = yield* Auth.Service

    const listRaw = Effect.fn("ProviderHttpApi.listRaw")(function* () {
      const entries = yield* listEntries()
      const bodies = encodedResponses
      const cached = bodies.get(entries.key)
      if (cached) return HttpServerResponse.text(cached, { contentType: "application/json" })
      // Encode provider by provider (same field order as ListResult) so the event loop can run other work between.
      const encodeInfo = Schema.encodeUnknownEffect(Provider.Info)
      const providers: string[] = []
      for (const info of entries.result.all) {
        providers.push(JSON.stringify(yield* encodeInfo(info).pipe(Effect.orDie)))
        yield* Effect.yieldNow
      }
      const rest = yield* Schema.encodeUnknownEffect(Schema.Struct({ default: Provider.ListResult.fields.default, connected: Provider.ListResult.fields.connected }))({
        default: entries.result.default,
        connected: entries.result.connected,
      }).pipe(Effect.orDie)
      const body = `{"all":[${providers.join(",")}],"default":${JSON.stringify(rest.default)},"connected":${JSON.stringify(rest.connected)}}`
      if (bodies.size >= encodedResponseLimit) bodies.delete(bodies.keys().next().value!)
      bodies.set(entries.key, body)
      return HttpServerResponse.text(body, { contentType: "application/json" })
    })

    const listEntries = Effect.fn("ProviderHttpApi.listEntries")(function* () {
      const config = yield* cfg.get()
      const all = yield* ModelsDev.Service.use((s) => s.get())
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
      const filtered: Record<string, (typeof all)[string]> = {}
      for (const [key, value] of Object.entries(all)) {
        if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) filtered[key] = value
      }
      const connected = yield* provider.list()
      const credentials = yield* authStore.all().pipe(Effect.orDie)
      // Convert in slices: the first call does ~1.5 s of synchronous work, and other requests (the session
      // list the sidebar waits on) should be answered between slices instead of queueing behind all of it.
      const entries: Record<string, ReturnType<typeof catalogEntry>> = {}
      for (const [key, value] of Object.entries(filtered)) {
        entries[key] = catalogEntry(value)
        yield* Effect.yieldNow
      }
      const providers = Object.assign(
        mapValues(entries, (entry) => entry.info),
        connected,
      )
      const connectedPublic = Object.fromEntries(Object.entries(connected).map(([id, info]) => [id, Provider.toPublicInfo(info)]))
      const result = {
        all: Object.keys(providers).map((id) => (id in connected ? connectedPublic[id] : entries[id].public)),
        default: Object.fromEntries(
          Object.entries(providers).map(([id, info]) => [
            id,
            id in connected ? Provider.defaultModelIDs({ [id]: info })[id] : entries[id].defaultModel,
          ]),
        ),
        connected: Object.keys(providers).filter((id) => id in connected || credentials[id]),
      }
      return {
        result,
        key: JSON.stringify([
          Object.values(entries).map((entry) => entry.serial),
          config.enabled_providers,
          config.disabled_providers,
          connectedPublic,
          result.connected,
        ]),
      }
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.AuthorizeInput
    }) {
      return yield* mapProviderAuthError(
        svc.authorize({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          inputs: ctx.payload.inputs,
        }),
      )
    })

    const authorizeRaw = Effect.fn("ProviderHttpApi.authorizeRaw")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.AuthorizeInput))(body).pipe(
        Effect.mapError(() => new ProviderAuthApiError({ name: "BadRequest", data: {} })),
      )
      // Match legacy route behavior: when authorize() resolves without a
      // result (e.g. no further redirect), serialize as JSON `null` instead
      // of an empty body so clients can `.json()` parse the response.
      const result = yield* authorize({ params: ctx.params, payload })
      return HttpServerResponse.jsonUnsafe(result ?? null)
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.CallbackInput
    }) {
      yield* mapProviderAuthError(
        svc.callback({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          code: ctx.payload.code,
        }),
      )
      return true
    })

    return handlers
      .handleRaw("list", listRaw)
      .handle("auth", auth)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
  }),
)
