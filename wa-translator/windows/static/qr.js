/*
 * QR Code generator library (JavaScript)
 *
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */

// Vendored for Lingua Relay: the upstream library verbatim in behaviour, wrapped
// so the page sees exactly one name. Reed-Solomon, all eight masks and the
// penalty scoring are the reason this is vendored rather than hand-rolled: a
// wrong mask scans on one phone and fails on the next.
(function () {
  "use strict";

  var MIN_VERSION = 1;
  var MAX_VERSION = 40;
  var PENALTY_N1 = 3;
  var PENALTY_N2 = 3;
  var PENALTY_N3 = 40;
  var PENALTY_N4 = 10;

  var ECC_CODEWORDS_PER_BLOCK = [
    // Version: (note that index 0 is for padding, and is set to an illegal value)
    // 0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40    Error correction level
    [-1,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],  // Low
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],  // Medium
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],  // Quartile
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]   // High
  ];

  var NUM_ERROR_CORRECTION_BLOCKS = [
    // Version: (note that index 0 is for padding, and is set to an illegal value)
    // 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40    Error correction level
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,  8,  9,  9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],  // Low
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],  // Medium
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],  // Quartile
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]   // High
  ];

  var ALPHANUMERIC_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  var NUMERIC_REGEX = /^[0-9]*$/;
  var ALPHANUMERIC_REGEX = /^[A-Z0-9 $%*+.\/:-]*$/;

  function getBit(x, i) {
    return ((x >>> i) & 1) != 0;
  }

  function appendBits(val, len, bb) {
    if (len < 0 || len > 31 || (val >>> len) != 0) throw new RangeError("Value out of range");
    for (var i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
  }

  function toUtf8ByteArray(str) {
    str = encodeURI(str);
    var result = [];
    for (var i = 0; i < str.length; i++) {
      if (str.charAt(i) != "%") {
        result.push(str.charCodeAt(i));
      } else {
        result.push(parseInt(str.substring(i + 1, i + 3), 16));
        i += 2;
      }
    }
    return result;
  }

  // ---- Error correction level ----

  function Ecc(ordinal, formatBits) {
    this.ordinal = ordinal;
    this.formatBits = formatBits;
  }
  Ecc.LOW = new Ecc(0, 1);
  Ecc.MEDIUM = new Ecc(1, 0);
  Ecc.QUARTILE = new Ecc(2, 3);
  Ecc.HIGH = new Ecc(3, 2);

  // ---- Segment mode ----

  function Mode(modeBits, numBitsCharCount) {
    this.modeBits = modeBits;
    this.numBitsCharCount = numBitsCharCount;
  }
  Mode.prototype.numCharCountBits = function (ver) {
    return this.numBitsCharCount[Math.floor((ver + 7) / 17)];
  };
  Mode.NUMERIC = new Mode(0x1, [10, 12, 14]);
  Mode.ALPHANUMERIC = new Mode(0x2, [9, 11, 13]);
  Mode.BYTE = new Mode(0x4, [8, 16, 16]);
  Mode.KANJI = new Mode(0x8, [8, 10, 12]);
  Mode.ECI = new Mode(0x7, [0, 0, 0]);

  // ---- Data segment ----

  function QrSegment(mode, numChars, bitData) {
    this.mode = mode;
    this.numChars = numChars;
    this.bitData = bitData;
    if (numChars < 0) throw new RangeError("Invalid argument");
    this.bitData = bitData.slice();
  }
  QrSegment.prototype.getData = function () {
    return this.bitData.slice();
  };
  QrSegment.Mode = Mode;

  QrSegment.makeBytes = function (data) {
    var bb = [];
    for (var i = 0; i < data.length; i++) appendBits(data[i], 8, bb);
    return new QrSegment(Mode.BYTE, data.length, bb);
  };

  QrSegment.makeNumeric = function (digits) {
    if (!QrSegment.isNumeric(digits)) throw new RangeError("String contains non-numeric characters");
    var bb = [];
    for (var i = 0; i < digits.length; ) {
      var n = Math.min(digits.length - i, 3);
      appendBits(parseInt(digits.substring(i, i + n), 10), n * 3 + 1, bb);
      i += n;
    }
    return new QrSegment(Mode.NUMERIC, digits.length, bb);
  };

  QrSegment.makeAlphanumeric = function (text) {
    if (!QrSegment.isAlphanumeric(text)) throw new RangeError("String contains unencodable characters in alphanumeric mode");
    var bb = [];
    var i;
    for (i = 0; i + 2 <= text.length; i += 2) {
      var temp = ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)) * 45;
      temp += ALPHANUMERIC_CHARSET.indexOf(text.charAt(i + 1));
      appendBits(temp, 11, bb);
    }
    if (i < text.length) appendBits(ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)), 6, bb);
    return new QrSegment(Mode.ALPHANUMERIC, text.length, bb);
  };

  QrSegment.makeSegments = function (text) {
    if (text == "") return [];
    if (QrSegment.isNumeric(text)) return [QrSegment.makeNumeric(text)];
    if (QrSegment.isAlphanumeric(text)) return [QrSegment.makeAlphanumeric(text)];
    return [QrSegment.makeBytes(toUtf8ByteArray(text))];
  };

  QrSegment.makeEci = function (assignVal) {
    var bb = [];
    if (assignVal < 0) throw new RangeError("ECI assignment value out of range");
    if (assignVal < (1 << 7)) {
      appendBits(assignVal, 8, bb);
    } else if (assignVal < (1 << 14)) {
      appendBits(0x2, 2, bb);
      appendBits(assignVal, 14, bb);
    } else if (assignVal < 1000000) {
      appendBits(0x6, 3, bb);
      appendBits(assignVal, 21, bb);
    } else {
      throw new RangeError("ECI assignment value out of range");
    }
    return new QrSegment(Mode.ECI, 0, bb);
  };

  QrSegment.isNumeric = function (text) {
    return NUMERIC_REGEX.test(text);
  };

  QrSegment.isAlphanumeric = function (text) {
    return ALPHANUMERIC_REGEX.test(text);
  };

  QrSegment.getTotalBits = function (segs, version) {
    var result = 0;
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      var ccbits = seg.mode.numCharCountBits(version);
      if (seg.numChars >= (1 << ccbits)) return Infinity;
      result += 4 + ccbits + seg.getData().length;
    }
    return result;
  };

  // ---- QR Code symbol ----

  function QrCode(version, errorCorrectionLevel, dataCodewords, msk) {
    if (version < MIN_VERSION || version > MAX_VERSION) throw new RangeError("Version value out of range");
    if (msk < -1 || msk > 7) throw new RangeError("Mask value out of range");
    this.version = version;
    this.errorCorrectionLevel = errorCorrectionLevel;
    this.size = version * 4 + 17;
    this.modules = [];
    this.isFunction = [];

    var row = [];
    for (var i = 0; i < this.size; i++) row.push(false);
    for (var j = 0; j < this.size; j++) {
      this.modules.push(row.slice());
      this.isFunction.push(row.slice());
    }

    this.drawFunctionPatterns();
    var allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);

    if (msk == -1) {
      var minPenalty = Infinity;
      for (var m = 0; m < 8; m++) {
        this.applyMask(m);
        this.drawFormatBits(m);
        var penalty = this.getPenaltyScore();
        if (penalty < minPenalty) {
          msk = m;
          minPenalty = penalty;
        }
        this.applyMask(m); // Undoes the mask due to XOR
      }
    }
    this.mask = msk;
    this.applyMask(msk);
    this.drawFormatBits(msk);
    this.isFunction = [];
  }

  QrCode.MIN_VERSION = MIN_VERSION;
  QrCode.MAX_VERSION = MAX_VERSION;
  QrCode.Ecc = Ecc;

  QrCode.encodeText = function (text, ecl) {
    var segs = QrSegment.makeSegments(text);
    return QrCode.encodeSegments(segs, ecl);
  };

  QrCode.encodeBinary = function (data, ecl) {
    var seg = QrSegment.makeBytes(data);
    return QrCode.encodeSegments([seg], ecl);
  };

  QrCode.encodeSegments = function (segs, ecl, minVersion, maxVersion, mask, boostEcl) {
    if (minVersion === undefined) minVersion = 1;
    if (maxVersion === undefined) maxVersion = 40;
    if (mask === undefined) mask = -1;
    if (boostEcl === undefined) boostEcl = true;
    if (!(MIN_VERSION <= minVersion && minVersion <= maxVersion && maxVersion <= MAX_VERSION) || mask < -1 || mask > 7)
      throw new RangeError("Invalid value");

    var version, dataUsedBits;
    for (version = minVersion; ; version++) {
      var dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
      var usedBits = QrSegment.getTotalBits(segs, version);
      if (usedBits <= dataCapacityBits) {
        dataUsedBits = usedBits;
        break;
      }
      if (version >= maxVersion) throw new RangeError("Data too long");
    }

    var boostable = [Ecc.MEDIUM, Ecc.QUARTILE, Ecc.HIGH];
    for (var i = 0; i < boostable.length; i++) {
      if (boostEcl && dataUsedBits <= QrCode.getNumDataCodewords(version, boostable[i]) * 8)
        ecl = boostable[i];
    }

    var bb = [];
    for (var s = 0; s < segs.length; s++) {
      var seg = segs[s];
      appendBits(seg.mode.modeBits, 4, bb);
      appendBits(seg.numChars, seg.mode.numCharCountBits(version), bb);
      var data = seg.getData();
      for (var d = 0; d < data.length; d++) bb.push(data[d]);
    }

    var capacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
    appendBits(0, Math.min(4, capacityBits - bb.length), bb);
    appendBits(0, (8 - bb.length % 8) % 8, bb);
    for (var padByte = 0xEC; bb.length < capacityBits; padByte ^= 0xEC ^ 0x11)
      appendBits(padByte, 8, bb);

    var dataCodewords = [];
    while (dataCodewords.length * 8 < bb.length) dataCodewords.push(0);
    for (var b = 0; b < bb.length; b++) dataCodewords[b >>> 3] |= bb[b] << (7 - (b & 7));

    return new QrCode(version, ecl, dataCodewords, mask);
  };

  QrCode.prototype.getModule = function (x, y) {
    return 0 <= x && x < this.size && 0 <= y && y < this.size && this.modules[y][x];
  };

  QrCode.prototype.drawFunctionPatterns = function () {
    // Draw horizontal and vertical timing patterns
    for (var i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 == 0);
      this.setFunctionModule(i, 6, i % 2 == 0);
    }

    // Draw 3 finder patterns (all corners except bottom right; overwrites some timing modules)
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    // Draw numerous alignment patterns
    var alignPatPos = this.getAlignmentPatternPositions();
    var numAlign = alignPatPos.length;
    for (var i2 = 0; i2 < numAlign; i2++) {
      for (var j = 0; j < numAlign; j++) {
        // Don't draw on the three finder corners
        if (!((i2 == 0 && j == 0) || (i2 == 0 && j == numAlign - 1) || (i2 == numAlign - 1 && j == 0)))
          this.drawAlignmentPattern(alignPatPos[i2], alignPatPos[j]);
      }
    }

    // Draw configuration data
    this.drawFormatBits(0); // Dummy mask value; overwritten later in the constructor
    this.drawVersion();
  };

  QrCode.prototype.drawFormatBits = function (mask) {
    // Calculate error correction code and assemble bits
    var data = (this.errorCorrectionLevel.formatBits << 3) | mask; // errCorrLvl is uint2, mask is uint3
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412; // uint15

    // Draw first copy
    for (var i1 = 0; i1 <= 5; i1++) this.setFunctionModule(8, i1, getBit(bits, i1));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (var i2 = 9; i2 < 15; i2++) this.setFunctionModule(14 - i2, 8, getBit(bits, i2));

    // Draw second copy
    for (var i3 = 0; i3 < 8; i3++) this.setFunctionModule(this.size - 1 - i3, 8, getBit(bits, i3));
    for (var i4 = 8; i4 < 15; i4++) this.setFunctionModule(8, this.size - 15 + i4, getBit(bits, i4));
    this.setFunctionModule(8, this.size - 8, true); // Always dark
  };

  QrCode.prototype.drawVersion = function () {
    if (this.version < 7) return;

    // Calculate error correction code and assemble bits
    var rem = this.version; // version is uint6, in the range [7, 40]
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (this.version << 12) | rem; // uint18

    // Draw two copies
    for (var i2 = 0; i2 < 18; i2++) {
      var color = getBit(bits, i2);
      var a = this.size - 11 + i2 % 3;
      var b = Math.floor(i2 / 3);
      this.setFunctionModule(a, b, color);
      this.setFunctionModule(b, a, color);
    }
  };

  QrCode.prototype.drawFinderPattern = function (x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev/infinity norm
        var xx = x + dx;
        var yy = y + dy;
        if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size)
          this.setFunctionModule(xx, yy, dist != 2 && dist != 4);
      }
    }
  };

  QrCode.prototype.drawAlignmentPattern = function (x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++)
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1);
    }
  };

  QrCode.prototype.setFunctionModule = function (x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  };

  QrCode.prototype.addEccAndInterleave = function (data) {
    var ver = this.version;
    var ecl = this.errorCorrectionLevel;
    if (data.length != QrCode.getNumDataCodewords(ver, ecl)) throw new RangeError("Invalid argument");

    // Calculate parameter numbers
    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
    var blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
    var rawCodewords = Math.floor(QrCode.getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - rawCodewords % numBlocks;
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    // Split data into blocks and append ECC to each block
    var blocks = [];
    var rsDiv = QrCode.reedSolomonComputeDivisor(blockEccLen);
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      var ecc = QrCode.reedSolomonComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }

    // Interleave (not concatenate) the bytes from every block into a single sequence
    var result = [];
    for (var i2 = 0; i2 < blocks[0].length; i2++) {
      for (var j = 0; j < blocks.length; j++) {
        // Skip the padding byte in short blocks
        if (i2 != shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i2]);
      }
    }
    return result;
  };

  QrCode.prototype.drawCodewords = function (data) {
    if (data.length != Math.floor(QrCode.getNumRawDataModules(this.version) / 8))
      throw new RangeError("Invalid argument");
    var i = 0; // Bit index into the data
    // Do the funny zigzag scan
    for (var right = this.size - 1; right >= 1; right -= 2) { // Index of right column in each column pair
      if (right == 6) right = 5;
      for (var vert = 0; vert < this.size; vert++) { // Vertical counter
        for (var j = 0; j < 2; j++) {
          var x = right - j; // Actual x coordinate
          var upward = ((right + 1) & 2) == 0;
          var y = upward ? this.size - 1 - vert : vert; // Actual y coordinate
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
          // If this QR Code has any remainder bits (0 to 7), they were assigned as
          // 0/false/light by the constructor and are left unchanged by this method
        }
      }
    }
  };

  QrCode.prototype.applyMask = function (msk) {
    if (msk < 0 || msk > 7) throw new RangeError("Mask value out of range");
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        var invert;
        switch (msk) {
          case 0: invert = (x + y) % 2 == 0; break;
          case 1: invert = y % 2 == 0; break;
          case 2: invert = x % 3 == 0; break;
          case 3: invert = (x + y) % 3 == 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 == 0; break;
          case 5: invert = x * y % 2 + x * y % 3 == 0; break;
          case 6: invert = (x * y % 2 + x * y % 3) % 2 == 0; break;
          case 7: invert = ((x + y) % 2 + x * y % 3) % 2 == 0; break;
          default: throw new Error("Unreachable");
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  };

  QrCode.prototype.getPenaltyScore = function () {
    var result = 0;
    var x, y, runX, runY, runColor, runHistory;

    // Adjacent modules in row having same color, and finder-like patterns
    for (y = 0; y < this.size; y++) {
      runColor = false;
      runX = 0;
      runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (x = 0; x < this.size; x++) {
        if (this.modules[y][x] == runColor) {
          runX++;
          if (runX == 5) result += PENALTY_N1;
          else if (runX > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runX, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = this.modules[y][x];
          runX = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runX, runHistory) * PENALTY_N3;
    }
    // Adjacent modules in column having same color, and finder-like patterns
    for (x = 0; x < this.size; x++) {
      runColor = false;
      runY = 0;
      runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (y = 0; y < this.size; y++) {
        if (this.modules[y][x] == runColor) {
          runY++;
          if (runY == 5) result += PENALTY_N1;
          else if (runY > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runY, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = this.modules[y][x];
          runY = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runY, runHistory) * PENALTY_N3;
    }

    // 2*2 blocks of modules having same color
    for (y = 0; y < this.size - 1; y++) {
      for (x = 0; x < this.size - 1; x++) {
        var color = this.modules[y][x];
        if (color == this.modules[y][x + 1] && color == this.modules[y + 1][x] && color == this.modules[y + 1][x + 1])
          result += PENALTY_N2;
      }
    }

    // Balance of dark and light modules
    var dark = 0;
    for (var r = 0; r < this.modules.length; r++) {
      for (var c = 0; c < this.modules[r].length; c++) if (this.modules[r][c]) dark++;
    }
    var total = this.size * this.size; // Note that size is odd, so dark/total != 1/2
    // Compute the smallest integer k >= 0 such that (45-5k)% <= dark/total <= (55+5k)%
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  };

  QrCode.prototype.getAlignmentPatternPositions = function () {
    if (this.version == 1) return [];
    var numAlign = Math.floor(this.version / 7) + 2;
    var step = (this.version == 32) ? 26 : Math.ceil((this.version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = this.size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  };

  QrCode.getNumRawDataModules = function (ver) {
    if (ver < MIN_VERSION || ver > MAX_VERSION) throw new RangeError("Version number out of range");
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  };

  QrCode.getNumDataCodewords = function (ver, ecl) {
    return Math.floor(QrCode.getNumRawDataModules(ver) / 8)
      - ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
  };

  QrCode.reedSolomonComputeDivisor = function (degree) {
    if (degree < 1 || degree > 255) throw new RangeError("Degree out of range");
    // Polynomial coefficients are stored from highest to lowest power, excluding the leading term which is always 1.
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1); // Start off with the monomial x^0

    // Compute the product polynomial (x - r^0) * (x - r^1) * (x - r^2) * ... * (x - r^(degree-1)),
    // and drop the highest monomial term which is always 1x^degree.
    var root = 1;
    for (var i2 = 0; i2 < degree; i2++) {
      // Multiply the current product by (x - r^i)
      for (var j = 0; j < result.length; j++) {
        result[j] = QrCode.reedSolomonMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = QrCode.reedSolomonMultiply(root, 0x02);
    }
    return result;
  };

  QrCode.reedSolomonComputeRemainder = function (data, divisor) {
    var result = divisor.map(function () { return 0; });
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ result.shift();
      result.push(0);
      for (var j = 0; j < divisor.length; j++) result[j] ^= QrCode.reedSolomonMultiply(divisor[j], factor);
    }
    return result;
  };

  QrCode.reedSolomonMultiply = function (x, y) {
    if (x >>> 8 != 0 || y >>> 8 != 0) throw new RangeError("Byte out of range");
    // Russian peasant multiplication
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  };

  QrCode.prototype.finderPenaltyCountPatterns = function (runHistory) {
    var n = runHistory[1];
    var core = n > 0 && runHistory[2] == n && runHistory[3] == n * 3 && runHistory[4] == n && runHistory[5] == n;
    return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0)
      + (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
  };

  QrCode.prototype.finderPenaltyTerminateAndCount = function (currentRunColor, currentRunLength, runHistory) {
    if (currentRunColor) { // Terminate dark run
      this.finderPenaltyAddHistory(currentRunLength, runHistory);
      currentRunLength = 0;
    }
    currentRunLength += this.size; // Add light border to final run
    this.finderPenaltyAddHistory(currentRunLength, runHistory);
    return this.finderPenaltyCountPatterns(runHistory);
  };

  QrCode.prototype.finderPenaltyAddHistory = function (currentRunLength, runHistory) {
    if (runHistory[0] == 0) currentRunLength += this.size; // Add light border to initial run
    runHistory.pop();
    runHistory.unshift(currentRunLength);
  };

  // ---- Lingua Relay surface ----

  var SVG_NS = "http://www.w3.org/2000/svg";

  // The dark modules as a boolean matrix, quiet zone excluded. Exists so the
  // encoder can be asserted on directly instead of through parsed path text.
  function matrix(text) {
    var qr = QrCode.encodeText(String(text), Ecc.LOW);
    var rows = [];
    for (var y = 0; y < qr.size; y++) {
      var row = [];
      for (var x = 0; x < qr.size; x++) row.push(qr.getModule(x, y));
      rows.push(row);
    }
    return rows;
  }

  function svg(text, moduleSize, quiet) {
    if (moduleSize === undefined) moduleSize = 4;
    if (quiet === undefined) quiet = 2;
    var qr = QrCode.encodeText(String(text), Ecc.LOW);
    var span = qr.size + quiet * 2;

    var parts = [];
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) parts.push("M" + (x + quiet) + "," + (y + quiet) + "h1v1h-1z");
      }
    }

    var el = document.createElementNS(SVG_NS, "svg");
    el.setAttribute("viewBox", "0 0 " + span + " " + span);
    el.setAttribute("width", String(span * moduleSize));
    el.setAttribute("height", String(span * moduleSize));
    el.setAttribute("shape-rendering", "crispEdges");
    el.setAttribute("role", "img");

    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", parts.join(" "));
    path.setAttribute("fill", "currentColor");
    el.appendChild(path);
    return el;
  }

  window.LinguaQR = {svg: svg, _matrix: matrix};
})();
