import { useState } from "react";
import { SunIcon, MoonIcon } from "./icons";

type Theme = "light" | "dark";

// Mirrors src/web/render.js's themeToggleBtn() script: reads the effective theme
// (explicit attribute, else OS preference) and persists the choice under the same
// "eh-theme" localStorage key so the setting carries over to/from the SSR pages.
function effectiveTheme(): Theme {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") return attr;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export default function ThemeToggle() {
    const [theme, setTheme] = useState<Theme>(() => effectiveTheme());

    const toggle = () => {
        const next: Theme = theme === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try {
            localStorage.setItem("eh-theme", next);
        } catch {
            // localStorage unavailable (private browsing etc.) — theme just won't persist
        }
        setTheme(next);
    };

    return (
        <button className="theme-toggle" type="button" aria-label="Design umschalten" title="Hell/Dunkel" onClick={toggle}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
    );
}
