import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        {/* Production is served under /admin2/ (see src/web/staticClient.js); the Vite
            dev server serves the app at its own root, so no basename is needed there. */}
        <BrowserRouter basename={import.meta.env.DEV ? "/" : "/admin2"}>
            <App />
        </BrowserRouter>
    </StrictMode>,
);
