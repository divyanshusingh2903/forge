import { resolve, type Info, type Resolved } from "../../src/cli/mini/config"
import { MiniKeybind } from "../../src/cli/mini/keybind"

type ResolvedInput = Omit<Info, "keybinds"> & {
  keybinds?: Partial<MiniKeybind.Keybinds>
}

export function createMiniResolvedKeybinds(input: Partial<MiniKeybind.Keybinds> = {}): Resolved["keybinds"] {
  return resolve({ keybinds: input }).keybinds
}

export function createMiniResolvedConfig(input: ResolvedInput = {}): Resolved {
  return resolve(input)
}
