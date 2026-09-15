import { beforeAll, describe, expect, mock, test } from "bun:test"
import { ServerScope } from "@/utils/server-scope"
import { Persist, PersistTesting } from "@/utils/persist"

let getSessionTerminalCacheKey: typeof import("./terminal").getSessionTerminalCacheKey
let getLegacyTerminalStorageKeys: (dir: string, legacySessionID?: string) => string[]
let migrateTerminalState: (value: unknown) => unknown
let destroySessionTerminals: typeof import("./terminal").destroySessionTerminals

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
    useLocation: () => ({}),
    useSearchParams: () => [{}, () => undefined],
  }))
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))
  const mod = await import("./terminal")
  getSessionTerminalCacheKey = mod.getSessionTerminalCacheKey
  getLegacyTerminalStorageKeys = mod.getLegacyTerminalStorageKeys
  migrateTerminalState = mod.migrateTerminalState
  destroySessionTerminals = mod.destroySessionTerminals
})

describe("getSessionTerminalCacheKey", () => {
  test("keys by directory and session id", () => {
    expect(String(getSessionTerminalCacheKey("/repo", "ses_1"))).toBe("local\u0000/repo\u0000ses_1")
  })

  test("differs per session in the same directory", () => {
    expect(String(getSessionTerminalCacheKey("/repo", "ses_1"))).not.toBe(
      String(getSessionTerminalCacheKey("/repo", "ses_2")),
    )
  })

  test("differs per directory for the same session", () => {
    expect(String(getSessionTerminalCacheKey("/repo-a", "ses_1"))).not.toBe(
      String(getSessionTerminalCacheKey("/repo-b", "ses_1")),
    )
  })

  test("differs per server scope", () => {
    expect(String(getSessionTerminalCacheKey("/repo", "ses_1"))).not.toBe(
      String(getSessionTerminalCacheKey("/repo", "ses_1", "ssh:debian" as ServerScope)),
    )
  })
})

describe("getLegacyTerminalStorageKeys", () => {
  test("keeps workspace storage path when no legacy session id", () => {
    expect(getLegacyTerminalStorageKeys("/repo")).toEqual(["/repo/terminal.v1"])
  })

  test("includes legacy session path before workspace path", () => {
    expect(getLegacyTerminalStorageKeys("/repo", "session-123")).toEqual([
      "/repo/terminal/session-123.v1",
      "/repo/terminal.v1",
    ])
  })
})

describe("migrateTerminalState", () => {
  test("drops invalid terminals and restores a valid active terminal", () => {
    expect(
      migrateTerminalState({
        active: "missing",
        all: [
          null,
          { id: "one", title: "Terminal 2" },
          { id: "one", title: "duplicate", titleNumber: 9 },
          { id: "two", title: "logs", titleNumber: 4, rows: 24, cols: 80 },
          { title: "no-id" },
        ],
      }),
    ).toEqual({
      active: "one",
      all: [
        { id: "one", title: "Terminal 2", titleNumber: 2 },
        { id: "two", title: "logs", titleNumber: 4, rows: 24, cols: 80 },
      ],
    })
  })

  test("keeps a valid active id", () => {
    expect(
      migrateTerminalState({
        active: "two",
        all: [
          { id: "one", title: "Terminal 1" },
          { id: "two", title: "shell", titleNumber: 7 },
        ],
      }),
    ).toEqual({
      active: "two",
      all: [
        { id: "one", title: "Terminal 1", titleNumber: 1 },
        { id: "two", title: "shell", titleNumber: 7 },
      ],
    })
  })
})

describe("destroySessionTerminals", () => {
  const seed = (dir: string, sessionID: string, value: { active?: string; all: unknown[] }) => {
    const target = Persist.serverSession(ServerScope.local, dir, sessionID, "terminal")
    PersistTesting.localStorageWithPrefix(target.storage!).setItem(target.key, JSON.stringify(value))
    return target
  }

  const read = (target: { storage?: string; key: string }) =>
    PersistTesting.localStorageWithPrefix(target.storage!).getItem(target.key)

  test("removes the persisted terminal entry for that session", async () => {
    const target = seed("/repo", "ses_destroy_1", { active: "pty_1", all: [{ id: "pty_1", title: "Terminal 1" }] })
    expect(read(target)).not.toBeNull()

    await destroySessionTerminals({ dir: "/repo", sessionID: "ses_destroy_1" })

    expect(read(target)).toBeNull()
  })

  test("leaves other sessions in the same directory untouched", async () => {
    seed("/repo", "ses_destroy_2", { active: "pty_2", all: [{ id: "pty_2", title: "Terminal 1" }] })
    const other = seed("/repo", "ses_destroy_3", { active: "pty_3", all: [{ id: "pty_3", title: "Terminal 1" }] })

    await destroySessionTerminals({ dir: "/repo", sessionID: "ses_destroy_2" })

    expect(read(other)).not.toBeNull()
  })

  test("is safe to call twice for the same session (no cache/sdk, no throw)", async () => {
    const target = seed("/repo", "ses_destroy_4", { active: "pty_4", all: [{ id: "pty_4", title: "Terminal 1" }] })

    await destroySessionTerminals({ dir: "/repo", sessionID: "ses_destroy_4" })
    await destroySessionTerminals({ dir: "/repo", sessionID: "ses_destroy_4" })

    expect(read(target)).toBeNull()
  })

  test("is a no-op for a session that was never persisted", async () => {
    await expect(destroySessionTerminals({ dir: "/repo", sessionID: "ses_never_existed" })).resolves.toBeUndefined()
  })
})
