import { LinkPreview } from "@opencode/schema/link-preview"
import { Location } from "@opencode/schema/location"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const LinkPreviewGroup = HttpApiGroup.make("server.linkPreview")
  .add(
    HttpApiEndpoint.post("linkPreview.resolve", "/api/link-preview", {
      query: LocationQuery,
      payload: LinkPreview.Input,
      success: Location.response(LinkPreview.Result),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "linkPreview.resolve",
          summary: "Preview an issue or pull request",
          description:
            "Look up a GitHub, GitLab, Linear or Jira item for a hover preview, through the gh and glab CLIs or the Location's connected MCP servers.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "linkPreview",
      description: "Location-scoped previews of issue tracker and code host links.",
    }),
  )
