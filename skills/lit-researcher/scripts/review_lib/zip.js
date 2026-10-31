// Minimal ZIP reader/writer built on the browser's native Compression/DecompressionStream.
// No dependencies. Enough of the spec to round-trip .xlsx files written by Excel,
// Numbers, LibreOffice and openpyxl (including Zip64 entries).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;

function findEocd(view) {
  const max = Math.min(view.byteLength, 0xffff + 22);
  for (let i = 22; i <= max; i++) {
    const at = view.byteLength - i;
    if (view.getUint32(at, true) === SIG_EOCD) return at;
  }
  throw new Error('Not a zip file (no end-of-central-directory record found).');
}

// Zip64 sizes live in an extra field with header id 0x0001, in a fixed order,
// but only for the values that were saturated to 0xFFFFFFFF in the fixed header.
function readZip64Extra(view, start, length, needs) {
  let at = start;
  const end = start + length;
  while (at + 4 <= end) {
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    if (id === 0x0001) {
      let p = at + 4;
      const out = {};
      for (const key of needs) {
        if (p + 8 > at + 4 + size) break;
        out[key] = Number(view.getBigUint64(p, true));
        p += 8;
      }
      return out;
    }
    at += 4 + size;
  }
  return {};
}

/**
 * Read every entry of a zip archive.
 * @returns {Promise<Map<string, Uint8Array>>} path -> raw bytes, in archive order.
 */
export async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);

  let count = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);

  // Zip64: the real values sit in a separate record pointed at by the locator.
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && view.getUint32(locator, true) === SIG_EOCD64_LOCATOR) {
      const eocd64 = Number(view.getBigUint64(locator + 8, true));
      if (view.getUint32(eocd64, true) === SIG_EOCD64) {
        count = Number(view.getBigUint64(eocd64 + 32, true));
        cdOffset = Number(view.getBigUint64(eocd64 + 48, true));
      }
    }
  }

  const decoder = new TextDecoder();
  const files = new Map();
  let at = cdOffset;

  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(at + 10, true);
    let compressedSize = view.getUint32(at + 20, true);
    let uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    const needs = [];
    if (uncompressedSize === 0xffffffff) needs.push('uncompressedSize');
    if (compressedSize === 0xffffffff) needs.push('compressedSize');
    if (localOffset === 0xffffffff) needs.push('localOffset');
    if (needs.length) {
      const z64 = readZip64Extra(view, at + 46 + nameLength, extraLength, needs);
      if (z64.uncompressedSize !== undefined) uncompressedSize = z64.uncompressedSize;
      if (z64.compressedSize !== undefined) compressedSize = z64.compressedSize;
      if (z64.localOffset !== undefined) localOffset = z64.localOffset;
    }

    at += 46 + nameLength + extraLength + commentLength;

    // Directory entries carry no payload.
    if (name.endsWith('/')) continue;

    if (view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error(`Corrupt zip entry: ${name}`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      files.set(name, raw.slice());
    } else if (method === 8) {
      files.set(name, await inflateRaw(raw));
    } else {
      throw new Error(`Unsupported compression method ${method} for ${name}`);
    }
  }

  return files;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Write a zip archive.
 * @param {Iterable<[string, Uint8Array]>} entries path -> bytes, written in iteration order.
 * @returns {Promise<Uint8Array>}
 */
export async function zip(entries, when = new Date()) {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name);
    const utf8Flag = nameBytes.some((b) => b > 0x7f) ? 0x0800 : 0;
    const sum = crc32(data);

    // Tiny payloads compress to more than they started as.
    let method = 8;
    let payload = data.length < 64 ? data : await deflateRaw(data);
    if (payload.length >= data.length) {
      method = 0;
      payload = data;
    }

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, SIG_LOCAL, true);
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, utf8Flag, true);
    localView.setUint16(8, method, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, sum, true);
    localView.setUint32(18, payload.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, payload);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cd.buffer);
    cdView.setUint32(0, SIG_CENTRAL, true);
    cdView.setUint16(4, 20, true); // version made by
    cdView.setUint16(6, 20, true); // version needed
    cdView.setUint16(8, utf8Flag, true);
    cdView.setUint16(10, method, true);
    cdView.setUint16(12, time, true);
    cdView.setUint16(14, date, true);
    cdView.setUint32(16, sum, true);
    cdView.setUint32(20, payload.length, true);
    cdView.setUint32(24, data.length, true);
    cdView.setUint16(28, nameBytes.length, true);
    cd.set(nameBytes, 46);
    cdView.setUint32(42, offset, true);
    central.push(cd);

    offset += local.length + payload.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cd of central) {
    chunks.push(cd);
    cdSize += cd.length;
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, SIG_EOCD, true);
  eocdView.setUint16(8, central.length, true);
  eocdView.setUint16(10, central.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, cdOffset, true);
  chunks.push(eocd);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
