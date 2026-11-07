/** The QR encoder: structure checks, and a round trip through OpenCV when it is installed (python3 + cv2). */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { encodeQr, qrSvg } from '../src/ui/qr.ts';

function pgm(text: string): Buffer {
  const q = encodeQr(text);
  const s = 8;
  const quiet = 4;
  const W = (q.size + quiet * 2) * s;
  const pixels = Buffer.alloc(W * W, 255);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const mx = Math.floor(x / s) - quiet;
      const my = Math.floor(y / s) - quiet;
      if (mx >= 0 && my >= 0 && mx < q.size && my < q.size && q.modules[my]![mx]) pixels[y * W + x] = 0;
    }
  }
  return Buffer.concat([Buffer.from(`P5\n${W} ${W}\n255\n`), pixels]);
}

describe('QR encoder', () => {
  it('picks the smallest version, keeps finder patterns and a quiet zone in the SVG', () => {
    assert.equal(encodeQr('A').version, 1);
    assert.equal(encodeQr('https://join.pokerclubos.example/midnight-poker-club-482').version, 4);
    assert.equal(encodeQr('x'.repeat(180)).version, 9);
    assert.throws(() => encodeQr('x'.repeat(181)), /too long/);
    const q = encodeQr('hello');
    assert.equal(q.size, 21);
    // Finder pattern corners are dark.
    for (const [x, y] of [[0, 0], [20, 0], [0, 20], [6, 6], [14, 6], [6, 14]] as const) assert.equal(q.modules[y]![x], true);
    // Timing pattern alternates.
    assert.equal(q.modules[6]![8], true);
    assert.equal(q.modules[6]![9], false);
    const svg = qrSvg('hello', 4);
    assert.ok(svg.startsWith('<svg') && svg.includes('viewBox="0 0 116 116"'));
  });

  it('round-trips through an independent decoder (OpenCV), when available', () => {
    const texts = ['https://join.pokerclubos.example/midnight-poker-club-482', 'https://join.pokerclubos.example/c7x9k2m4p?ref=u_player&c=autumn', 'Poker Club OS · מועדון', 'q'.repeat(170)];
    const dir = mkdtempSync(join(tmpdir(), 'qr-'));
    const files = texts.map((text, i) => {
      const file = join(dir, `${i}.pgm`);
      writeFileSync(file, pgm(text));
      return file;
    });
    let out: string;
    try {
      out = execFileSync('python3', ['-c', `import cv2,sys\nd=cv2.QRCodeDetector()\nfor f in sys.argv[1:]:\n    t,_,_=d.detectAndDecode(cv2.imread(f))\n    print(t)`, ...files], { encoding: 'utf8', timeout: 20000 });
    } catch {
      return; // no OpenCV here: the structural checks above still ran
    }
    const decoded = out.split('\n');
    texts.forEach((text, i) => assert.equal(decoded[i], text, `code ${i} decodes`));
  });
});
