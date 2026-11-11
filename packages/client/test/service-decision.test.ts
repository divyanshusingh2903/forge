import { expect, test } from "bun:test"
import { decide, type LocalService } from "../src/service-probe"

const protocolError =
  "Background service uses an incompatible health protocol. Update this client or explicitly restart the service."

function service(input: Pick<LocalService, "state" | "compatible" | "version"> & { readonly build?: string }) {
  return {
    info: { url: "http://127.0.0.1:4096", pid: 4242, version: input.version, build: input.build },
    endpoint: { url: "http://127.0.0.1:4096" },
    ...input,
  } satisfies LocalService
}

test("a missing health endpoint fails unless the caller requires a different version", () => {
  const missing = service({ version: "2.0.0", state: "ready", compatible: false })
  expect(decide(missing, {})).toEqual({ _tag: "fail", error: new Error(protocolError) })
  expect(decide(missing, { version: "2.0.0" })).toEqual({ _tag: "fail", error: new Error(protocolError) })
  expect(decide(missing, { version: (version) => version.startsWith("2.") })).toEqual({
    _tag: "fail",
    error: new Error(protocolError),
  })
  expect(decide(missing, { version: "3.0.0" })).toEqual({ _tag: "replace", pty: "handoff" })
  expect(decide(service({ state: "ready", compatible: false }), { version: "3.0.0" })).toEqual({
    _tag: "replace",
    pty: "handoff",
  })
})

test("a compatible service is reused when ready, awaited while starting, and fails when it failed", () => {
  expect(decide(service({ version: "2.0.0", state: "ready", compatible: true }), {})).toEqual({ _tag: "reuse" })
  expect(decide(service({ version: "2.0.0", state: "waiting", compatible: true }), { version: "2.0.0" })).toEqual({
    _tag: "wait",
  })
  expect(decide(service({ version: "2.0.0", state: "failed", compatible: true }), {})).toEqual({
    _tag: "fail",
    error: new Error("Background service failed to start"),
  })
})

test("a version mismatch replaces the service, handing off terminals only when it is ready", () => {
  expect(decide(service({ version: "1.0.0", state: "ready", compatible: true }), { version: "2.0.0" })).toEqual({
    _tag: "replace",
    pty: "handoff",
  })
  expect(decide(service({ version: "1.0.0", state: "waiting", compatible: true }), { version: "2.0.0" })).toEqual({
    _tag: "replace",
    pty: "clear",
  })
  expect(decide(service({ version: "1.0.0", state: "failed", compatible: true }), { version: "2.0.0" })).toEqual({
    _tag: "replace",
    pty: "clear",
  })
})

test("a required build is met only by a service that registered it", () => {
  const ready = { version: "2.0.0", state: "ready", compatible: true } as const
  const required = { version: "2.0.0", build: "2.0.0-v0.8.0" }
  expect(decide(service({ ...ready, build: "2.0.0-v0.8.0" }), required)).toEqual({ _tag: "reuse" })
  expect(decide(service({ ...ready, build: "2.0.0-v0.7.5" }), required)).toEqual({ _tag: "replace", pty: "handoff" })
  // The server an older release left running registered no build at all, with the same version.
  expect(decide(service(ready), required)).toEqual({ _tag: "replace", pty: "handoff" })
  expect(decide(service({ ...ready, state: "waiting" }), required)).toEqual({ _tag: "replace", pty: "clear" })
})

test("no required build accepts any build", () => {
  const ready = { version: "2.0.0", state: "ready", compatible: true } as const
  expect(decide(service(ready), { version: "2.0.0" })).toEqual({ _tag: "reuse" })
  expect(decide(service({ ...ready, build: "2.0.0-v0.7.5" }), { version: "2.0.0" })).toEqual({ _tag: "reuse" })
})
