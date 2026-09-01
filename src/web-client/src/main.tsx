import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        {/* Served from the site root in dev and in production alike (see
            src/web/staticClient.js), so there is no basename to set. */}
        <BrowserRouter>
            <App />
        </BrowserRouter>
    </StrictMode>,
);
