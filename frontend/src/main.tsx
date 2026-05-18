import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Self-host the UI typefaces (Inter + JetBrains Mono) so the app never makes
// a Google Fonts network call. Importing the weights we actually use keeps
// the bundle lean — unused weights are tree-shaken.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

import "./index.css";
import { App } from "./App";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("ssediff: mount node #root not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
