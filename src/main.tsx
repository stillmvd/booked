import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";

import App from "./App";
import { QuickAddWindow } from "./components/QuickAddWindow";
import { warmMediaPaths } from "./lib/api";
import { backfillThumbs, loadThumbs } from "./lib/thumbs";
import { watchFocusModality } from "./lib/focusModality";
import { watchGlass } from "./lib/glass";
import "@stillmvd/tauri-ship/ship.css";
import "./styles.css";

const isQuickAdd = getCurrentWindow().label === "quick-add";
const DevNotes = import.meta.env.DEV
  ? React.lazy(() => import("agentation").then((module) => ({ default: module.Agentation })))
  : null;
if (!isQuickAdd) watchGlass();
watchFocusModality(document);

Promise.all([warmMediaPaths(), loadThumbs()])
  .catch(() => undefined)
  .then(() =>
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        {isQuickAdd ? <QuickAddWindow /> : <App />}
        {DevNotes && !isQuickAdd ? (
          <React.Suspense fallback={null}>
            <DevNotes appName="Booked" />
          </React.Suspense>
        ) : null}
      </React.StrictMode>,
    ),
  );

if (!isQuickAdd) {
  window.setTimeout(() => void backfillThumbs(), 4000);
  window.addEventListener("focus", () => void backfillThumbs(true));
}
