import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App.tsx";
import { applyTheme } from "./theme.ts";
import "./styles.css";

applyTheme();

// Ask the browser to make our localStorage durable so a parent's swimmers + meets aren't
// evicted under storage pressure (mainly protects the web PWA — native WebViews already keep
// localStorage across launches). Fire-and-forget; never blocks startup, harmless if unsupported.
if (navigator.storage?.persist) {
  navigator.storage.persisted?.().then((already) => {
    if (!already) navigator.storage.persist().catch(() => {});
  }).catch(() => {});
}

const rootEl = document.getElementById("root")!;

function showFatal(message: string) {
  // Only take over if the app hasn't rendered (true "blank page" case).
  if (rootEl.childElementCount > 0) return;
  rootEl.innerHTML = `
    <div style="max-width:520px;margin:40px auto;padding:20px;font-family:system-ui,sans-serif;color:#0f2233">
      <h2 style="margin:0 0 8px">Couldn't load the app</h2>
      <p style="color:#6b7c8c">This is usually an out-of-date cached version. Tap the button to refresh.</p>
      <pre style="white-space:pre-wrap;background:#f1f5f9;padding:10px;border-radius:8px;font-size:12px;color:#334">${message}</pre>
      <button id="hardreset" style="border:none;background:#0b3d91;color:#fff;font-weight:700;padding:11px 18px;border-radius:10px;font-size:15px">Refresh app</button>
    </div>`;
  document.getElementById("hardreset")?.addEventListener("click", hardReset);
}

async function hardReset() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
  location.reload();
}

// Self-heal: if a load/asset error leaves the page blank, clear caches once and reload.
window.addEventListener("error", (e) => {
  const msg = (e as ErrorEvent).message || "Load error";
  if (rootEl.childElementCount === 0) {
    if (!sessionStorage.getItem("healed")) {
      sessionStorage.setItem("healed", "1");
      hardReset();
    } else {
      showFatal(msg);
    }
  }
});
window.addEventListener("unhandledrejection", (e) => {
  if (rootEl.childElementCount === 0) showFatal(String((e as PromiseRejectionEvent).reason));
});

registerSW({ immediate: true });

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { err: Error | null }
> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error) {
    console.error("App crashed:", err);
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ maxWidth: 520, margin: "40px auto", padding: 20 }}>
          <h2>Something went wrong</h2>
          <p style={{ color: "#6b7c8c" }}>
            The app hit an error. Reload, or reset its data if it keeps happening.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", background: "#f1f5f9", padding: 10, borderRadius: 8, fontSize: 12 }}>
            {this.state.err.message}
          </pre>
          <button
            onClick={() => location.reload()}
            style={{ border: "none", background: "#0b3d91", color: "#fff", fontWeight: 700, padding: "11px 18px", borderRadius: 10, marginRight: 8 }}
          >
            Reload
          </button>
          <button
            onClick={() => {
              localStorage.clear();
              hardReset();
            }}
            style={{ border: "1.5px solid #c2ccd6", background: "#fff", padding: "11px 18px", borderRadius: 10 }}
          >
            Reset app data
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
