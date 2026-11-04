import { LinkPreview } from "@opencode/core/link-preview"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, response } from "../location"

export const LinkPreviewHandler = HttpApiBuilder.group(Api, "server.linkPreview", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "linkPreview.resolve",
      Effect.fn("server.linkPreview.resolve")(function* (request) {
        // Linear and Jira previews read connected MCP servers, which a cold Location starts with its plugins.
        yield* awaitPlugins
        const preview = yield* LinkPreview.Service
        return yield* response(preview.resolve(request.payload))
      }),
    )
  }),
)
