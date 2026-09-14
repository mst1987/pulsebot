import RaidsPage from "./RaidsPage";

// /raids/new is no page of its own any more: it is the raid list with the
// guided "Neues Raid-Event" dialog open over it (components/RaidCreateDialog.tsx).
// The route stays, so ?source=<id> links and bookmarks keep working.
export default function RaidCreatePage() {
    return <RaidsPage />;
}
