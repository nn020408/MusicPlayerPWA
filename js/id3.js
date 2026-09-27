// Reads real tag data (title/artist/album + embedded cover art) straight
// from the audio file, used ONLY for the currently playing track — never for
// list rows, since this always costs at least one network read per file.
//
// Uses jsmediatags (loaded via CDN in index.html) rather than a hand-rolled
// parser: a first attempt at parsing ID3 by hand missed real-world tag
// variants (extended headers, unsynchronization, older ID3v2.2 tags), and a
// battle-tested library handles all of that plus MP4/FLAC tags for free.
// jsmediatags does its own efficient range-based reads when given a URL, so
// this still doesn't download whole files.

export function readId3Tags(fileUrl) {
  return new Promise((resolve) => {
    jsmediatags.read(fileUrl, {
      onSuccess: (tag) => {
        const t = (tag && tag.tags) || {};
        let picture = null;
        if (t.picture && t.picture.data && t.picture.data.length) {
          picture = {
            mimeType: t.picture.format || "image/jpeg",
            bytes: new Uint8Array(t.picture.data),
          };
        }
        resolve({
          artist: t.artist || null,
          album: t.album || null,
          title: t.title || null,
          picture,
        });
      },
      onError: () => resolve(null),
    });
  });
}

// ---------- Fast artist-only reader (used by js/indexer.js) ----------
//
// readId3Tags() above (jsmediatags) always downloads the ENTIRE ID3 tag, and
// for most songs that's 10-100+ KB because of embedded cover art — even when
// only the artist is wanted. This reads the tag frame by frame instead: one
// small ranged request for the header and first frames, and when it meets a
// big frame (the artwork) it jumps straight over it rather than downloading
// it. Typically one ~4 KB request per song.
//
// Returns the artist string ("" if the tag genuinely has none), or null when
// this reader can't be sure (not ID3v2.3/2.4, unsynchronised tag, odd frame
// flags, server ignoring Range, too many hops) — callers then fall back to
// readArtistFallback(). Throws on network errors so callers can retry.

