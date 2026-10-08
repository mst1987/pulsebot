// Closing a popover on a click outside (hooks/useDismiss), run for real.
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useDismiss, type DismissOptions } from "./useDismiss";

function Panel({ onClose, options }: { onClose: () => void; options?: DismissOptions }) {
    const box = useRef<HTMLDivElement>(null);
    useDismiss(box, true, onClose, options);
    return (
        <div>
            <div ref={box} data-testid="panel"><input aria-label="Suche" /></div>
            <p data-testid="page">Seite</p>
        </div>
    );
}

describe("useDismiss", () => {
    it("closes on a press outside by default, not inside", () => {
        const onClose = vi.fn();
        render(<Panel onClose={onClose} />);
        fireEvent.mouseDown(screen.getByRole("textbox"));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.mouseDown(screen.getByTestId("page"));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("on click: closes only when the press was outside too, not after selecting text out of the panel", () => {
        const onClose = vi.fn();
        render(<Panel onClose={onClose} options={{ event: "click" }} />);
        // pressed in the search, let go on the page: the click lands outside
        fireEvent.pointerDown(screen.getByRole("textbox"));
        fireEvent.click(screen.getByTestId("page"));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.pointerDown(screen.getByTestId("page"));
        fireEvent.click(screen.getByTestId("page"));
        expect(onClose).toHaveBeenCalledTimes(1);
        // a click without any press (the keyboard) still counts
        fireEvent.click(screen.getByTestId("page"));
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("closes on Escape", () => {
        const onClose = vi.fn();
        render(<Panel onClose={onClose} />);
        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
