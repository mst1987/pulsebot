// A small PNG codec for scripts/fetch-mob-icons.js: 8-bit RGBA, no interlacing (what the Wowhead model thumbnails are),
// decoding, encoding, and the portrait crop. No dependency: only node's zlib. Not a general PNG library.
const zlib = require("zlib");

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodes an 8-bit RGBA (colour type 6) or RGB (2) PNG without interlacing into { width, height, data } (RGBA). */
function decode(buf) {
    if (buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
    let pos = 8;
    let width = 0;
    let height = 0;
    let type = 0;
    const parts = [];
    while (pos + 8 <= buf.length) {
        const len = buf.readUInt32BE(pos);
        const name = buf.toString("latin1", pos + 4, pos + 8);
        const body = buf.subarray(pos + 8, pos + 8 + len);
        if (name === "IHDR") {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            if (body[8] !== 8 || (body[9] !== 6 && body[9] !== 2) || body[12] !== 0) throw new Error("unsupported PNG (need 8-bit RGB/RGBA, not interlaced)");
            type = body[9];
        } else if (name === "IDAT") parts.push(body);
        else if (name === "IEND") break;
        pos += 12 + len;
    }
    const bpp = type === 6 ? 4 : 3;
    const raw = zlib.inflateSync(Buffer.concat(parts));
    const stride = width * bpp;
    if (raw.length < (stride + 1) * height) throw new Error("truncated PNG");
    const out = Buffer.alloc(width * height * 4, 255);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
        for (let i = 0; i < stride; i++) {
            const a = i >= bpp ? line[i - bpp] : 0;
            const b = prev[i];
            const c = i >= bpp ? prev[i - bpp] : 0;
            let add = 0;
            if (filter === 1) add = a;
            else if (filter === 2) add = b;
            else if (filter === 3) add = (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            } else if (filter !== 0) throw new Error("bad PNG filter");
            line[i] = (line[i] + add) & 255;
        }
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            out[o] = line[x * bpp];
            out[o + 1] = line[x * bpp + 1];
            out[o + 2] = line[x * bpp + 2];
            if (bpp === 4) out[o + 3] = line[x * bpp + 3];
        }
        prev = line;
    }
    return { width, height, data: out };
}

let crcTable = null;
function crc32(buf) {
    if (!crcTable) {
        crcTable = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c;
        }
    }
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function chunk(name, body) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(name, 4, "latin1");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
}

/** Encodes { width, height, data } (RGBA) as an 8-bit RGBA PNG (filter 0, deflate level 9). */
function encode(img) {
    const { width, height, data } = img;
    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) data.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** The box round everything that is not (nearly) transparent, or null for an empty picture. */
function alphaBox(img, min = 24) {
    let x0 = img.width;
    let y0 = img.height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            if (img.data[(y * img.width + x) * 4 + 3] < min) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * The square of a model render that makes a good round portrait. An upright figure (clearly taller than wide) is
 * cropped to head and shoulders (the top of the figure, centred on where its top part is); a compact or wide creature
 * (an infernal, a fiend, an elemental) is taken whole. Returns { x, y, size } in pixels of the render.
 */
function portraitRect(img, box = alphaBox(img)) {
    if (!box) return { x: 0, y: 0, size: Math.min(img.width, img.height) };
    let size;
    let x;
    let y;
    if (box.h >= box.w * 1.25) {
        size = Math.round(Math.max(box.h * 0.42, Math.min(box.w * 1.1, box.h * 0.6)));
        y = box.y0 - Math.round(size * 0.04);
        // where the figure is in its upper part: the middle of its opaque pixels in the first `size` rows
        let sum = 0;
        let n = 0;
        for (let yy = box.y0; yy < Math.min(img.height, box.y0 + size); yy++) {
            for (let xx = box.x0; xx <= box.x1; xx++) {
                if (img.data[(yy * img.width + xx) * 4 + 3] >= 24) { sum += xx; n++; }
            }
        }
        x = Math.round((n ? sum / n : box.x0 + box.w / 2) - size / 2);
    } else {
        size = Math.round(Math.max(box.w, box.h) * 1.06);
        x = Math.round(box.x0 + box.w / 2 - size / 2);
        y = Math.round(box.y0 + box.h / 2 - size / 2);
    }
    size = Math.min(size, img.width, img.height);
    return { x: Math.max(0, Math.min(img.width - size, x)), y: Math.max(0, Math.min(img.height - size, y)), size };
}

/** A square of the picture scaled to out x out (area average, alpha weighted so edges stay clean). */
function cropScale(img, rect, out) {
    const res = Buffer.alloc(out * out * 4);
    const k = rect.size / out;
    for (let oy = 0; oy < out; oy++) {
        for (let ox = 0; ox < out; ox++) {
            const sx0 = rect.x + ox * k;
            const sy0 = rect.y + oy * k;
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            let wsum = 0;
            for (let sy = Math.floor(sy0); sy < Math.ceil(sy0 + k); sy++) {
                for (let sx = Math.floor(sx0); sx < Math.ceil(sx0 + k); sx++) {
                    const w = (Math.min(sx + 1, sx0 + k) - Math.max(sx, sx0)) * (Math.min(sy + 1, sy0 + k) - Math.max(sy, sy0));
                    if (w <= 0 || sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
                    const o = (sy * img.width + sx) * 4;
                    const al = img.data[o + 3] / 255;
                    r += img.data[o] * al * w;
                    g += img.data[o + 1] * al * w;
                    b += img.data[o + 2] * al * w;
                    a += al * w;
                    wsum += w;
                }
            }
            const o2 = (oy * out + ox) * 4;
            if (a > 0 && wsum > 0) {
                res[o2] = Math.round(r / a);
                res[o2 + 1] = Math.round(g / a);
                res[o2 + 2] = Math.round(b / a);
                res[o2 + 3] = Math.round((a / wsum) * 255);
            }
        }
    }
    return { width: out, height: out, data: res };
}

module.exports = { decode, encode, alphaBox, portraitRect, cropScale };
