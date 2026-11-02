import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { dict as en } from "./en"

const prefix = "ui.tool.browser."
// A locale writes the plural categories its language needs, so these are checked separately.
const plural = /^ui\.tool\.browser\.read\.elements\.(zero|one|two|few|many|other)$/

const browserKeys = (dict: Record<string, string>) => Object.keys(dict).filter((key) => key.startsWith(prefix))
const fixedKeys = (dict: Record<string, string>) => browserKeys(dict).filter((key) => !plural.test(key)).sort()

const locales = readdirSync(import.meta.dir)
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "en.ts")
  .map((file) => file.replace(/\.ts$/, ""))
  .sort()

describe("browser timeline strings", () => {
  test("finds the locale files", () => {
    expect(locales.length).toBeGreaterThan(50)
  })

  test.each(locales)("%s has every browser key English has", async (locale) => {
    const { dict } = (await import(`./${locale}`)) as { dict: Record<string, string> }
    expect(fixedKeys(dict)).toEqual(fixedKeys(en))
    // Every language needs the catch-all plural form.
    expect(dict["ui.tool.browser.read.elements.other"]).toBeString()
  })
})
