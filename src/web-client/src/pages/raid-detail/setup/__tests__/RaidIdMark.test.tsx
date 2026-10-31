// One instance per raid ID: a raider placed in another raid of the same
// instance in this ID gets a quiet "ID" after the name - in the groups, on the
// bench and in "Angemeldet" -, the full hint in its tooltip and in the raider
// panel. A raid of this server is named with raid number and day, one of
// another server only as "another raid of this ID". A hint only.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../../api/client";
import type { SetupEditorData, SetupRaidIdTaken } from "../../../../api";
import { t } from "../../../../i18n";
import { formatDayDate } from "../../../../lib/format";
import { switchLang } from "../../../../test/i18n";
import { renderPage } from "../../../../test/render";
import { MAGE, PRIEST, ROGUE, TANK, editorData, person, setupCtx } from "../../../../test/fixtures/setupEditor";
import RaidIdMark from "../RaidIdMark";
import { raidIdText } from "../setupText";
import SetupEditor from "../SetupEditor";

vi.mock("../../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const START = Date.UTC(2026, 11, 9, 19, 0) / 1000;
const LOCAL: SetupRaidIdTaken = { local: true, title: "Hyjal F", raidNo: 1, startTime: START };
const OTHER: SetupRaidIdTaken = { other: true };

afterAll(() => switchLang("de"));

describe("raidIdText", () => {
    it("names a raid of this server with raid number and day", () => {
        expect(raidIdText(LOCAL)).toBe(`ID: schon in Hyjal F · Raid 1 (${formatDayDate(START * 1000)})`);
        expect(raidIdText({ local: true, title: "Hyjal F" })).toBe("ID: schon in Hyjal F");
    });

    it("shows the day in server time, like the raid ID itself (a raid at 00:30)", () => {
        // Thu 05.11. 00:30 in Berlin is still Wed 23:30 in UTC.
        const night = Date.UTC(2026, 10, 4, 23, 30) / 1000;
        expect(raidIdText({ local: true, title: "Hyjal F", startTime: night })).toBe("ID: schon in Hyjal F (Do 05.11.)");
    });

    it("says nothing more about a raid of another server", () => {
        expect(raidIdText(OTHER)).toBe("Schon in einem anderen Raid dieser ID");
    });

    it("is empty without a hint", () => {
        expect(raidIdText(undefined)).toBe("");
    });

    it("speaks English on an English page", async () => {
        await switchLang("en");
        expect(raidIdText(OTHER)).toBe("Already in another raid of this lockout");
        expect(raidIdText({ local: true, title: "Hyjal F", raidNo: 2 })).toBe("Lockout: already in Hyjal F · Raid 2");
        await switchLang("de");
    });
});

describe("RaidIdMark", () => {
    it("draws nothing without a hint", () => {
        const { container } = renderPage(<RaidIdMark taken={undefined} />);
        expect(container.querySelector(".se-raidid")).toBeNull();
    });

    it("is the short word with the hint as tooltip", () => {
        const { container } = renderPage(<RaidIdMark taken={LOCAL} />);
        const mark = container.querySelector(".se-raidid")!;
        expect(mark).toHaveTextContent("ID");
        expect(mark).toHaveAttribute("data-tip", raidIdText(LOCAL));
        expect(mark).toHaveAttribute("data-tip-sub", t("setup.raidId.sub"));
        expect(screen.getByRole("img", { name: raidIdText(LOCAL) })).toBeInTheDocument();
    });
});

describe("in the setup editor", () => {
    let page: SetupEditorData;
    beforeEach(() => {
        vi.mocked(client.get).mockImplementation(() => Promise.resolve(page));
        vi.mocked(client.send).mockImplementation(() => Promise.resolve(page));
    });

    const POOLED = person("u-pool", "Wandler", { raidIdTaken: OTHER, reasons: ["Schon in einem anderen Raid dieser ID"] });

    async function show() {
        page = editorData({}, {
            groups: [
                { index: 1, slots: [{ ...TANK, raidIdTaken: LOCAL, pos: 1 }, { ...MAGE, pos: 2 }] },
                { index: 2, slots: [{ ...PRIEST, pos: 1 }] },
            ],
            bench: [{ ...ROGUE, raidIdTaken: LOCAL }],
            pool: [POOLED],
        });
        const view = renderPage(<SetupEditor ctx={setupCtx()} />);
        await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
        return view;
    }
    const slot = (character: string) => {
        const el = screen.getAllByText(character).map((e) => e.closest<HTMLElement>("[data-user]")).find(Boolean);
        if (!el) throw new Error(`no slot for ${character}`);
        return el;
    };

    it("marks the line in the groups, on the bench and in \"Angemeldet\" - and only there", async () => {
        await show();
        expect(slot("Bruno").querySelector(".se-raidid")).toHaveAttribute("data-tip", raidIdText(LOCAL));
        expect(slot("Schatten").querySelector(".se-raidid")).not.toBeNull();
        expect(slot("Wandler").querySelector(".se-raidid")).toHaveAttribute("data-tip", t("setup.raidId.other"));
        expect(slot("Ignis").querySelector(".se-raidid")).toBeNull();
        expect(slot("Lumen").querySelector(".se-raidid")).toBeNull();
    });

    it("names the hint in the raider panel once, in place of the server's German reason", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(slot("Wandler"));
        const panel = screen.getByRole("complementary", { name: t("setup.person.tip.aria") });
        expect(within(panel).getAllByText(t("setup.raidId.other"))).toHaveLength(1);
        expect(panel.querySelector(".se-tip-raidid")).not.toBeNull();
    });
});
