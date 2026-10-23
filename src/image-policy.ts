/** Bounds apply before the browser decodes compressed, untrusted image bytes. */
export const IMAGE_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxPixels: 16_000_000,
  maxDimension: 8192,
  chunkBytes: 192 * 1024,
  timeoutMs: 30_000,
  maxUrlLength: 16_384,
});

export class ImageAcquisitionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ImageAcquisitionError';
    this.code = code;
  }
}

function denied(message: string): never {
  throw new ImageAcquisitionError('IMAGE_ACCESS_DENIED', message);
}
function invalid(message = 'The image has an invalid or incomplete header.'): never {
  throw new ImageAcquisitionError('IMAGE_DECODE_FAILED', message);
}
function unsupported(message = 'Use a PNG, JPEG, GIF, or WebP image.'): never {
  throw new ImageAcquisitionError('UNSUPPORTED_IMAGE', message);
}

function isPublicIpv4(host: string): boolean {
  const [a, b, c] = host.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

function isPublicIpv6(host: string): boolean {
  // URL canonicalizes IPv4-mapped addresses into hexadecimal IPv6 words.
  const halves = host.slice(1, -1).split('::');
  const left = halves[0] ? halves[0].split(':').map(word => parseInt(word, 16)) : [];
  const right = halves[1] ? halves[1].split(':').map(word => parseInt(word, 16)) : [];
  const words = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right] : left;
  // Conservatively accept native global unicast only. This excludes loopback,
  // ULA, link-local, multicast, IPv4 mappings and NAT64/other transition ranges.
  if (words.length !== 8 || words.some(word => !Number.isInteger(word)) || (words[0] & 0xe000) !== 0x2000) return false;
  if (words[0] === 0x2001 && (words[1] <= 0x01ff || words[1] === 0x0db8)) return false;
  if (words[0] === 0x2002 || words[0] === 0x3ffe) return false;
  if (words[0] === 0x3fff && (words[1] & 0xf000) === 0) return false;
  return true;
}

/**
 * Lexical URL checks cannot resolve DNS or prevent DNS rebinding. A public name
 * can resolve to a private address; browser network policy is a further boundary.
 * Callers must also reject redirects rather than following unchecked locations.
 */
export function validateImageUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > IMAGE_LIMITS.maxUrlLength
    || /[\u0000-\u0020\u007f\\]/.test(raw) || !/^https?:\/\//i.test(raw)) {
    throw new ImageAcquisitionError('INVALID_REQUEST', 'The image URL must be a valid absolute HTTP(S) URL.');
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new ImageAcquisitionError('INVALID_REQUEST', 'The image URL is invalid.'); }
  if (url.username || url.password || raw.slice(raw.indexOf('://') + 3).split(/[/?#]/, 1)[0].includes('@')) denied('Image URLs containing credentials are unavailable.');
  if (url.port) denied('Image URLs using non-default ports are unavailable.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) {
    if (!isPublicIpv6(host)) denied('Images from private or reserved network addresses are unavailable.');
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (!isPublicIpv4(host)) denied('Images from private or reserved network addresses are unavailable.');
  } else {
    const labels = host.split('.');
    if (host.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      || /(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test|onion)$/.test(host)
      || host.endsWith('.home.arpa')) denied('Images from local or reserved hostnames are unavailable.');
  }
  url.hash = '';
  if (url.href.length > IMAGE_LIMITS.maxUrlLength) throw new ImageAcquisitionError('INVALID_REQUEST', 'The image URL is too long.');
  return url;
}

export function assertDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) invalid('The image dimensions must be positive whole numbers.');
  if (width > IMAGE_LIMITS.maxDimension || height > IMAGE_LIMITS.maxDimension || width * height > IMAGE_LIMITS.maxPixels) {
    throw new ImageAcquisitionError('IMAGE_TOO_LARGE', 'The image exceeds the 16 megapixel or 8192 pixel dimension limit.');
  }
}

type RasterInfo = { mimeType: string; width: number; height: number; animated: boolean };
const ascii = (bytes: Uint8Array, offset: number, count: number) => String.fromCharCode(...bytes.subarray(offset, offset + count));
const u16le = (b: Uint8Array, n: number) => b[n] | (b[n + 1] << 8);
const u16be = (b: Uint8Array, n: number) => (b[n] << 8) | b[n + 1];
const u24le = (b: Uint8Array, n: number) => b[n] | (b[n + 1] << 8) | (b[n + 2] << 16);
const u32le = (b: Uint8Array, n: number) => (u24le(b, n) + b[n + 3] * 0x1000000) >>> 0;
const u32be = (b: Uint8Array, n: number) => (b[n] * 0x1000000 + (b[n + 1] << 16) + (b[n + 2] << 8) + b[n + 3]) >>> 0;
function need(bytes: Uint8Array, offset: number, length: number, end = bytes.length): void {
  if (offset < 0 || length < 0 || offset + length > end) invalid();
}
function info(mimeType: string, width: number, height: number, animated = false): RasterInfo {
  assertDimensions(width, height);
  return { mimeType, width, height, animated };
}

