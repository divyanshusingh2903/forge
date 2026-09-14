import { createSignal } from "solid-js"

const [windowMaximized, setWindowMaximized] = createSignal(false)

window.api.onWindowMaximizedChanged(setWindowMaximized)
void window.api.getWindowMaximized().then(setWindowMaximized)

export { windowMaximized }
