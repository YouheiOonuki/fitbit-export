// 変換のテスト: node --test tests/*.test.js
// tests/fixtures/ のファイルと Calc.makeSample() はどちらも架空のデータ（実在の人の記録ではない）。
// 形は constants.js の SOURCES に書いた公開の解析コードに合わせて手で作った
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../calc.js');
const K = require('../constants.js');

const FIX = path.join(__dirname, 'fixtures', 'takeout');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
function sourcesOf(files) {
  return files.map((f) => ({ path: f.path, size: f.text.length, read: () => Promise.resolve(f.text) }));
}
function fixtureSources() {
  return walk(FIX).map((p) => ({ path: path.relative(FIX, p), size: fs.statSync(p).size, read: () => Promise.resolve(fs.readFileSync(p, 'utf8')) }));
}
async function load(files, opts) {
  const r = await C.importSources(sourcesOf(files));
  return C.aggregate(r.raw, opts || { tz: 'Asia/Tokyo' });
}
const byDate = (res) => Object.fromEntries(res.days.map((d) => [d.date, d]));

test('parseUs: "MM/DD/YY HH:MM:SS" と "MM/DD/YY"', () => {
  assert.deepEqual(C.parseUs('01/10/26 14:50:00'), { y: 2026, mo: 1, d: 10, h: 14, mi: 50, s: 0, off: null });
  assert.deepEqual(C.parseUs('03/01/24'), { y: 2024, mo: 3, d: 1, h: 0, mi: 0, s: 0, off: null });
  assert.equal(C.parseUs('2026-01-10'), null);
  assert.equal(C.parseUs(null), null);
});

test('parseIso: 時差の書きの有無', () => {
  assert.equal(C.parseIso('2024-03-20T22:04:00.000').off, null);
  assert.equal(C.parseIso('2024-10-27T00:00:04Z').off, 0);
  assert.equal(C.parseIso('2025-12-03 21:12:30+0000').off, 0);
  assert.equal(C.parseIso('2026-01-12T07:05:00.000+09:00').off, 540);
  assert.equal(C.parseIso('2026-01-12T07:05:00-05:30').off, -330);
  assert.equal(C.parseIso('2026-01-12').h, 0);
  assert.equal(C.parseIso('01/10/26'), null);
  assert.equal(C.parseOffset('+09:00'), 540);
  assert.equal(C.parseOffset('-0500'), -300);
  assert.equal(C.parseOffset(''), null);
});

test('zoneShifter: 日本時間は +9 時間、ニューヨークは夏時間の切り替わりをまたぐ', () => {
  const jst = C.zoneShifter('Asia/Tokyo');
  assert.equal(jst(Date.UTC(2026, 0, 10, 15, 0)), Date.UTC(2026, 0, 11, 0, 0));
  const ny = C.zoneShifter('America/New_York');
  // 2026-03-08 2:00（現地）に夏時間。06:59Z → 01:59 EST、07:00Z → 03:00 EDT
  assert.equal(ny(Date.UTC(2026, 2, 8, 6, 59)), Date.UTC(2026, 2, 8, 1, 59));
  assert.equal(ny(Date.UTC(2026, 2, 8, 7, 0)), Date.UTC(2026, 2, 8, 3, 0));
  assert.equal(C.isValidZone('Asia/Tokyo'), true);
  assert.equal(C.isValidZone('Mars/Olympus'), false);
  assert.equal(C.isValidZone(''), false);
});

test('parseCsv: 引用符・改行・BOM', () => {
  const rows = C.parseCsv('﻿Timestamp, Steps \r\n"2026-01-01T00:00:00Z","1,000"\r\n\r\n"a ""b""",2\n');
  assert.deepEqual(rows, [{ timestamp: '2026-01-01T00:00:00Z', steps: '1,000' }, { timestamp: 'a "b"', steps: '2' }]);
});

