// The version on the root (#742): <html data-version> follows the content switch,
// a version-neutral page leaves it off, a custom colour from the settings reaches
// the root as variables.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContentInfo } from "../../../api/system/session";
import { t } from "../../../i18n";
import ContentSwitch from "../ContentSwitch";
import ContentVersionProvider from "../ContentVersionProvider";

const INFO: ContentInfo = {
    mainVersion: "forever", hideOtherVersions: false,
    versions: [
        { id: "forever", label: "WoW Forever", short: "Forever", color: "#4da3ff", custom: false },
        { id: "tbc", label: "TBC Anniversary", short: "TBC", color: "#9bd45a", custom: false },
    ],
};
const root = () => document.documentElement;

beforeEach(() => localStorage.clear());
afterEach(() => {
    cleanup();
    root().removeAttribute("data-version");
    root().removeAttribute("style");
});

describe("ContentVersionProvider (#742)", () => {
    it("marks the main version on the root and follows the switch", async () => {
        const user = userEvent.setup();
        render(<ContentVersionProvider content={INFO}><ContentSwitch /></ContentVersionProvider>);
        expect(root().getAttribute("data-version")).toBe("forever");
        const seg = screen.getAllByRole("radiogroup", { name: t("shell.content.aria") })[0];
        await user.click(within(seg).getByRole("radio", { name: "TBC" }));
        expect(root().getAttribute("data-version")).toBe("tbc");
        // the name stays in the switch: colour is never the only sign
        expect(within(seg).getByRole("radio", { name: "TBC" })).toHaveAttribute("aria-checked", "true");
    });

    it("leaves the version off on a neutral page and takes it back when the provider goes", () => {
        const view = render(<ContentVersionProvider content={INFO} neutral><ContentSwitch /></ContentVersionProvider>);
        expect(root().hasAttribute("data-version")).toBe(false);
        view.rerender(<ContentVersionProvider content={INFO}><ContentSwitch /></ContentVersionProvider>);
        expect(root().getAttribute("data-version")).toBe("forever");
        view.unmount();
        expect(root().hasAttribute("data-version")).toBe(false);
    });

    it("writes a custom colour of the settings to the root, the default not", () => {
        const custom: ContentInfo = { ...INFO, versions: [{ ...INFO.versions[0], color: "#aa3377", custom: true }, INFO.versions[1]] };
        render(<ContentVersionProvider content={custom}><ContentSwitch /></ContentVersionProvider>);
        expect(root().style.getPropertyValue("--vc-forever-dark")).toMatch(/^#[0-9a-f]{6}$/);
        expect(root().style.getPropertyValue("--vc-forever-light")).toMatch(/^#[0-9a-f]{6}$/);
        expect(root().style.getPropertyValue("--vc-tbc-dark")).toBe("");
    });

    it("sets nothing without session content", () => {
        render(<ContentVersionProvider><div /></ContentVersionProvider>);
        expect(root().hasAttribute("data-version")).toBe(false);
    });
});