function id3Ascii(b, i, n) {
  let s = "";
  for (let k = 0; k < n; k++) s += String.fromCharCode(b[i + k]);
  return s;
}
function id3Synchsafe(b, i) {
  return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
}
function id3U32(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function id3DecodeText(data) {
  if (!data.length) return "";
  const body = data.subarray(1);
  let text;
  if (data[0] === 1) text = new TextDecoder(body[0] === 0xfe && body[1] === 0xff ? "utf-16be" : "utf-16le").decode(body);
  else if (data[0] === 2) text = new TextDecoder("utf-16be").decode(body);
  else if (data[0] === 3) text = new TextDecoder("utf-8").decode(body);
  else text = new TextDecoder("windows-1252").decode(body);
  return text.replace(/^﻿/, "").split("\0").map((s) => s.trim()).filter(Boolean).join("; ");
}

// Reads up to `length` bytes starting at `start`. Stops reading (and cancels
// the rest) once it has enough, so a server that ignores Range and answers
// with the whole file can't make us download it.
async function readByteRange(url, start, length) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal: ctrl.signal });
    if (res.status === 200 && start > 0) {
      const err = new Error("Server ignored Range");
      err.noRange = true;
      throw err;
    }
    if (res.status !== 206 && res.status !== 200) throw new Error("HTTP " + res.status);
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    // 206 means the server honoured the range, so the body is at most
    // `length` bytes: read it to its natural end. Cancelling a stream that's
    // finished but not yet read to the end can tear the connection down, and
    // doing that thousands of times churns connections and invites throttling.
    // Only a 200 (Range ignored, whole file coming) is cut short.
    const bounded = res.status === 206;
    while (bounded || got < length) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
    }
    if (!bounded) reader.cancel().catch(() => {});
    const out = new Uint8Array(Math.min(got, length));
    let off = 0;
    for (const c of chunks) {
      const take = Math.min(c.length, out.length - off);
      out.set(c.subarray(0, take), off);
      off += take;
      if (off >= out.length) break;
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- M4A / MP4 ----------
//
// An M4A is a tree of boxes (size + 4-letter type). The artist lives at
// moov > udta > meta > ilst > "©ART" > data. Like the ID3 reader, this walks
// the tree with small ranged reads and jumps over anything big (the audio
// itself, cover art) instead of downloading it, so a song costs about 2-4
// requests. The general-purpose fallback reads far more and, on a big library,
// is what tips OneDrive into pushing back.

// first: the already-fetched start of the file. Returns the artist ("" if the
// tag has none), or null when the layout isn't what this reader understands.
async function readArtistM4a(url, first) {
  let buf = first;
  let bufStart = 0;
  let requests = 1;

  async function ensure(from, need) {
    if (from >= bufStart && from + need <= bufStart + buf.length) return true;
    if (++requests > 8) return false;
    try {
      buf = await readByteRange(url, from, Math.max(need, 8192));
    } catch (err) {
      if (err.message !== "HTTP 416") throw err; // asked for bytes past the end of the file
      buf = new Uint8Array(0);
    }
    bufStart = from;
    return buf.length >= need;
  }

  // First child box of `type` inside [start, end): { start, end } of its payload.
  async function findBox(start, end, type) {
    let pos = start;
    while (pos + 8 <= end) {
      if (!(await ensure(pos, 16)) && buf.length < pos - bufStart + 8) return null;
      const o = pos - bufStart;
      if (o + 8 > buf.length) return null;
      let size = id3U32(buf, o);
      const name = id3Ascii(buf, o + 4, 4);
      let header = 8;
      if (size === 1) {
        if (o + 16 > buf.length) return null;
        size = id3U32(buf, o + 8) * 4294967296 + id3U32(buf, o + 12);
        header = 16;
      } else if (size === 0) {
        size = end - pos; // runs to the end of its parent
      }
      if (size < header) return null;
      if (name === type) return { start: pos + header, end: Math.min(pos + size, end) };
      pos += size;
    }
    return undefined; // walked the whole range: no such box
  }

  const moov = await findBox(0, Number.MAX_SAFE_INTEGER, "moov");
  if (moov === null) return null;
  if (moov === undefined) return "";
  const udta = await findBox(moov.start, moov.end, "udta");
  if (udta === null) return null;
  if (udta === undefined) return "";
  const meta = await findBox(udta.start, udta.end, "meta");
  if (meta === null) return null;
  if (meta === undefined) return "";
  const ilst = await findBox(meta.start + 4, meta.end, "ilst"); // meta is a "full box": 4 bytes of version/flags first
  if (ilst === null) return null;
  if (ilst === undefined) return "";
  const art = await findBox(ilst.start, ilst.end, "\xa9ART");
  if (art === null) return null;
  if (art === undefined) return "";
  const data = await findBox(art.start, art.end, "data");
  if (!data) return data === null ? null : "";
  const length = data.end - data.start - 8; // 4 bytes type + 4 bytes locale come first
  if (length <= 0) return "";
  if (length > 4096 || !(await ensure(data.start + 8, length))) return null;
  const o = data.start + 8 - bufStart;
  return new TextDecoder("utf-8").decode(buf.subarray(o, o + length)).replace(/\0/g, "").trim();
}

async function readArtistFast(url) {
  let buf;
  try {
    buf = await readByteRange(url, 0, 4096);
  } catch (err) {
    if (err.noRange) return null;
    throw err;
  }
  if (buf.length >= 12 && id3Ascii(buf, 4, 4) === "ftyp") return readArtistM4a(url, buf);
  if (buf.length < 10 || id3Ascii(buf, 0, 3) !== "ID3") return null;
  const version = buf[3];
  const flags = buf[5];
  if (version < 3 || version > 4 || flags & 0x80) return null; // v2.2, or whole-tag unsynchronisation
  const tagEnd = 10 + id3Synchsafe(buf, 6);
  let bufStart = 0;
  let requests = 1;
  let pos = 10;
  if (flags & 0x40) pos += version === 4 ? id3Synchsafe(buf, 10) : id3U32(buf, 10) + 4; // extended header

  // Makes sure buf covers [from, from + need); refetches from `from` if not.
  async function ensure(from, need) {
    if (from >= bufStart && from + need <= bufStart + buf.length) return true;
    if (++requests > 6) return false;
    buf = await readByteRange(url, from, Math.max(need, 8192));
    bufStart = from;
    return buf.length >= need;
  }

  while (pos + 10 <= tagEnd) {
    if (!(await ensure(pos, 10))) return null;
    const off = pos - bufStart;
    const id = id3Ascii(buf, off, 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) return ""; // reached padding: no more frames
    const size = version === 4 ? id3Synchsafe(buf, off + 4) : id3U32(buf, off + 4);
    const frameFlags = (buf[off + 8] << 8) | buf[off + 9];
    if (pos + 10 + size > tagEnd) return null; // corrupt frame size
    if (id === "TPE1") {
      // v2.3: compression/encryption bits. v2.4: compression, encryption, unsynchronisation.
      if (frameFlags & (version === 4 ? 0x000e : 0x00c0)) return null;
      if (size > 4096 || !(await ensure(pos + 10, size))) return null;
      let data = buf.subarray(pos + 10 - bufStart, pos + 10 - bufStart + size);
      if (version === 4 && frameFlags & 0x0001) data = data.subarray(4); // data length indicator
      return id3DecodeText(data);
    }
    pos += 10 + size; // skips big frames like cover art without downloading them
  }
  return "";
}

// For the songs readArtistFast() can't be sure about (M4A, FLAC, ID3v1-only,
// ID3v2.2...). jsmediatags downloads the whole tag, so this stays the
// exception rather than the rule.
function readArtistFallback(url) {
  return new Promise((resolve, reject) => {
    new jsmediatags.Reader(url).setTagsToRead(["artist"]).read({
      onSuccess: (tag) => resolve(((tag && tag.tags && tag.tags.artist) || "").trim()),
      onError: (err) => (err && err.type === "xhr" ? reject(new Error("network")) : resolve("")),
    });
  });
}

export async function readArtist(url) {
  const fast = await readArtistFast(url);
  return fast !== null ? fast : readArtistFallback(url);
}