test('classify: フォルダ名によらずファイル名で決める。読まないものは null', () => {
  assert.equal(C.classify('Takeout/Fitbit/Global Export Data/sleep-2022-03-02.json'), 'sleep-json');
  assert.equal(C.classify('Taro/Sleep/sleep-2022-03-02.json'), 'sleep-json');   // 旧アカウントアーカイブの形
  assert.equal(C.classify('Takeout\\Google Health\\Global Export Data\\steps-2024-01-01.json'), 'steps-json');
  assert.equal(C.classify('x/Physical Activity_GoogleData/steps_2024-11-01.csv'), 'steps-csv');
  assert.equal(C.classify('x/Physical Activity_GoogleData/daily_resting_heart_rate.csv'), 'rhr-csv');
  assert.equal(C.classify('x/Sleep Score/sleep_score.csv'), 'score-csv');
  assert.equal(C.classify('x/Health Fitness Data_GoogleData/UserSleeps_2025-12-01.csv'), 'sleep-csv');
  assert.equal(C.classify('x/exercise-1700.json'), 'exercise-json');
  assert.equal(C.classify('x/heart_rate-2024-01-01.json'), null);   // 大きいので読まない
  assert.equal(C.classify('x/heart_rate_2024-10-27.csv'), null);
  assert.equal(C.classify('x/archive_browser.html'), null);
  assert.equal(C.classify('x/sleep-2022-03-02.json.bak'), null);
});

test('手で作った架空の書き出し（tests/fixtures）: 日本時間で日ごとにまとめる', async () => {
  const r = await C.importSources(fixtureSources());
  assert.deepEqual(r.errors, []);
  assert.equal(r.skipped, 1);   // heart_rate-*.json
  const res = C.aggregate(r.raw, { tz: 'Asia/Tokyo', weightUnit: 'auto' });
  const d = byDate(res);
  assert.deepEqual(res.days.map((x) => x.date), ['2026-01-10', '2026-01-11', '2026-01-12', '2026-01-13', '2026-01-14']);

  // 歩数: UTC 14:50 は 1/10 の 23:50、15:00 以降は 1/11
  assert.equal(d['2026-01-10'].steps, 100);
  assert.equal(d['2026-01-11'].steps, 1500);
  assert.equal(d['2026-01-13'].steps, 4321);   // CSV にだけある日
  assert.deepEqual(res.summary.stepCompare, { compared: 1, differ: 0, examples: [] });

  // 睡眠: mainSleep の記録。昼寝は「ほかの睡眠」
  const s = d['2026-01-11'];
  assert.equal(s.sleepStart, '2026-01-10 23:40');
  assert.equal(s.sleepEnd, '2026-01-11 06:30');
  assert.deepEqual([s.sleepMin, s.awakeMin, s.inBedMin, s.deep, s.light, s.rem, s.napMin], [380, 30, 410, 60, 250, 70, 35]);
  // classic（古い形）は内訳なし
  assert.equal(d['2026-01-12'].sleepMin, 400);
  assert.equal(d['2026-01-12'].deep, null);
  // JSON の無い日だけ UserSleeps（+09:00 を足して 23:00〜06:00）
  assert.equal(d['2026-01-13'].sleepStart, '2026-01-12 23:00');
  assert.equal(d['2026-01-13'].sleepEnd, '2026-01-13 06:00');
  assert.equal(d['2026-01-13'].sleepMin, 390);
  assert.deepEqual([res.summary.sources.sleepJson, res.summary.sources.sleepCsv], [2, 1]);

  // 睡眠スコア: ID で結ぶ（1001 → 1/11）、結べなければ timestamp の日付
  assert.equal(s.score, 81);
  assert.equal(d['2026-01-13'].score, 77);
  assert.equal(res.summary.sources.scoreLinked, 1);

  // 安静時心拍数: JSON 57.6 → 58（CSV の 58.4 より JSON）。値 0 の行は捨てる
  assert.equal(s.rhr, 58);
  assert.equal(d['2026-01-12'].rhr, undefined);
  assert.equal(d['2026-01-13'].rhr, 60);

  // 体重: JSON 154.3 と CSV 69,990 g が同じ日 → ポンドと判定。154.3 lb = 69.99 kg
  assert.equal(res.summary.weightUnit.unit, 'lb');
  assert.equal(res.summary.weightUnit.reason, 'matched');
  assert.equal(s.weight, 70);
  assert.equal(s.bmi, 23.1);
  assert.equal(s.fat, 21.5);
  assert.equal(d['2026-01-14'].weight, 70.1);   // 22:30Z は日本時間の 1/14 07:30

  // 運動: startTime は UTC（09:30Z → 18:30）、originalStartTime があればその時刻
  assert.deepEqual(res.exercises.map((e) => [e.start, e.name, e.minutes, e.activeMinutes]),
    [['2026-01-11 18:30', 'Walk, outdoor', 30, 29], ['2026-01-12 07:05', 'Run', 25, 25]]);
  assert.deepEqual([s.exCount, s.exMin, s.exNames], [1, 30, ['Walk, outdoor']]);
});

