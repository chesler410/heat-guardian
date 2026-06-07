import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App.tsx";
import "./styles.css";

// Registers <base>/sw.js with the correct scope (respects the /my-swimmer/ base)
// and auto-applies new versions so users never get stuck on a stale cache.
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
