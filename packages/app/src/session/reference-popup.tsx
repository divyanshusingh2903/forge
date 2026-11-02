import { lazy, Suspense } from "solid-js"
import type { Reference } from "@opencode/session-ui/reference"
import { useServerSDK } from "@/runtime/server/client"
import type { SessionModel } from "@/session/model"

const ReferencePopup = lazy(() =>
  import("@opencode/session-ui/reference-popup").then((module) => ({ default: module.ReferencePopup })),
)

/** Hover previews for the GitHub, GitLab, Linear and Jira links in the session, looked up where the session runs. */
export function SessionReferencePopup(props: { session: SessionModel }) {
  const sdk = useServerSDK()

  const resolve = (reference: Reference) =>
    sdk.api.linkPreview
      .resolve({
        location: { directory: props.session.data.info()?.location.directory },
        kind: reference.kind,
        ...("tag" in reference
          ? { repository: reference.repository, tag: reference.tag }
          : "number" in reference
            ? { repository: reference.repository, number: reference.number }
            : "site" in reference
              ? { site: reference.site, id: reference.id }
              : { id: reference.id }),
      })
      .then((response) => response.data)

  return (
    <Suspense>
      <ReferencePopup resolve={resolve} />
    </Suspense>
  )
}
