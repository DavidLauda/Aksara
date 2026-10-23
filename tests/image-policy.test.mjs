import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { IMAGE_LIMITS, ImageAcquisitionError, validateImageUrl, assertDimensions, inspectRaster } from '../src/image-policy.ts';

function fails(code, fn) {
  assert.throws(fn, error => error instanceof ImageAcquisitionError && error.code === code);
}
const ascii = text => Buffer.from(text, 'latin1');
const be32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
const le32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
const le24 = value => Buffer.from([value & 255, (value >>> 8) & 255, (value >>> 16) & 255]);

function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const body = Buffer.concat([ascii(type), data]);
  return Buffer.concat([be32(data.length), body, be32(crc(body))]);
}
function png(width = 2, height = 3, extra = []) {
  const header = Buffer.concat([be32(width), be32(height), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([ascii('\x89PNG\r\n\x1a\n'), pngChunk('IHDR', header), ...extra,
    pngChunk('IDAT', deflateSync(Buffer.alloc(1 + 4 * 2))), pngChunk('IEND', Buffer.alloc(0))]);
}
function jpeg(width = 2, height = 3, progressive = false) {
  return Buffer.from([0xff, 0xd8,
    0xff, 0xe0, 0, 4, 0, 0,
    0xff, progressive ? 0xc2 : 0xc0, 0, 11, 8, height >>> 8, height & 255, width >>> 8, width & 255, 1, 1, 0x11, 0,
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0,
    0x12, 0xff, 0, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9]);
}
function gif(width = 2, height = 3, frames = 1) {
  const header = Buffer.concat([ascii('GIF89a'), Buffer.from([width & 255, width >>> 8, height & 255, height >>> 8, 0x80, 0, 0]), Buffer.alloc(6)]);
  const frame = Buffer.from([0x2c, 0, 0, 0, 0, width & 255, width >>> 8, height & 255, height >>> 8, 0, 2, 2, 0x44, 1, 0]);
  return Buffer.concat([header, ...Array.from({ length: frames }, () => frame), Buffer.from([0x3b])]);
}
function webpChunk(type, data) {
  return Buffer.concat([ascii(type), le32(data.length), data, ...(data.length & 1 ? [Buffer.from([0])] : [])]);
}
function webp(...chunks) {
  const body = Buffer.concat([ascii('WEBP'), ...chunks]);
  return Buffer.concat([ascii('RIFF'), le32(body.length), body]);
}
function lossless(width = 2, height = 3) {
  return webpChunk('VP8L', Buffer.concat([Buffer.from([0x2f]), le32((width - 1) | ((height - 1) << 14))]));
}
function lossy(width = 2, height = 3) {
  return webpChunk('VP8 ', Buffer.from([0x30, 0, 0, 0x9d, 1, 0x2a, width & 255, width >>> 8, height & 255, height >>> 8, 0]));
}
function extended(width = 2, height = 3, animation = false) {
  return webpChunk('VP8X', Buffer.concat([Buffer.from([animation ? 2 : 0, 0, 0, 0]), le24(width - 1), le24(height - 1)]));
}

test('public URLs canonicalize and fragments never reach image acquisition', () => {
  assert.equal(validateImageUrl('HTTPS://Example.COM:443/pic.png?q=1#secret').href, 'https://example.com/pic.png?q=1');
  assert.equal(validateImageUrl('http://8.8.8.8:80/pic').host, '8.8.8.8');
  assert.equal(validateImageUrl('https://0x08080808/pic').host, '8.8.8.8');
  assert.equal(validateImageUrl('https://[2001:4860:4860::8888]/pic').hostname, '[2001:4860:4860::8888]');
  assert.equal(validateImageUrl('https://cdn.example.com./pic').hostname, 'cdn.example.com.');
});

test('rejects ambiguous URLs, credentials, special protocols, and non-default ports', () => {
  for (const raw of ['', '/relative.png', 'https:example.com/pic', 'file:///tmp/pic', 'data:image/png;base64,AA==',
    'blob:https://example.com/abc', ' https://example.com/pic', 'https://example.com/with space', 'https://exa\nmple.com/',
    'https://example.com\\@127.0.0.1/pic', 'https://' ]) fails('INVALID_REQUEST', () => validateImageUrl(raw));
  for (const raw of ['https://user:pass@example.com/pic', 'https://@example.com/pic', 'https://example.com:8443/pic', 'http://example.com:443/pic']) {
    fails('IMAGE_ACCESS_DENIED', () => validateImageUrl(raw));
  }
  fails('INVALID_REQUEST', () => validateImageUrl(`https://example.com/${'a'.repeat(IMAGE_LIMITS.maxUrlLength)}`));
});

test('canonical IP checks catch decimal, hex, octal and abbreviated private IPv4', () => {
  for (const host of ['127.1', '2130706433', '0x7f000001', '0177.0.0.1', '0x7f.1', '%31%32%37.0.0.1', '127.0.0.1.',
    '0.0.0.0', '10.20.30.40', '100.64.0.1', '100.127.255.255', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.0.0.9', '192.0.2.1', '192.88.99.1', '192.168.0.1', '198.18.0.1', '198.19.1.1', '198.51.100.1',
    '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255']) {
    fails('IMAGE_ACCESS_DENIED', () => validateImageUrl(`https://${host}/pic`));
  }
  for (const host of ['100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '198.17.255.255', '198.20.0.0']) {
    assert.equal(validateImageUrl(`https://${host}/pic`).hostname, host);
  }
});

test('rejects local names and non-global IPv6 including mapped IPv4 and documentation ranges', () => {
  for (const host of ['localhost', 'LOCALHOST.', 'a.localhost', 'my-machine', 'printer.local', 'a.local.', 'a.home.arpa',
    'a.internal', 'a.test', 'a.invalid', 'example..com', '-bad.example.com',
    '[::]', '[::1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::ffff:8.8.8.8]', '[fc00::1]', '[fd00::1]',
    '[fe80::1]', '[ff02::1]', '[64:ff9b::7f00:1]', '[2001:db8::1]', '[2001:20::1]', '[2002:7f00:1::]',
    '[3ffe::1]', '[3fff:fff::1]']) {
    fails('IMAGE_ACCESS_DENIED', () => validateImageUrl(`https://${host}/pic`));
  }
});

test('pixel and compressed byte limits reject allocations before decoding', () => {
  assert.doesNotThrow(() => assertDimensions(4000, 4000));
  assert.doesNotThrow(() => assertDimensions(8192, 1));
  for (const dimensions of [[0, 1], [-1, 1], [NaN, 1], [Infinity, 1], [1.5, 2], ['2', 3]]) {
    fails('IMAGE_DECODE_FAILED', () => assertDimensions(...dimensions));
  }
  for (const dimensions of [[8193, 1], [1, 8193], [4001, 4000]]) fails('IMAGE_TOO_LARGE', () => assertDimensions(...dimensions));
  fails('IMAGE_TOO_LARGE', () => inspectRaster(new Uint8Array(IMAGE_LIMITS.maxBytes + 1)));
  fails('INVALID_REQUEST', () => inspectRaster([1, 2, 3]));
});

test('PNG inspects dimensions and APNG animation while validating framing and CRC', () => {
  assert.deepEqual(inspectRaster(png(), 'IMAGE/PNG; charset=binary'), { mimeType: 'image/png', width: 2, height: 3, animated: false });
  const control = pngChunk('acTL', Buffer.concat([be32(2), be32(0)]));
  assert.equal(inspectRaster(png(2, 3, [control]), 'image/apng').animated, true);
  fails('IMAGE_TOO_LARGE', () => inspectRaster(png(8193, 1)));
  fails('IMAGE_TOO_LARGE', () => inspectRaster(png(5000, 5000)));
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(png(0, 3)));
  const corrupt = png(); corrupt[29] ^= 1;
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(corrupt));
  for (const length of [8, 24, 32, png().length - 1]) fails('IMAGE_DECODE_FAILED', () => inspectRaster(png().subarray(0, length)));
  const truncatedChunk = Buffer.concat([png().subarray(0, 33), be32(0xffffffff), ascii('IDAT')]);
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(truncatedChunk));
});

