import { IconButton } from "./ui/Button";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { useT } from "../i18n";

// Prev/next pager — mirrors claPager()'s exact text ("Seite X / Y · Z gesamt").
// Shared by the CLA report/log tables and the Historie "Latest Loot" tab, so a
// paged list reads the same wherever it appears. Two chevron icon buttons around
// the mono info line, no ‹/› glyphs.
export default function Pager({ page, onPage }: {
    page: { page: number; totalPages: number; total: number };
    onPage: (p: number) => void;
}) {
    const t = useT();
    if (!page.total) return null;
    return (
        <div className="pager">
            <IconButton size="sm" icon={<ChevronLeftIcon />} tip={t("jobs.pager.prev")} disabled={page.page <= 1} onClick={() => onPage(page.page - 1)} />
            <span className="pager-info">{t("jobs.pager.info", { page: page.page, pages: page.totalPages, total: page.total })}</span>
            <IconButton size="sm" icon={<ChevronRightIcon />} tip={t("jobs.pager.next")} disabled={page.page >= page.totalPages} onClick={() => onPage(page.page + 1)} />
        </div>
    );
}