// CRC validates PNG chunks without allocating another copy of their payloads.
const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc(bytes: Uint8Array, start: number, end: number): number {
  let value = 0xffffffff;
  for (let i = start; i < end; i++) value = CRC_TABLE[(value ^ bytes[i]) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes: Uint8Array): RasterInfo {
  need(bytes, 8, 25);
  if (u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') invalid();
  const result = info('image/png', u32be(bytes, 16), u32be(bytes, 20));
  const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) invalid();
  let offset = 8;
  let imageData = false;
  let animationControl = false;
  while (offset < bytes.length) {
    need(bytes, offset, 12);
    const length = u32be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    need(bytes, offset, length + 12);
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) || crc(bytes, offset + 4, offset + 8 + length) !== u32be(bytes, offset + 8 + length)) invalid();
    if (type === 'IHDR' && offset !== 8) invalid();
    if (type === 'IDAT') imageData = true;
    if (type === 'acTL') {
      if (length !== 8 || animationControl || imageData || u32be(bytes, offset + 8) === 0) invalid();
      animationControl = result.animated = true;
    }
    if (type === 'fcTL') {
      if (!animationControl || length !== 26) invalid();
      const width = u32be(bytes, offset + 12), height = u32be(bytes, offset + 16);
      assertDimensions(width, height);
      if (u32be(bytes, offset + 20) + width > result.width || u32be(bytes, offset + 24) + height > result.height) invalid();
    }
    if (type === 'IEND') {
      if (length !== 0 || !imageData || offset + 12 !== bytes.length) invalid();
      return result;
    }
    offset += length + 12;
  }
  return invalid();
}

function inspectJpeg(bytes: Uint8Array): RasterInfo {
  let offset = 2;
  let result: RasterInfo | undefined;
  let components = 0;
  let scan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid();
    while (bytes[offset] === 0xff) offset++;
    need(bytes, offset, 1);
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!result || !scan || offset !== bytes.length) invalid();
      return result;
    }
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
    if (marker === 0x01) continue;
    need(bytes, offset, 2);
    const length = u16be(bytes, offset);
    if (length < 2) invalid();
    need(bytes, offset, length);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (![0xc0, 0xc1, 0xc2].includes(marker)) unsupported('This JPEG encoding is unsupported.');
      if (result || length < 8) invalid();
      result = info('image/jpeg', u16be(bytes, offset + 5), u16be(bytes, offset + 3));
      components = bytes[offset + 7];
      if (bytes[offset + 2] !== 8 || ![1, 3, 4].includes(components) || length !== 8 + 3 * components) invalid();
    }
    if (marker === 0xda) {
      if (!result || length < 6 || bytes[offset + 2] < 1 || bytes[offset + 2] > components || length !== 6 + 2 * bytes[offset + 2]) invalid();
      scan = true;
      offset += length;
      const start = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        need(bytes, offset, 2);
        if (bytes[offset + 1] === 0 || (bytes[offset + 1] >= 0xd0 && bytes[offset + 1] <= 0xd7)) { offset += 2; continue; }
        break;
      }
      if (offset === start) invalid();
    } else offset += length;
  }
  return invalid();
}

function inspectGif(bytes: Uint8Array): RasterInfo {
  need(bytes, 0, 13);
  const result = info('image/gif', u16le(bytes, 6), u16le(bytes, 8));
  let offset = 13 + ((bytes[10] & 0x80) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
  need(bytes, 0, offset);
  let frames = 0;
  const subBlocks = () => {
    let dataLength = 0;
    while (true) {
      need(bytes, offset, 1);
      const length = bytes[offset++];
      if (length === 0) return dataLength;
      need(bytes, offset, length);
      dataLength += length;
      offset += length;
    }
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) {
      if (!frames || offset !== bytes.length) invalid();
      result.animated = frames > 1;
      return result;
    }
    if (marker === 0x21) {
      need(bytes, offset, 2);
      const label = bytes[offset++];
      if (label === 0xf9) {
        need(bytes, offset, 6);
        if (bytes[offset] !== 4 || bytes[offset + 5] !== 0) invalid();
        offset += 6;
      } else {
        if ((label === 0xff && bytes[offset] !== 11) || (label === 0x01 && bytes[offset] !== 12)
          || ![0xff, 0x01, 0xfe].includes(label)) invalid();
        subBlocks();
      }
    } else if (marker === 0x2c) {
      need(bytes, offset, 9);
      const width = u16le(bytes, offset + 4), height = u16le(bytes, offset + 6), packed = bytes[offset + 8];
      assertDimensions(width, height);
      if (u16le(bytes, offset) + width > result.width || u16le(bytes, offset + 2) + height > result.height || (packed & 0x18)) invalid();
      offset += 9 + ((packed & 0x80) ? 3 * (1 << ((packed & 7) + 1)) : 0);
      need(bytes, offset, 1);
      if (bytes[offset] < 2 || bytes[offset] > 8) invalid();
      offset++;
      if (subBlocks() === 0) invalid();
      frames++;
    } else invalid();
  }
  return invalid();
}

