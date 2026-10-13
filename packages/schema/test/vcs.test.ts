import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Vcs } from "../src/vcs"

test("optional VCS properties omit undefined on the wire", () => {
  expect(Schema.encodeSync(Vcs.PushInput)({ remote: undefined, setUpstream: true })).toEqual({ setUpstream: true })
  expect(Schema.encodeSync(Vcs.StashCreateInput)({ message: undefined, includeUntracked: false })).toEqual({
    includeUntracked: false,
  })
})

test("stash actions require an explicit selector and immutable object ID", () => {
  const decode = Schema.decodeUnknownSync(Vcs.StashInput)
  expect(decode({ ref: "stash@{12}", oid: "a".repeat(40) })).toEqual({ ref: "stash@{12}", oid: "a".repeat(40) })
  expect(() => decode({ ref: "HEAD", oid: "a".repeat(40) })).toThrow()
  expect(() => decode({ ref: "stash@{0}", oid: "--help" })).toThrow()
})
