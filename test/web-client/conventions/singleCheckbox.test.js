// No single checkbox in the admin menu (Oct 2026): an on/off option is a switch
// (components/ui/Switch.tsx, role="switch"). A checkbox is only for marking rows of
// a list or picking several of a set — those stay checkboxes on purpose.
//
// So every type="checkbox" in the client is either inside the Switch component, in
// hand-rolled switch markup (a `.switch` / `.rd-switch` wrapper), or in one of the
// list files below. A new on/off option fails here: use <Switch> instead.
const { clientSources } = require("../clientSource");

// file -> what the checkboxes there pick (always several things of a list)
const LIST_SELECTION = {
    "components/channels/ArchiveTab.tsx": "archived channels to restore or delete, plus 'select all'",
    "components/channels/ChannelTree.tsx": "channels and categories of the tree for the bulk bar",
    "components/signup/AvailabilityParts.tsx": "the raids a signup is available for",
    "components/ViewAs.tsx": "the roles to view the menu as",
    "pages/EventSeriesPage.tsx": "the dates of a series to skip",
    "pages/kader/ImportModal.tsx": "the members to import",
    "pages/kader/OverviewView.tsx": "rows of the overview for a batch action, plus 'mark all'",
    "pages/kader/PoolView.tsx": "rows of the pool for a batch action, plus 'mark all'",
    "pages/raid-detail/modals/NotifyModal.tsx": "the roles to ping",
    "pages/raid-detail/modals/SoftresModal.tsx": "the instances of the soft reserve",
    "pages/raid-detail/raidplan/ShareModal.tsx": "the bosses on the shared sheet",
    "pages/SignupsPage.tsx": "signup rows for a batch action",
};

const SWITCH_MARKUP = /className=(?:"|\{`)(?:switch|rd-switch)\b|role="switch"/;

describe("single checkboxes", () => {
    const sources = clientSources("", /\.tsx$/);

    it("finds none: every on/off option is a switch", () => {
        const single = [];
        for (const [file, src] of sources) {
            if (file === "components/ui/Switch.tsx" || LIST_SELECTION[file]) continue;
            const lines = src.split("\n");
            lines.forEach((line, i) => {
                if (!line.includes('type="checkbox"')) return;
                const around = lines.slice(Math.max(0, i - 3), i + 2).join("\n");
                if (!SWITCH_MARKUP.test(around)) single.push(`${file}:${i + 1}`);
            });
        }
        expect(single).toEqual([]);
    });

    it("keeps the list of list checkboxes honest: each file still has one", () => {
        const files = new Map(sources);
        for (const file of Object.keys(LIST_SELECTION)) {
            expect([file, (files.get(file) || "").includes('type="checkbox"')]).toEqual([file, true]);
        }
    });
});
