import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const staticRoot = new URL("../../windows/static/", import.meta.url);
const qrSource = await readFile(new URL("qr-encoder.js", staticRoot), "utf8");

// The library is a browser script, so it is run as one. The only DOM it may
// touch is createElementNS, and only from inside svg() — a stub that records
// what was set is enough to check the element a phone camera would be shown.
function stubElement(namespace, tag) {
  return {
    namespace, tag, attributes: {}, children: [],
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    appendChild(child) { this.children.push(child); return child; },
  };
}

function loadQr() {
  const created = [];
  const context = {
    console,
    window: {},
    document: {
      createElementNS(namespace, tag) {
        const el = stubElement(namespace, tag);
        created.push(el);
        return el;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(qrSource, context);
  return {qr: context.window.LinguaQR, created};
}

test("the library claims one name and reads no DOM until it is asked to draw", () => {
  const {qr, created} = loadQr();
  assert.deepEqual(Object.keys(qr).sort(), ["_matrix", "svg"]);
  assert.equal(created.length, 0, "loading the script must not build elements");
});

test("a short room code is a version 1 symbol inside its quiet zone", () => {
  const {qr} = loadQr();
  const svg = qr.svg("HELLO");
  assert.equal(svg.tag, "svg");
  assert.equal(svg.namespace, "http://www.w3.org/2000/svg");
  // 21 modules (version 1) plus a 2-module quiet zone on each side.
  assert.equal(svg.getAttribute("viewBox"), "0 0 25 25");
  assert.equal(svg.getAttribute("width"), "100", "25 modules at the default 4px");
  assert.equal(svg.getAttribute("height"), "100");
});

test("the drawing is a single path that inherits the page's text color", () => {
  const {qr} = loadQr();
  const svg = qr.svg("HELLO");
  assert.equal(svg.children.length, 1);
  const [path] = svg.children;
  assert.equal(path.tag, "path");
  assert.equal(path.getAttribute("fill"), "currentColor");
  assert.ok(path.getAttribute("d").length > 0, "the path carries the dark modules");
});

test("module size and quiet zone are the caller's to set", () => {
  const {qr} = loadQr();
  const svg = qr.svg("HELLO", 8, 4);
  assert.equal(svg.getAttribute("viewBox"), "0 0 29 29", "21 modules plus 4 either side");
  assert.equal(svg.getAttribute("width"), "232");
});

test("a room link outgrows version 1 without ever becoming even", () => {
  const {qr} = loadQr();
  const link = "https://relay.example.com/room/" + "a".repeat(119);
  assert.equal(link.length, 150);
  const span = Number(qr.svg(link).getAttribute("viewBox").split(" ")[3]);
  const modules = span - 4; // default quiet zone of 2 on each side
  assert.ok(modules > 21, `a 150-character link needs more than version 1, got ${modules}`);
  assert.equal(modules % 2, 1, "every QR version is an odd number of modules across");
});

test("the three finder corners are dark in both the matrix and the path", () => {
  const {qr} = loadQr();
  const matrix = qr._matrix("HELLO");
  assert.equal(matrix.length, 21);
  for (const [x, y] of [[0, 0], [20, 0], [0, 20]]) {
    assert.equal(matrix[y][x], true, `finder corner ${x},${y} is dark`);
  }
  // The same three modules, offset by the quiet zone, must be in the path.
  const d = qr.svg("HELLO").children[0].getAttribute("d");
  for (const [x, y] of [[0, 0], [20, 0], [0, 20]]) {
    assert.ok(d.includes(`M${x + 2},${y + 2}h1v1h-1z`), `path draws ${x},${y}`);
  }
});

// ---------------------------------------------------------------------------
// Independent verification: nothing below reuses the library's own tables. The
// symbol is decoded back the way a scanner does it — read the format bits, undo
// the mask, walk the placement, parse the segment, then check the error
// correction bytes are a valid Reed-Solomon codeword. A wrong mask or a broken
// generator polynomial scans on one phone and fails on the next; this is the
// check that would catch it before a phone does.
// ---------------------------------------------------------------------------

const REFERENCE_TEXT = "https://example.com/";

// Verified by the decode below before it was written down.
const REFERENCE_MATRIX = [
  "1111111011001111001111111",
  "1000001000101111001000001",
  "1011101011001011101011101",
  "1011101011110011001011101",
  "1011101000010011101011101",
  "1000001010101101001000001",
  "1111111010101010101111111",
  "0000000010011010000000000",
  "0101011110011101111101101",
  "1000110110110000001000001",
  "0101101001111000100010011",
  "1101010010001101100010000",
  "1110001011011010111001011",
  "0011110101101000011101101",
  "1001101110001110111110101",
  "0110000010100101100010010",
  "1110001101000001111111100",
  "0000000011001111100011001",
  "1111111010110001101011011",
  "1000001011010110100011110",
  "1011101001111000111111001",
  "1011101010000111000111100",
  "1011101001001100000110101",
  "1000001010011100111001000",
  "1111111001011111111100011",
];

function alignmentPositions(version, size) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let p = size - 7; positions.length < count; p -= step) positions.splice(1, 0, p);
  return positions;
}

// Which cells the QR spec reserves, worked out from the spec rather than read
// off the encoder: timing lines, the three finder blocks with their separators
// and format areas, the alignment patterns, and (version 7+) the version blocks.
function functionModules(size) {
  const version = (size - 17) / 4;
  const reserved = Array.from({length: size}, () => new Array(size).fill(false));
  const mark = (x, y) => { if (0 <= x && x < size && 0 <= y && y < size) reserved[y][x] = true; };
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) mark(x, y);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 8; x++) mark(size - 1 - x, y);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) mark(x, size - 1 - y);
  const positions = alignmentPositions(version, size);
  for (const cx of positions) for (const cy of positions) {
    const onFinder = (cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6);
    if (onFinder) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(cx + dx, cy + dy);
  }
  if (version >= 7) for (let i = 0; i < 18; i++) {
    mark(size - 11 + i % 3, Math.floor(i / 3));
    mark(Math.floor(i / 3), size - 11 + i % 3);
  }
  return reserved;
}

function maskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    default: throw new Error(`no such mask ${mask}`);
  }
}

function readFormatInformation(matrix) {
  const size = matrix.length;
  const bit = (x, y) => (matrix[y][x] ? 1 : 0);
  let first = 0, second = 0;
  for (let i = 0; i <= 5; i++) first |= bit(8, i) << i;
  first |= bit(8, 7) << 6;
  first |= bit(8, 8) << 7;
  first |= bit(7, 8) << 8;
  for (let i = 9; i < 15; i++) first |= bit(14 - i, 8) << i;
  for (let i = 0; i < 8; i++) second |= bit(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) second |= bit(8, size - 15 + i) << i;
  return {first, second};
}

test("the format information is a valid BCH word naming a real level and mask", () => {
  const {qr} = loadQr();
  const matrix = qr._matrix(REFERENCE_TEXT);
  const {first, second} = readFormatInformation(matrix);
  assert.equal(first, second, "both copies of the format information agree");

  const unmasked = first ^ 0x5412;
  const payload = unmasked >>> 10; // 2 bits of ECC level, 3 bits of mask
  let remainder = payload;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  assert.equal(unmasked & 0x3FF, remainder & 0x3FF, "BCH(15,5) check bits are correct");

  const level = payload >>> 3;
  const mask = payload & 7;
  assert.ok(level >= 0 && level <= 3, `error correction level ${level} exists`);
  assert.ok(mask >= 0 && mask <= 7, `mask ${mask} is one of the eight`);
  // Requested LOW; the library boosts the level while the version still fits,
  // exactly as the upstream encodeText does. QUARTILE is what version 2 allows.
  assert.equal(level, 3, "formatBits 3 is QUARTILE, boosted up from the requested LOW");
});

test("the symbol decodes back to the text it was given", () => {
  const {qr} = loadQr();
  const matrix = qr._matrix(REFERENCE_TEXT);
  const size = matrix.length;
  assert.equal(size, 25, "a 20-character URL is a version 2 symbol");

  const reserved = functionModules(size);
  let free = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!reserved[y][x]) free++;
  assert.equal(free, 359, "version 2 carries 359 data modules per the spec");

  // Timing lines alternate, and all three finders are a 7x7 ring-in-ring.
  for (let i = 8; i < size - 8; i++) {
    assert.equal(matrix[6][i], i % 2 === 0, `horizontal timing at ${i}`);
    assert.equal(matrix[i][6], i % 2 === 0, `vertical timing at ${i}`);
  }
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      assert.equal(matrix[oy + dy][ox + dx], ring !== 2, `finder ${ox},${oy} cell ${dx},${dy}`);
    }
  }

  let dark = 0;
  for (const row of matrix) for (const cell of row) if (cell) dark++;
  const ratio = dark / (size * size);
  assert.ok(ratio > 0.4 && ratio < 0.6, `dark modules are balanced, got ${(ratio * 100).toFixed(1)}%`);

  const mask = (readFormatInformation(matrix).first ^ 0x5412) >>> 10 & 7;
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y][x]) continue;
        bits.push(matrix[y][x] !== maskBit(mask, x, y) ? 1 : 0);
      }
    }
  }
  assert.equal(bits.length, 359);

  let cursor = 0;
  const take = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bits[cursor++]; return v; };
  assert.equal(take(4), 0x4, "byte mode");
  const length = take(8);
  assert.equal(length, REFERENCE_TEXT.length);
  let decoded = "";
  for (let i = 0; i < length; i++) decoded += String.fromCharCode(take(8));
  assert.equal(decoded, REFERENCE_TEXT);

  // Reed-Solomon: version 2 quartile is a single 44-codeword block with 22
  // check bytes, so a correct codeword evaluates to zero at the generator's
  // roots a^0..a^21 in GF(256). GF tables are built here, not borrowed.
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
    codewords.push(v);
  }
  assert.equal(codewords.length, 44);
  const exp = new Array(512), log = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  const multiply = (a, b) => (a === 0 || b === 0 ? 0 : exp[log[a] + log[b]]);
  for (let root = 0; root < 22; root++) {
    let acc = 0;
    for (const c of codewords) acc = multiply(acc, exp[root]) ^ c;
    assert.equal(acc, 0, `syndrome at a^${root} is zero`);
  }
});

test("the reference symbol has not moved a module", () => {
  const {qr} = loadQr();
  // Spread first: the matrix is built inside the vm realm, so its Array is not
  // this realm's Array and a strict deep-equal would fail on the prototype.
  const rows = [...qr._matrix(REFERENCE_TEXT)].map(row => [...row].map(cell => (cell ? "1" : "0")).join(""));
  assert.deepEqual(rows, REFERENCE_MATRIX);
});
