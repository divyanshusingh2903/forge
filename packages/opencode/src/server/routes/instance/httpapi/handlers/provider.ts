import { ProviderAuth } from "@/provider/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"

import { mapValues } from "remeda"
import { Deferred, Effect, Schema } from "effect"
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

// The default model of a catalog provider never changes for the same converted entry.
const catalogDefaults = new WeakMap<Provider.Info, string>()

function catalogDefault(info: Provider.Info) {
  const cached = catalogDefaults.get(info)
  if (cached !== undefined) return cached
  const value = Provider.defaultModelIDs({ [info.id]: info })[info.id]
  catalogDefaults.set(info, value)
  return value
}

// The encoded response (about 7 MB) only changes when the catalog, the provider filters, the connected
// providers or the stored credentials do. The converted catalog is shared with the provider state of every project
// instance, so its serial identifies the catalog part. Keep the last few serialized bodies.
const encodedResponses = new Map<string, string>()
const encodedResponseLimit = 4
// The desktop asks for the list globally and for every project at once on startup. Concurrent requests for the same
// body wait for one encode instead of each encoding (and holding a browser connection) in parallel.
const encodingResponses = new Map<string, Deferred.Deferred<string>>()

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service
    const authStore = yield* Auth.Service

    const listRaw = Effect.fn("ProviderHttpApi.listRaw")(function* () {
      const entries = yield* listEntries()
      const cached = encodedResponses.get(entries.key)
      if (cached) return HttpServerResponse.text(cached, { contentType: "application/json" })
      const pending = encodingResponses.get(entries.key)
      if (pending) return HttpServerResponse.text(yield* Deferred.await(pending), { contentType: "application/json" })
      const encoding = yield* Deferred.make<string>()
      encodingResponses.set(entries.key, encoding)
      // Finish and publish even if this request goes away, so requests waiting on it are never left hanging.
      const body = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const exit = yield* Effect.exit(encodeList(entries.result))
          encodingResponses.delete(entries.key)
          yield* Deferred.done(encoding, exit)
          const body = yield* exit
          if (encodedResponses.size >= encodedResponseLimit) encodedResponses.delete(encodedResponses.keys().next().value!)
          encodedResponses.set(entries.key, body)
          return body
        }),
      )
      return HttpServerResponse.text(body, { contentType: "application/json" })
    })

    // Encode provider by provider (same field order as ListResult) so the event loop can run other work between.
    const encodeList = Effect.fn("ProviderHttpApi.encodeList")(function* (result: Provider.ListResult) {
      const encodeInfo = Schema.encodeUnknownEffect(Provider.Info)
      const providers: string[] = []
      for (const info of result.all) {
        providers.push(JSON.stringify(yield* encodeInfo(info).pipe(Effect.orDie)))
        yield* Effect.yieldNow
      }
      const rest = yield* Schema.encodeUnknownEffect(
        Schema.Struct({ default: Provider.ListResult.fields.default, connected: Provider.ListResult.fields.connected }),
      )({
        default: result.default,
        connected: result.connected,
      }).pipe(Effect.orDie)
      return `{"all":[${providers.join(",")}],"default":${JSON.stringify(rest.default)},"connected":${JSON.stringify(rest.connected)}}`
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
      // The provider state of this instance has already converted the shared catalog; reuse it read-only.
      const converted = yield* Provider.convertedCatalog(all)
      const entries = mapValues(filtered, (_, key) => ({
        info: converted.catalog[key],
        public: converted.database[key],
      }))
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
            id in connected ? Provider.defaultModelIDs({ [id]: info })[id] : catalogDefault(entries[id].info),
          ]),
        ),
        connected: Object.keys(providers).filter((id) => id in connected || credentials[id]),
      }
      return {
        result,
        key: JSON.stringify([
          converted.serial,
          Object.keys(entries),
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
