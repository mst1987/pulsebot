import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { langReady } from "./i18n";

// A browser that chose English loads those texts as a chunk of their own
// (i18n/index.ts, #436); drawing only once they are there keeps the first
// frame from showing German. For German this resolves at once.
langReady().then(() => {
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            {/* Served from the site root in dev and in production alike (see
                src/web/staticClient.js), so there is no basename to set. */}
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </StrictMode>,
    );
});
