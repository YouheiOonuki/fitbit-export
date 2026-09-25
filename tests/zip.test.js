// zip の読み書きのテスト: node --test tests/*.test.js
// 圧縮した zip は Node の zlib（deflateRawSync）で組み立てて、ブラウザと同じ DecompressionStream で読む
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const Z = require('../zip.js');

// 最小の zip を組み立てる（zip64: true なら 32 ビットの欄を 0xFFFFFFFF にして ZIP64 の拡張と EOCD64 に本当の値を書く）
function buildZip(files, opt) {
  opt = opt || {};
  const enc = new TextEncoder(), locals = [], cens = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), raw = enc.encode(f.text);
    const data = f.store ? raw : zlib.deflateRawSync(raw), method = f.store ? 0 : 8, crc = Z.crc32(raw);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(data.length, 18); loc.writeUInt32LE(raw.length, 22); loc.writeUInt16LE(name.length, 26);
    const extra = opt.zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (opt.zip64) {
      extra.writeUInt16LE(1, 0); extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(raw.length), 4); extra.writeBigUInt64LE(BigInt(data.length), 12); extra.writeBigUInt64LE(BigInt(off), 20);
    }
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(45, 4); cen.writeUInt16LE(45, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(opt.zip64 ? 0xffffffff : data.length, 20); cen.writeUInt32LE(opt.zip64 ? 0xffffffff : raw.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt16LE(extra.length, 30);
    cen.writeUInt32LE(opt.zip64 ? 0xffffffff : off, 42);
    locals.push(loc, Buffer.from(name), data);
    cens.push(cen, Buffer.from(name), extra);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(cens), tail = [];
  if (opt.zip64) {
    const e64 = Buffer.alloc(56);
    e64.writeUInt32LE(0x06064b50, 0); e64.writeBigUInt64LE(44n, 4); e64.writeUInt16LE(45, 12); e64.writeUInt16LE(45, 14);
    e64.writeBigUInt64LE(BigInt(files.length), 24); e64.writeBigUInt64LE(BigInt(files.length), 32);
    e64.writeBigUInt64LE(BigInt(cd.length), 40); e64.writeBigUInt64LE(BigInt(off), 48);
    const loc64 = Buffer.alloc(20);
    loc64.writeUInt32LE(0x07064b50, 0); loc64.writeBigUInt64LE(BigInt(off + cd.length), 8); loc64.writeUInt32LE(1, 16);
    tail.push(e64, loc64);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opt.zip64 ? 0xffff : files.length, 8); eocd.writeUInt16LE(opt.zip64 ? 0xffff : files.length, 10);
  eocd.writeUInt32LE(opt.zip64 ? 0xffffffff : cd.length, 12); eocd.writeUInt32LE(opt.zip64 ? 0xffffffff : off, 16);
  return new Blob([Buffer.concat(locals.concat([cd], tail, [eocd]))]);
}

const FILES = [
  { name: 'Takeout/Fitbit/Global Export Data/steps-2026-01-10.json', text: JSON.stringify([{ dateTime: '01/10/26 14:50:00', value: '100' }]).repeat(1) },
  { name: 'Takeout/Fitbit/Sleep Score/sleep_score.csv', text: 'timestamp,overall_score\n2026-01-11T06:30:00Z,81\n', store: true },
  { name: 'Takeout/Fitbit/日本語のフォルダ/メモ.txt', text: 'あいうえお'.repeat(500) },
];

test('crc32: 既知の値', () => {
  assert.equal(Z.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('readIndex / readText: 圧縮（deflate）と無圧縮、UTF-8 の名前', async () => {
  const blob = buildZip(FILES);
  const idx = await Z.readIndex(blob);
  assert.deepEqual(idx.map((e) => e.name), FILES.map((f) => f.name));
  assert.deepEqual(idx.map((e) => e.method), [8, 0, 8]);
  for (let i = 0; i < FILES.length; i++) assert.equal(await Z.readText(blob, idx[i]), FILES[i].text);
});

test('readIndex: ZIP64 の目次（2GB を超える書き出しの形）も読める', async () => {
  const blob = buildZip(FILES, { zip64: true });
  const idx = await Z.readIndex(blob);
  assert.equal(idx.length, 3);
  assert.equal(idx[2].size, new TextEncoder().encode(FILES[2].text).length);
  assert.equal(await Z.readText(blob, idx[2]), FILES[2].text);
});

test('makeZip: 書いた zip を読み戻せる（Markdown の束）', async () => {
  const files = [{ name: 'Fitbit/2026-01-11.md', text: '---\ndate: "2026-01-11"\n---\n# 2026-01-11\n' }, { name: 'Fitbit/2026-01.md', text: '| 日付 |\n' }];
  const bytes = Z.makeZip(files, new Date(2026, 0, 11, 7, 30));
  const blob = new Blob([bytes]);
  const idx = await Z.readIndex(blob);
  assert.deepEqual(idx.map((e) => [e.name, e.method]), [['Fitbit/2026-01-11.md', 0], ['Fitbit/2026-01.md', 0]]);
  assert.equal(await Z.readText(blob, idx[1]), files[1].text);
  // CRC は書いた中身と合う
  const dv = new DataView(bytes.buffer);
  assert.equal(dv.getUint32(14, true), Z.crc32(new TextEncoder().encode(files[0].text)));
});

test('zip でないもの・壊れたものは理由つきで断る', async () => {
  await assert.rejects(Z.readIndex(new Blob(['hello'])), /zip ではありません/);
  await assert.rejects(Z.readIndex(new Blob(['x'.repeat(100)])), /zip ではありません/);
  const blob = buildZip(FILES);
  const idx = await Z.readIndex(blob);
  await assert.rejects(Z.readText(blob, Object.assign({}, idx[0], { encrypted: true })), /パスワード/);
  await assert.rejects(Z.readText(blob, Object.assign({}, idx[0], { method: 12 })), /圧縮方式/);
  await assert.rejects(Z.readText(blob, Object.assign({}, idx[0], { offset: 5 })), /壊れています/);
});
