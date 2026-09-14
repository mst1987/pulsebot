import { IconButton } from "./ui/Button";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

// Prev/next pager — mirrors claPager()'s exact text ("Seite X / Y · Z gesamt").
// Shared by the CLA report/log tables and the Historie "Latest Loot" tab, so a
// paged list reads the same wherever it appears. Two chevron icon buttons around
// the mono info line, no ‹/› glyphs.
export default function Pager({ page, onPage }: {
    page: { page: number; totalPages: number; total: number };
    onPage: (p: number) => void;
}) {
    if (!page.total) return null;
    return (
        <div className="pager">
            <IconButton size="sm" icon={<ChevronLeftIcon />} tip="Zurück" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)} />
            <span className="pager-info">Seite {page.page} / {page.totalPages} · {page.total} gesamt</span>
            <IconButton size="sm" icon={<ChevronRightIcon />} tip="Weiter" disabled={page.page >= page.totalPages} onClick={() => onPage(page.page + 1)} />
        </div>
    );
}
