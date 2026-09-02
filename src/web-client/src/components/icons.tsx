// Inline SVGs ported 1:1 from src/web/renderAdmin.js (CREST_SVG, BURGER_SVG,
// NAV_ICONS) and src/web/render.js (theme toggle SUN/MOON), as JSX components.

export function CrestIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <path d="M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4Z" />
            <path d="m9 12 2 2 4-4" strokeLinecap="round" />
        </svg>
    );
}

export function BurgerIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
    );
}

export function SunIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
    );
}

export function MoonIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
    );
}

export function HomeIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="3" width="7" height="9" rx="1.5" />
            <rect x="14" y="3" width="7" height="5" rx="1.5" />
            <rect x="14" y="12" width="7" height="9" rx="1.5" />
            <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
    );
}

export function RecruitmentIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M19 8v6M22 11h-6" />
        </svg>
    );
}

export function ClaIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v16a2 2 0 0 0 2 2h16" />
            <path d="m7 14 3-4 3 3 4-6" />
        </svg>
    );
}

export function RaidsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
    );
}

export function ChannelsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
        </svg>
    );
}

export function SettingsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
    );
}

// Not from renderAdmin.js — added for the raid-detail hero header's time line.
export function ClockIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3.5 2" />
        </svg>
    );
}

export function RosterIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
            <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
            <path d="M17 4.6a3.5 3.5 0 0 1 0 6.8" />
            <path d="M18.5 14.2A6.5 6.5 0 0 1 21.5 20" />
        </svg>
    );
}

// How much a raider has already been given — a loot bag, next to the count.
export function LootBagIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 9h14l-1.2 10.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8Z" />
            <path d="M9 9V6.5a3 3 0 0 1 6 0V9" />
        </svg>
    );
}

// An equip slot with nothing in it — better news for a drop than any item.
export function EmptySlotIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" strokeDasharray="3 2.5" />
            <path d="M12 9v6M9 12h6" />
        </svg>
    );
}

// Loot council: a scale, for weighing who a drop should go to.
export function CouncilIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v16" />
            <path d="M6 20h12" />
            <path d="M4 7h16" />
            <path d="M4 7 1.5 13a3 3 0 0 0 5 0Z" />
            <path d="M20 7l2.5 6a3 3 0 0 1-5 0Z" />
            <path d="M12 4a1.5 1.5 0 1 0 0-.01Z" />
        </svg>
    );
}

export function HistoryIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v5h5" />
            <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
            <path d="M12 7v5l3 2" />
        </svg>
    );
}

/** A big drop — the treasure chest on the dashboard's "Latest Loot" card. */
export function LootIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 5 5.5h14l2 5" />
            <rect x="3" y="10.5" width="18" height="8" rx="1.5" />
            <path d="M3 14h18" />
            <path d="M10.5 10.5h3v4h-3z" />
        </svg>
    );
}

/** Jump straight to an action — the "Schnellzugriff" card's bolt. */
export function BoltIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2.5 4.5 13.5H11l-.5 8L19 10.5h-6.5l.5-8Z" />
        </svg>
    );
}

// ---- action icons ----
// Buttons that do something (rather than navigate) carry one of these instead
// of the emoji labels the raid page used to mix into its text. They all share
// the 24-box + currentColor of the nav icons, so .btn svg can size them once.

/** Start an analysis (CLA/RPB) — a play triangle in a ring. */
export function RunIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M10 8.5v7l5.5-3.5-5.5-3.5Z" />
        </svg>
    );
}

export function SearchIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.6-3.6" />
        </svg>
    );
}

export function LinkIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.1" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.1" />
        </svg>
    );
}

export function TrashIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M10 11v6M14 11v6" />
            <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
    );
}

/** Opens something outside the current page (report, sheet, WCL). */
export function ExternalIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 4h6v6" />
            <path d="M20 4 11 13" />
            <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
        </svg>
    );
}

/** A spreadsheet — replaces the 📄 the sheet buttons carried. */
export function SheetIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
            <path d="M3.5 9.5h17M3.5 15h17M9.5 3.5v17" />
        </svg>
    );
}

/** Post into a Discord channel — replaces the 📤. */
export function SendIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 3 10.5 13.5" />
            <path d="M21 3l-6.8 18-3.7-7.5L3 9.8 21 3Z" />
        </svg>
    );
}

/** Remove/dismiss — the ✕ of a removable chip, sized by its button. */
export function XIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6 6 18" />
        </svg>
    );
}

/** Update something that already exists — replaces the 🔄. */
export function RefreshIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 11a8 8 0 0 0-13.7-5.3L3 9" />
            <path d="M4 13a8 8 0 0 0 13.7 5.3L21 15" />
            <path d="M3 4v5h5M21 20v-5h-5" />
        </svg>
    );
}

/* ---- signup status (Anwesenheit): one glyph per reaction, drawn in the
   status colour by .sig-ico — the list codes a status by icon, never by a
   filled background. ---- */

/** Signed up — the checkmark. */
export function SignedIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4 12.5 5 5L20 6.5" />
        </svg>
    );
}

/** Signed off (Absence) — a crossed-out circle. */
export function AbsenceIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M6.4 6.4 17.6 17.6" />
        </svg>
    );
}

/** Bench — a seat, for a raider held in reserve. */
export function BenchIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11h18M3 15h18" />
            <path d="M5 7v12M19 7v12" />
        </svg>
    );
}

/** Tentative — the question mark of an undecided answer. */
export function TentativeIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.3 9.2a2.8 2.8 0 0 1 5.4.9c0 1.9-2.7 2.3-2.7 4" />
            <path d="M12 17.4h.01" strokeWidth="2.6" />
        </svg>
    );
}

/** Late — a clock, for "coming, but not on time". */
export function LateIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5.3l3.3 2" />
        </svg>
    );
}
