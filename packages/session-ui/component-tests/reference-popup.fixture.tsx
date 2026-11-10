import type { LinkPreviewResult } from "@opencode/client/promise"
import { render } from "solid-js/web"
import { ReferencePopup } from "../src/components/reference-popup"
import type { Reference } from "../src/components/reference"

export const requests: string[] = []

// Two reference links and the real popup. `resolve` answers per link, so a test decides what each lookup returns.
export function mountReferencePopup(options: { resolve: (reference: Reference, count: number) => Promise<LinkPreviewResult> }) {
  const host = document.createElement("div")
  host.dataset.testid = "reference-fixture"
  host.style.cssText = "padding: 80px 40px; height: 1200px"
  document.body.appendChild(host)
  requests.length = 0

  render(
    () => (
      <>
        <p>
          <a data-reference href="https://github.com/forge/app/pull/81">
            pull 81
          </a>{" "}
          and{" "}
          <a data-reference href="https://github.com/forge/app/issues/79">
            issue 79
          </a>
        </p>
        <ReferencePopup
          resolve={(reference) => {
            requests.push(JSON.stringify(reference))

            return options.resolve(reference, requests.length)
          }}
        />
      </>
    ),
    host,
  )
}