test('タイムゾーンを変えると、UTC の記録だけ日付が動く', async () => {
  const r = await C.importSources(fixtureSources());
  const d = byDate(C.aggregate(r.raw, { tz: 'UTC' }));
  assert.equal(d['2026-01-10'].steps, 600);
  assert.equal(d['2026-01-11'].steps, 1000);
  assert.equal(d['2026-01-11'].sleepMin, 380);   // 睡眠は現地の時刻のまま
  assert.equal(d['2026-01-11'].exNames[0], 'Walk, outdoor');
  // 不正なタイムゾーンは UTC にする
  assert.equal(C.aggregate(r.raw, { tz: 'Nowhere/City' }).summary.tz, 'UTC');
});

test('体重の単位: 選んだ単位が優先。比べる相手が無ければポンドとみなす', async () => {
  const w = [{ path: 'a/weight-2026-01-01.json', text: JSON.stringify([{ logId: 1, weight: 70.2, bmi: 23, date: '01/05/26', time: '07:00:00' }]) }];
  let res = await load(w, { tz: 'Asia/Tokyo' });
  assert.equal(res.summary.weightUnit.reason, 'assumed');
  assert.equal(res.days[0].weight, 31.8);
  assert.deepEqual(res.summary.weightUnit.sample, { date: '2026-01-05', value: 70.2 });
  res = await load(w, { tz: 'Asia/Tokyo', weightUnit: 'kg' });
  assert.equal(res.days[0].weight, 70.2);
  assert.equal(res.summary.weightUnit.reason, 'chosen');
  // CSV（グラム）が kg のほうに合えば kg
  res = await load(w.concat({ path: 'b/weight.csv', text: 'timestamp,weight grams\n2026-01-05T07:00:00,70200\n' }), { tz: 'Asia/Tokyo' });
  assert.equal(res.summary.weightUnit.unit, 'kg');
  assert.equal(res.summary.weightUnit.reason, 'matched');
  assert.equal(res.days[0].weight, 70.2);
});

test('歩数: JSON と CSV が食い違う日を数え、JSON の値を使う', async () => {
  const res = await load([
    { path: 'a/steps-2026-02-01.json', text: JSON.stringify([{ dateTime: '02/01/26 01:00:00', value: '500' }]) },
    { path: 'b/steps_2026-02-01.csv', text: 'timestamp,steps\n2026-02-01T01:00:00Z,480\n' },
  ]);
  assert.equal(res.days[0].steps, 500);
  assert.deepEqual(res.summary.stepCompare, { compared: 1, differ: 1, examples: [{ date: '2026-02-01', json: 500, csv: 480 }] });
});

test('importSources: 壊れたファイルは理由を残して続ける。同じファイルは 1 回だけ読む', async () => {
  const good = { path: 'z/resting_heart_rate-2026-01-01.json', size: 10, read: () => Promise.resolve(JSON.stringify([{ dateTime: '01/02/26 00:00:00', value: { date: '01/02/26', value: 61.2, error: 5 } }])) };
  let reads = 0;
  const dup = Object.assign({}, good, { read: () => { reads++; return good.read(); } });
  const r = await C.importSources([
    good, dup,
    { path: 'z/sleep-2026-01-01.json', size: 3, read: () => Promise.resolve('{not json') },
    { path: 'z/steps-2026-01-01.json', size: 3, read: () => Promise.resolve('{"a":1}') },
    { path: 'z/weight-2026-01-01.json', size: 3, read: () => Promise.reject(new Error('読めない')) },
    { path: 'z/readme.txt', size: 3, read: () => Promise.resolve('') },
  ], null);
  assert.equal(reads, 0);
  assert.equal(r.skipped, 1);
  assert.equal(r.total, 4);
  assert.deepEqual(r.errors.map((e) => e.path).sort(), ['z/sleep-2026-01-01.json', 'z/steps-2026-01-01.json', 'z/weight-2026-01-01.json']);
  assert.equal(C.aggregate(r.raw, { tz: 'Asia/Tokyo' }).days[0].rhr, 61);
});

