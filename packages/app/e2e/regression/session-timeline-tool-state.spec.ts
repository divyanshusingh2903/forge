import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("updates web search links without resetting expansion", async ({ page }) => {
  const searchID = "prt_websearch_mutation"
  const input = { query: "timeline stability" }
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([toolPart(searchID, "websearch", "completed", input, { output: "https://example.com/one" })]),
    ],
  })
  const wrapper = page.locator(`[data-timeline-part-id="${searchID}"]`)
  const trigger = wrapper.locator('[data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await timeline.send(
    partUpdated(
      toolPart(searchID, "websearch", "completed", input, {
        output: "https://example.com/one\nhttps://example.com/two",
      }),
    ),
    300,
  )
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(wrapper.locator('a[href="https://example.com/two"]')).toBeVisible()
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await timeline.send(
    partUpdated(
      toolPart(searchID, "websearch", "completed", input, {
        output: "https://example.com/one\nhttps://example.com/two\nhttps://example.com/three",
      }),
    ),
    300,
  )
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
})

test("shows fetched text and preserves disclosure across output updates", async ({ page }) => {
  const fetchID = "prt_webfetch_text"
  const input = { url: "https://example.com/page.png", format: "text" }
  const output = "Image fetched successfully"
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([toolPart(fetchID, "webfetch", "completed", input, { output })])],
  })
  const wrapper = page.locator(`[data-timeline-part-id="${fetchID}"]`)
  const trigger = wrapper.locator('[data-slot="collapsible-trigger"]')
  const response = wrapper.locator('[data-component="tool-response"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(response.getByRole("region")).toHaveText(output)
  await expect(wrapper.getByRole("link", { name: input.url, exact: true })).toHaveAttribute("href", input.url)
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(response).toBeHidden()
  await timeline.send(partUpdated(toolPart(fetchID, "webfetch", "completed", input, { output: "Updated page content" })))
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(response.getByRole("region")).toHaveText("Updated page content")
})

test("previews long fetched HTML as literal text and expands the full response", async ({ page }) => {
  const fetchID = "prt_webfetch_long"
  const output = '<script>alert("not executed")</script>\n' + "Fetched page content.\n".repeat(1200) + "End of page"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(fetchID, "webfetch", "completed", { url: "https://example.com/page", format: "html" }, { output }),
      ]),
    ],
  })
  const wrapper = page.locator(`[data-timeline-part-id="${fetchID}"]`)
  const response = wrapper.locator('[data-component="tool-response"]')
  await expect(response.getByRole("region")).toHaveText(output.slice(0, 20_000))
  await expect(response.locator("script")).toHaveCount(0)
  await response.getByRole("button", { name: "Show all", exact: true }).click()
  await expect(response.getByRole("region")).toHaveText(output)
  await response.getByRole("button", { name: "Show less", exact: true }).click()
  await expect(response.getByRole("region")).toHaveText(output.slice(0, 20_000))
})

test("keeps image attachments and empty fetches without response disclosure", async ({ page }) => {
  const imageID = "prt_webfetch_image"
  const emptyID = "prt_webfetch_empty"
  const input = { url: "https://example.com/image" }
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        {
          ...toolPart(imageID, "webfetch", "completed", input),
          state: {
            status: "completed",
            input,
            output: "Image fetched successfully",
            title: "Fetched image",
            metadata: {},
            time: { start: 1700000001000, end: 1700000002000 },
            attachments: [
              {
                id: "prt_webfetch_attachment",
                sessionID: "ses_timeline_stability",
                messageID: "msg_1001_timeline_assistant",
                type: "file",
                mime: "image/png",
                url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
              },
            ],
          },
        },
        toolPart(emptyID, "webfetch", "completed", { url: "https://example.com/empty" }, { output: " \n\t" }),
      ]),
    ],
  })
  for (const id of [imageID, emptyID]) {
    const wrapper = page.locator(`[data-timeline-part-id="${id}"]`)
    await expect(wrapper.getByRole("link")).toBeVisible()
    await expect(wrapper.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("data-hide-details", "true")
    await expect(wrapper.locator('[data-component="tool-response"]')).toHaveCount(0)
  }
})

test("preserves an expanded tool error card across duplicate delivery", async ({ page }) => {
  const toolID = "prt_duplicate_error"
  const failed = toolPart(toolID, "bash", "error", { command: "exit 1" }, { error: "Command failed visibly" })
  const timeline = await setupTimeline(page, { messages: [userMessage(), assistantMessage([failed])] })
  const wrapper = page.locator(`[data-timeline-part-id="${toolID}"]`)
  const trigger = wrapper.locator('[data-slot="collapsible-trigger"]')
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await timeline.send(partUpdated(failed), 150)
  await timeline.send(partUpdated(failed), 250)
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(wrapper).toContainText("Command failed visibly")
})

test("renders multiple question answers and preserves open state on answer updates", async ({ page }) => {
  const questionID = "prt_multi_question"
  const input = {
    questions: [
      { header: "First", question: "First choice?", options: [] },
      { header: "Second", question: "Second choice?", options: [], multiple: true },
    ],
  }
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(questionID, "question", "completed", input, { metadata: { answers: [["A"], ["B", "C"]] } }),
      ]),
    ],
  })
  const wrapper = page.locator(`[data-timeline-part-id="${questionID}"]`)
  const trigger = wrapper.locator('[data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await timeline.send(
    partUpdated(
      toolPart(questionID, "question", "completed", input, { metadata: { answers: [["Updated"], ["B", "C"]] } }),
    ),
    300,
  )
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(wrapper).toContainText("Updated")
  await expect(wrapper).toContainText("B, C")
})
