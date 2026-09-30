// The content switch in the top bar (#563): one segment for the whole menu,
// a chip on the phone that opens it, a quiet hint while the others are hidden.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../api/session";
import type { ContentInfo } from "../api/session";
import { t } from "../i18n";
import ContentSwitch from "./ContentSwitch";
import ContentVersionProvider from "./ContentVersionProvider";
import { useContentVersion } from "../hooks/useContentVersion";

const INFO: ContentInfo = {
    mainVersion: "forever", hideOtherVersions: false,
    versions: [{ id: "forever", label: "WoW Forever", short: "Forever" }, { id: "tbc", label: "TBC Anniversary", short: "TBC" }],
};

/** What a page reads. */
function Shown() {
    const { version } = useContentVersion();
    return <output data-testid="shown">{version}</output>;
}

function show(info: ContentInfo = INFO) {
    return render(
        <ContentVersionProvider content={info}>
            <ContentSwitch />
            <Shown />
        </ContentVersionProvider>,
    );
}

const segments = () => screen.queryAllByRole("radiogroup", { name: t("shell.content.aria") });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("ContentSwitch", () => {
    it("starts on the main version, each version with its dot", () => {
        show();
        const seg = segments()[0];
        expect(within(seg).getByRole("radio", { name: "Forever" })).toHaveAttribute("aria-checked", "true");
        expect(within(seg).getByRole("radio", { name: "TBC" }).querySelector(".ver-dot.ver-tbc")).not.toBeNull();
        expect(screen.getByTestId("shown")).toHaveTextContent("forever");
    });

    it("switches the whole menu and remembers the pick in this browser", async () => {
        const user = userEvent.setup();
        const view = show();
        await user.click(within(segments()[0]).getByRole("radio", { name: "TBC" }));
        expect(screen.getByTestId("shown")).toHaveTextContent("tbc");
        expect(localStorage.getItem("eh-content-version")).toBe("tbc");
        view.unmount();
        show();
        expect(screen.getByTestId("shown")).toHaveTextContent("tbc");
    });

    it("falls back to the main version when the remembered one is no longer offered", () => {
        localStorage.setItem("eh-content-version", "classic");
        show();
        expect(screen.getByTestId("shown")).toHaveTextContent("forever");
    });

    it("opens the segment from the chip on a phone", async () => {
        const user = userEvent.setup();
        show();
        const chip = screen.getByRole("button", { name: t("shell.content.chipAria", { version: "WoW Forever" }) });
        expect(chip).toHaveAttribute("aria-expanded", "false");
        expect(segments()).toHaveLength(1);
        await user.click(chip);
        expect(chip).toHaveAttribute("aria-expanded", "true");
        expect(segments()).toHaveLength(2);
        await user.click(within(segments()[1]).getByRole("radio", { name: "TBC" }));
        expect(screen.getByTestId("shown")).toHaveTextContent("tbc");
        // picking closes the panel again
        expect(segments()).toHaveLength(1);
    });

    it("stays away with a single version", () => {
        show({ ...INFO, versions: [INFO.versions[0]] });
        expect(segments()).toHaveLength(0);
        expect(screen.queryByRole("button")).toBeNull();
    });

    it("leaves only a quiet hint while the other versions are hidden, whatever was picked", () => {
        localStorage.setItem("eh-content-version", "tbc");
        const { container } = show({ ...INFO, hideOtherVersions: true, versions: [INFO.versions[0]] });
        expect(segments()).toHaveLength(0);
        expect(container.querySelector(".cswitch-quiet")).toHaveTextContent("Forever");
        expect(screen.getByTestId("shown")).toHaveTextContent("forever");
    });

    it("reads the session again on refresh (after the settings changed)", async () => {
        vi.spyOn(session, "getSession").mockResolvedValue({
            user: null, csrfToken: null, areas: [], guilds: [], activeGuildId: "",
            content: { ...INFO, hideOtherVersions: true, versions: [INFO.versions[0]] },
        });
        function Refresh() {
            const { refresh } = useContentVersion();
            return <button type="button" onClick={() => void refresh()}>refresh</button>;
        }
        const user = userEvent.setup();
        const { container } = render(
            <ContentVersionProvider content={INFO}><ContentSwitch /><Refresh /></ContentVersionProvider>,
        );
        expect(segments()).toHaveLength(1);
        await user.click(screen.getByRole("button", { name: "refresh" }));
        await waitFor(() => expect(segments()).toHaveLength(0));
        expect(container.querySelector(".cswitch-quiet")).not.toBeNull();
    });

    it("renders nothing without session content", () => {
        const { container } = render(<ContentVersionProvider content={null}><ContentSwitch /></ContentVersionProvider>);
        expect(container).toBeEmptyDOMElement();
    });
});