test('JPEG reads baseline/progressive frame dimensions and handles stuffed bytes/restart markers', () => {
  for (const progressive of [false, true]) assert.deepEqual(inspectRaster(jpeg(25, 19, progressive)), { mimeType: 'image/jpeg', width: 25, height: 19, animated: false });
  fails('IMAGE_TOO_LARGE', () => inspectRaster(jpeg(9000, 1)));
  fails('IMAGE_TOO_LARGE', () => inspectRaster(jpeg(5000, 5000)));
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(jpeg(0, 1)));
  for (const length of [2, 7, 16, jpeg().length - 1, jpeg().length - 2]) fails('IMAGE_DECODE_FAILED', () => inspectRaster(jpeg().subarray(0, length)));
  const badLength = jpeg(); badLength[5] = 1;
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(badLength));
  const repeatedFrame = Buffer.concat([jpeg().subarray(0, 21), jpeg().subarray(8)]);
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(repeatedFrame));
});

test('GIF checks logical canvas and frame bounds, distinguishes animation, and requires complete subblocks', () => {
  assert.deepEqual(inspectRaster(gif()), { mimeType: 'image/gif', width: 2, height: 3, animated: false });
  assert.equal(inspectRaster(gif(2, 3, 2)).animated, true);
  fails('IMAGE_TOO_LARGE', () => inspectRaster(gif(5000, 5000)));
  fails('IMAGE_TOO_LARGE', () => inspectRaster(gif(9000, 1)));
  const outOfCanvas = gif(); outOfCanvas[20] = 1;
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(outOfCanvas));
  for (const length of [6, 12, 18, gif().length - 1, gif().length - 2]) fails('IMAGE_DECODE_FAILED', () => inspectRaster(gif().subarray(0, length)));
  const badSubblock = gif(); badSubblock[30] = 255;
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(badSubblock));
});