function webpBitstream(bytes: Uint8Array, type: string, start: number, length: number): { width: number; height: number } {
  if (type === 'VP8 ') {
    if (length < 10 || (bytes[start] & 1) || ascii(bytes, start + 3, 3) !== '\u009d\u0001\u002a') invalid();
    const firstPartition = u24le(bytes, start) >>> 5;
    if (firstPartition > length - 10) invalid();
    const width = u16le(bytes, start + 6) & 0x3fff, height = u16le(bytes, start + 8) & 0x3fff;
    assertDimensions(width, height);
    return { width, height };
  }
  if (length < 5 || bytes[start] !== 0x2f || (bytes[start + 4] & 0xe0)) invalid();
  const packed = u32le(bytes, start + 1);
  const width = (packed & 0x3fff) + 1, height = ((packed >>> 14) & 0x3fff) + 1;
  assertDimensions(width, height);
  return { width, height };
}

function inspectWebp(bytes: Uint8Array): RasterInfo {
  need(bytes, 0, 20);
  if (u32le(bytes, 4) + 8 !== bytes.length || (bytes.length & 1)) invalid();
  let result: RasterInfo | undefined;
  let extended = false, animation = false, animationControl = false, stillImages = 0, frames = 0;
  let offset = 12;
  while (offset < bytes.length) {
    need(bytes, offset, 8);
    const type = ascii(bytes, offset, 4), length = u32le(bytes, offset + 4), start = offset + 8;
    need(bytes, start, length + (length & 1));
    if ((length & 1) && bytes[start + length] !== 0) invalid();
    if (offset === 12 && !['VP8X', 'VP8 ', 'VP8L'].includes(type)) invalid();
    if (type === 'VP8X') {
      if (offset !== 12 || length !== 10 || (bytes[start] & 0xc1) || u24le(bytes, start + 1) !== 0) invalid();
      animation = (bytes[start] & 2) !== 0;
      extended = true;
      result = info('image/webp', u24le(bytes, start + 4) + 1, u24le(bytes, start + 7) + 1, animation);
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (animation || stillImages++) invalid();
      const { width, height } = webpBitstream(bytes, type, start, length);
      if (result && (result.width !== width || result.height !== height)) invalid();
      result ??= info('image/webp', width, height);
    } else if (type === 'ANIM') {
      if (!animation || animationControl || frames || length !== 6) invalid();
      animationControl = true;
    } else if (type === 'ANMF') {
      if (!animation || !animationControl || !result || length < 16) invalid();
      const width = u24le(bytes, start + 6) + 1, height = u24le(bytes, start + 9) + 1;
      assertDimensions(width, height);
      if (u24le(bytes, start) * 2 + width > result.width || u24le(bytes, start + 3) * 2 + height > result.height || (bytes[start + 15] & 0xfc)) invalid();
      let sub = start + 16, frameImages = 0;
      while (sub < start + length) {
        need(bytes, sub, 8, start + length);
        const subType = ascii(bytes, sub, 4), subLength = u32le(bytes, sub + 4);
        need(bytes, sub + 8, subLength + (subLength & 1), start + length);
        if (subType === 'VP8 ' || subType === 'VP8L') {
          if (frameImages++) invalid();
          const frame = webpBitstream(bytes, subType, sub + 8, subLength);
          if (frame.width !== width || frame.height !== height) invalid();
        }
        sub += 8 + subLength + (subLength & 1);
      }
      if (frameImages !== 1) invalid();
      frames++;
    } else if (!extended) invalid();
    offset = start + length + (length & 1);
  }
  if (!result || (animation ? !frames : stillImages !== 1)) invalid();
  return result;
}

/** Inspect metadata/container framing only; the browser must still decode pixels. */
export function inspectRaster(bytes: Uint8Array, declaredMime?: string): RasterInfo {
  if (!(bytes instanceof Uint8Array)) throw new ImageAcquisitionError('INVALID_REQUEST', 'Image bytes must be a Uint8Array.');
  if (bytes.length > IMAGE_LIMITS.maxBytes) throw new ImageAcquisitionError('IMAGE_TOO_LARGE', 'The compressed image exceeds 8 MiB.');
  const declared = declaredMime?.split(';', 1)[0].trim().toLowerCase();
  const aliases: Record<string, string> = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/x-png': 'image/png', 'image/apng': 'image/png' };
  const mime = declared ? aliases[declared] ?? declared : '';
  if (mime && mime !== 'application/octet-stream' && !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) unsupported();
  let actual: string;
  let inspect: (bytes: Uint8Array) => RasterInfo;
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === '\u0089PNG\r\n\u001a\n') { actual = 'image/png'; inspect = inspectPng; }
  else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) { actual = 'image/jpeg'; inspect = inspectJpeg; }
  else if (['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) { actual = 'image/gif'; inspect = inspectGif; }
  else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') { actual = 'image/webp'; inspect = inspectWebp; }
  else return unsupported();
  if (mime && mime !== 'application/octet-stream' && mime !== actual) unsupported('The image MIME type does not match its file signature.');
  return inspect(bytes);
}
