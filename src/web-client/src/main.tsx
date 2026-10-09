import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { langReady } from "./i18n";
import { installPreloadErrorReload } from "./lib/app/chunkReload";
import { installWowheadTooltipLift } from "./lib/wow/wowheadTooltips";

// A deploy removes the chunks of the previous build; a tab opened before it
// reloads once instead of going blank (#530, lib/app/chunkReload.ts).
installPreloadErrorReload();

// Wowhead's item tooltip shows above an open modal (lib/wow/wowheadTooltips.ts).
installWowheadTooltipLift();

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
