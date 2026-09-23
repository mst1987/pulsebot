import { locale, t } from "../../../i18n";
import { MAP_MAX_EDGE, MAP_TARGET_BYTES, attempts, formatBytes, isMapType, needsCompression, outputType, renamedFor, scaledSize } from "../../../lib/mapImage";

export type PreparedMap = { file: File; /** what was done, for the toast ("4,8 MB -> 1,9 MB, 2560x1600"), "" = sent as it is */ note: string };

/** Turns the canvas into a file (null when the browser cannot write that type). */
function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
}

/**
 * The file to upload as a room map. A small file is returned untouched. A big one
 * (over 2.8 MB, or longer than 2560 px) is drawn on a canvas at most 2560 px on
 * the long edge and written as WebP (transparency stays; JPEG when the browser
 * cannot write WebP) with a falling quality until it fits under the limit, and a
 * smaller picture as the last resort. Throws an Error with a readable message when
 * the file is no accepted image or cannot be brought under the limit.
 */
export async function prepareMapFile(file: File): Promise<PreparedMap> {
    if (!isMapType(file.type)) throw new Error(t("raidBoard.board.mapNotImage"));
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error(t("raidBoard.board.mapUnreadable"));
    }
    try {
        if (!needsCompression(file.size, bitmap.width, bitmap.height)) return { file, note: "" };
        const base = scaledSize(bitmap.width, bitmap.height, MAP_MAX_EDGE);
        const canvas = document.createElement("canvas");
        let type = outputType(true);
        for (const step of attempts()) {
            const w = Math.max(1, Math.round(base.width * step.factor));
            const h = Math.max(1, Math.round(base.height * step.factor));
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error(t("raidBoard.board.mapUnreadable"));
            // JPEG has no alpha: paint the board's dark background under it
            if (type === "image/jpeg") { ctx.fillStyle = "#0f1115"; ctx.fillRect(0, 0, w, h); }
            ctx.drawImage(bitmap, 0, 0, w, h);
            let blob = await encode(canvas, type, step.quality);
            if (blob && blob.type !== type && type === "image/webp") {
                // the browser fell back to PNG: it cannot write WebP, use JPEG from here on
                type = outputType(false);
                ctx.fillStyle = "#0f1115"; ctx.fillRect(0, 0, w, h); ctx.drawImage(bitmap, 0, 0, w, h);
                blob = await encode(canvas, type, step.quality);
            }
            if (blob && blob.size <= MAP_TARGET_BYTES) {
                const out = new File([blob], renamedFor(file.name, blob.type || type), { type: blob.type || type });
                return { file: out, note: t("raidBoard.board.mapCompressed", { from: formatBytes(file.size, locale()), to: formatBytes(out.size, locale()), w, h }) };
            }
        }
        throw new Error(t("raidBoard.board.mapCannotShrink"));
    } finally {
        bitmap.close();
    }
}
