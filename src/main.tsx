import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";

import App from "./App";
import { QuickAddWindow } from "./components/QuickAddWindow";
import "./styles.css";

const isQuickAdd = getCurrentWindow().label === "quick-add";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isQuickAdd ? <QuickAddWindow /> : <App />}</React.StrictMode>,
);
