import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import PathText from "./PathText";

describe("PathText", () => {
    it("offers a break after every slash and keeps the text whole", () => {
        const { container } = render(<code><PathText text="/api/dashboard/overview" /></code>);
        expect(container.textContent).toBe("/api/dashboard/overview");
        expect(container.querySelectorAll("wbr")).toHaveLength(3);
    });

    it("breaks Windows paths after the backslash", () => {
        const { container } = render(<code><PathText text={"data\\logs\\bot.log"} /></code>);
        expect(container.textContent).toBe("data\\logs\\bot.log");
        expect(container.querySelectorAll("wbr")).toHaveLength(2);
    });

    it("leaves a name without a slash alone", () => {
        const { container } = render(<code><PathText text="node" /></code>);
        expect(container.textContent).toBe("node");
        expect(container.querySelectorAll("wbr")).toHaveLength(0);
    });
});
