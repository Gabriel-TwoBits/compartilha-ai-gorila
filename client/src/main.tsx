// Smooths over cross-browser WebRTC inconsistencies; partytracks expects it.
import "webrtc-adapter"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./index.css"

const container = document.getElementById("root")
if (container === null) {
  throw new Error("missing #root element in index.html")
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
