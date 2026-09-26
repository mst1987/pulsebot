// Runs before every client test file (vitest.config.ts): the jest-dom
// matchers (toBeInTheDocument, toHaveTextContent, ...), the browser APIs jsdom
// lacks, and an unmount of whatever a test rendered, so the next test starts
// with an empty document.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has <dialog> but not its methods; components/ui/Modal.tsx opens every
// dialog with showModal(). Open/close just toggle the attribute, and Escape in
// an open modal fires a cancelable "cancel" (then closes), like a browser.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
    const escHandlers = new WeakMap<HTMLDialogElement, (e: KeyboardEvent) => void>();
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
        this.setAttribute("open", "");
        if (escHandlers.has(this)) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || !this.open) return;
            const cancel = new Event("cancel", { cancelable: true });
            if (this.dispatchEvent(cancel)) this.close();
        };
        escHandlers.set(this, onKey);
        this.ownerDocument.addEventListener("keydown", onKey);
    };
    HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
        this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, value?: string) {
        if (value !== undefined) this.returnValue = value;
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
    };
}

// ThemeToggle asks for the system theme; jsdom has no matchMedia.
if (typeof window !== "undefined" && !window.matchMedia) {
    window.matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
    });
}

afterEach(() => {
    cleanup();
    try {
        window.localStorage.clear();
        window.sessionStorage.clear();
    } catch {
        // no storage - nothing to clear
    }
});