test('見本（架空）: 50 日分すべての項目がそろう', async () => {
  const res = await load(C.makeSample(), { tz: 'Asia/Tokyo' });
  assert.equal(res.summary.from, '2026-08-01');
  assert.equal(res.summary.to, '2026-09-19');
  assert.deepEqual(res.summary.counts, { steps: 50, sleep: 50, score: 50, rhr: 50, weight: 17, exercise: 13 });
  assert.equal(res.summary.weightUnit.unit, 'lb');
  assert.ok(res.days.every((d) => d.weight == null || (d.weight > 67 && d.weight < 70)));
  assert.ok(res.exercises.every((e) => e.start.slice(11) === '18:30'));
});

test('toCsv: BOM・CRLF・引用符・列名の言語・期間', async () => {
  const r = await C.importSources(fixtureSources());
  const res = C.aggregate(r.raw, { tz: 'Asia/Tokyo' });
  const ja = C.toCsv(res, 'daily', { bom: true });
  assert.ok(ja.startsWith('﻿日付,歩数,寝た時刻,'));
  assert.ok(ja.endsWith('\r\n'));
  const lines = ja.slice(1).trim().split('\r\n');
  assert.equal(lines.length, 6);
  assert.equal(lines[2], '2026-01-11,1500,2026-01-10 23:40,2026-01-11 06:30,380,30,410,60,250,70,35,81,58,70,23.1,21.5,1,30,"Walk, outdoor"');
  const en = C.toCsv(res, 'daily', { lang: 'en', from: '2026-01-12', to: '2026-01-13' });
  assert.ok(en.startsWith('date,steps,sleep_start,'));
  assert.equal(en.trim().split('\r\n').length, 3);
  const ex = C.toCsv(res, 'exercise', {});
  assert.equal(ex.split('\r\n')[1], '2026-01-11 18:30,"Walk, outdoor",30,29,3000,150,105');
  assert.equal(C.DAILY_COLS.length, ja.slice(1).split('\r\n')[0].split(',').length);
});

test('toMarkdownFiles: 1 日 1 ファイル（frontmatter）と 1 か月 1 ファイル', async () => {
  const r = await C.importSources(fixtureSources());
  const res = C.aggregate(r.raw, { tz: 'Asia/Tokyo' });
  const days = C.toMarkdownFiles(res, { unit: 'day' });
  assert.deepEqual(days.map((f) => f.name), ['Fitbit/2026-01-10.md', 'Fitbit/2026-01-11.md', 'Fitbit/2026-01-12.md', 'Fitbit/2026-01-13.md', 'Fitbit/2026-01-14.md']);
  const t = days[1].text;
  assert.ok(t.startsWith('---\ndate: "2026-01-11"\nsteps: 1500\nsleep_start: "2026-01-10T23:40"\n'));
  assert.match(t, /\nexercise_types: \["Walk, outdoor"\]\n/);
  assert.match(t, /\n- 睡眠: 23:40〜06:30（6時間20分）深い 60分・浅い 250分・レム 70分\n/);
  assert.match(t, /\n- 体重: 70 kg（体脂肪率 21.5%）\n/);
  const months = C.toMarkdownFiles(res, { unit: 'month', lang: 'en' });
  assert.equal(months.length, 1);
  assert.equal(months[0].name, 'Fitbit/2026-01.md');
  assert.match(months[0].text, /^---\nmonth: "2026-01"\ndays: 5\n/);
  assert.match(months[0].text, /\| 2026-01-11 \| 1,500 \| 6:20 \| 81 \| 58 \| 70 \| Walk, outdoor \|/);
  assert.equal(C.toMarkdownFiles(res, { unit: 'day', from: '2026-01-13' }).length, 2);
});

test('constants: 出典ごとに source・url・確認日がある', () => {
  assert.match(K.CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  for (const [key, c] of Object.entries(K.SOURCES)) {
    assert.ok(c.label && c.value && c.source && /^https:\/\//.test(c.url) && c.checked === K.CHECKED, key);
    assert.ok(['official', 'public-code'].includes(c.kind), key);
  }
});