test('WebP supports VP8, VP8L and VP8X and compares encoded dimensions to the canvas', () => {
  for (const bytes of [webp(lossy()), webp(lossless()), webp(extended(), lossless())]) {
    assert.deepEqual(inspectRaster(bytes), { mimeType: 'image/webp', width: 2, height: 3, animated: false });
  }
  fails('IMAGE_TOO_LARGE', () => inspectRaster(webp(lossless(9000, 1))));
  fails('IMAGE_TOO_LARGE', () => inspectRaster(webp(extended(5000, 5000), lossless(5000, 5000))));
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(webp(extended(1, 1), lossless())));
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(webp(extended())));
  const badVersion = webp(lossless()); badVersion[24] = 0xe0;
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(badVersion));
  const badStartCode = webp(lossy()); badStartCode[23] = 0;
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(badStartCode));
  const hugeChunk = webp(lossless()); hugeChunk.writeUInt32LE(0xffffffff, 16);
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(hugeChunk));
  const original = webp(lossless());
  for (const length of [12, 19, original.length - 1]) fails('IMAGE_DECODE_FAILED', () => inspectRaster(original.subarray(0, length)));
});

test('animated WebP validates ANMF nested payload and prevents a small canvas hiding a large frame', () => {
  const anim = webpChunk('ANIM', Buffer.alloc(6));
  const frame = (width, height, payload = lossless(width, height)) => webpChunk('ANMF', Buffer.concat([
    le24(0), le24(0), le24(width - 1), le24(height - 1), le24(100), Buffer.from([0]), payload]));
  assert.deepEqual(inspectRaster(webp(extended(2, 3, true), anim, frame(2, 3))), { mimeType: 'image/webp', width: 2, height: 3, animated: true });
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(webp(extended(2, 3, true), anim, frame(3, 3))));
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(webp(extended(2, 3, true), anim, frame(2, 3, lossless(1, 1)))));
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(webp(extended(2, 3, true), anim, frame(2, 3, Buffer.from([1, 2])))));
  fails('IMAGE_DECODE_FAILED', () => inspectRaster(webp(extended(2, 3, true), frame(2, 3))));
});

test('MIME declarations cannot disguise SVG, HTML, or a mismatched raster signature', () => {
  for (const bytes of [ascii('<svg width="1" height="1"></svg>'), ascii('<html>hello'), new Uint8Array(), ascii('not an image')]) {
    fails('UNSUPPORTED_IMAGE', () => inspectRaster(bytes, 'image/png'));
  }
  for (const declared of ['image/jpeg', 'text/html', 'image/svg+xml', 'image/avif']) fails('UNSUPPORTED_IMAGE', () => inspectRaster(png(), declared));
  assert.equal(inspectRaster(png(), 'application/octet-stream').mimeType, 'image/png');
  assert.equal(inspectRaster(jpeg(), 'image/jpg').mimeType, 'image/jpeg');
});

test('real encoded PNG, JPEG, GIF and WebP files interoperate with raster inspection', async t => {
  const width = 17, height = 13;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      pixels[offset] = x * 15;
      pixels[offset + 1] = y * 19;
      pixels[offset + 2] = (x * 13 + y * 23) & 255;
      pixels[offset + 3] = (x * 31 + y * 7) & 255;
    }
  }
  const source = () => sharp(pixels, { raw: { width, height, channels: 4 } });
  const cases = [
    ['PNG with alpha', 'image/png', () => source().png().toBuffer()],
    ['baseline JPEG', 'image/jpeg', () => source().removeAlpha().jpeg({ progressive: false }).toBuffer()],
    ['progressive JPEG', 'image/jpeg', () => source().removeAlpha().jpeg({ progressive: true }).toBuffer()],
    ['single frame GIF', 'image/gif', () => source().gif().toBuffer()],
    ['lossy WebP', 'image/webp', () => source().removeAlpha().webp({ lossless: false }).toBuffer()],
    ['lossless WebP', 'image/webp', () => source().removeAlpha().webp({ lossless: true }).toBuffer()],
    ['WebP with alpha', 'image/webp', () => source().webp({ lossless: false }).toBuffer()],
  ];
  for (const [name, mimeType, encode] of cases) {
    await t.test(name, async () => {
      const encoded = await encode();
      // Verify the fixture exercises its intended bitstream/container branch.
      if (name === 'baseline JPEG') assert.ok(encoded.includes(Buffer.from([0xff, 0xc0])));
      if (name === 'progressive JPEG') assert.ok(encoded.includes(Buffer.from([0xff, 0xc2])));
      if (name === 'lossy WebP') assert.equal(encoded.toString('ascii', 12, 16), 'VP8 ');
      if (name === 'lossless WebP') assert.equal(encoded.toString('ascii', 12, 16), 'VP8L');
      if (name === 'WebP with alpha') {
        assert.equal(encoded.toString('ascii', 12, 16), 'VP8X');
        assert.ok(encoded.includes(ascii('ALPH')));
      }
      assert.deepEqual(inspectRaster(encoded, mimeType), { mimeType, width, height, animated: false });
    });
  }
});
