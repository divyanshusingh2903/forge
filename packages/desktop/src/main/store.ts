import electron from "electron"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { SETTINGS_STORE } from "./store-keys"
import { deleteStoreFileIfEmpty } from "./store-cleanup"

const cache = new Map<string, SettingsStore>()

export type SettingsStore = ReturnType<typeof createSettingsStore>

// The file is the tab-indented JSON object electron-store used to write, so existing profiles (and older
// builds) read the same data. A synchronous whole-file write is acceptable here: these are small settings
// read before the storage layer exists and written on user action.
//
// We cannot instantiate the store at module load time because
// module import hoisting causes this to run before app.setPath("userData", ...)
// in index.ts has executed, which would result in files being written to the default directory
// (e.g. bad: %APPDATA%\@opencode-ai\desktop\opencode.settings vs good: %APPDATA%\io.github.divyanshusingh2903.forge.dev\opencode.settings).
export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const next = createSettingsStore(join(electron.app.getPath("userData"), name))
  cache.set(name, next)
  return next
}

export function createSettingsStore(file: string) {
  let data = read(file)
  const write = () => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(data, null, "\t"))
    renameSync(`${file}.tmp`, file)
  }
  return {
    path: file,
    get store(): Record<string, unknown> {
      return data
    },
    get: (key: string): unknown => data[key],
    has: (key: string) => key in data,
    set: (key: string, value: unknown) => {
      if (value === undefined) throw new TypeError(`Use \`delete()\` to clear values: ${key}`)
      data = { ...data, [key]: value }
      write()
    },
    delete: (key: string) => {
      data = Object.fromEntries(Object.entries(data).filter(([item]) => item !== key))
      write()
    },
    clear: () => {
      data = {}
      write()
    },
  }
}

// A missing file is an empty store. An unreadable one is set aside instead of blocking startup.
function read(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    renameSync(file, `${file}.corrupt`)
    return {}
  }
}

export async function removeStoreFileIfEmpty(name: string) {
  if (await deleteStoreFileIfEmpty(electron.app.getPath("userData"), name)) cache.delete(name)
}

export function removeStoreFile(name: string) {
  rmSync(join(electron.app.getPath("userData"), name), { force: true })
  cache.delete(name)
}
