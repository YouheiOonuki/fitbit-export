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
    assert.ok(c.label && c.value && c.source && /^https:\/\//.test(c.url) && /^\d{4}-\d{2}-\d{2}$/.test(c.checked) && c.checked >= K.CHECKED, key);
    assert.ok(['official', 'public-code'].includes(c.kind), key);
  }
});

test('体重の出力の単位（英語の画面で選ぶ）: lb は丸める前の kg から戻す。既定は kg のまま', async () => {
  const r = await C.importSources(fixtureSources());
  const res = C.aggregate(r.raw, { tz: 'Asia/Tokyo' });
  const d = byDate(res);
  // 1/11 は weight-*.json の 154.3 lb（69.99 kg → 表では 70）。lb に戻すと 154.3（丸めた 70 kg から戻すと 154.3 にならない値もある）
  assert.equal(C.weightIn(d['2026-01-11'], 'lb'), 154.3);
  assert.equal(C.weightIn(d['2026-01-11'], 'kg'), 70);
  assert.equal(C.weightIn(d['2026-01-11']), 70);
  assert.equal(C.weightIn(d['2026-01-14'], 'lb'), Math.round(d['2026-01-14'].weightKgRaw / 0.45359237 * 10) / 10);
  assert.equal(C.weightIn(d['2026-01-10'], 'lb'), null);
  const lb = C.toCsv(res, 'daily', { lang: 'en', weightOut: 'lb' }).trim().split('\r\n');
  assert.ok(lb[0].includes(',weight_lb,') && !lb[0].includes('weight_kg'));
  assert.equal(lb[2].split(',')[13], '154.3');
  assert.ok(C.toCsv(res, 'daily', { weightOut: 'lb' }).includes(',体重(lb),'));
  assert.ok(C.toCsv(res, 'daily', { lang: 'en' }).includes(',weight_kg,'));
  const md = C.toMarkdownFiles(res, { unit: 'day', lang: 'en', weightOut: 'lb' })[1].text;
  assert.match(md, /\nweight_lb: 154\.3\n/);
  assert.match(md, /\n- Weight: 154\.3 lb \(body fat 21\.5%\)\n/);
  const month = C.toMarkdownFiles(res, { unit: 'month', lang: 'en', weightOut: 'lb' })[0].text;
  assert.match(month, /\| Weight \(lb\) \|/);
  assert.match(month, /\| 2026-01-11 \| 1,500 \| 6:20 \| 81 \| 58 \| 154\.3 \|/);
});

// 項目 × 月の升目（Q-317）。days は aggregate の days と同じ形（値の無い項目はキーが無い）
function daysOf(from, n, fill) {
  const out = [], t0 = Date.parse(from + 'T00:00:00Z');
  for (let i = 0; i < n; i++) out.push(Object.assign({ date: new Date(t0 + i * 86400000).toISOString().slice(0, 10) }, fill(i)));
  return out;
}

test('monthGrid: 0 件は年が無い', () => {
  assert.deepEqual(C.monthGrid([]), { items: ['sleep', 'score', 'steps', 'rhr', 'weight', 'exercise'], years: [] });
  assert.deepEqual(C.monthGrid(null).years, []);
});

test('monthGrid: 1 か月。期間の外の月は null、段は 0 日・半分未満・半分以上・全部', () => {
  // 2026-03-01〜03-31 の 31 日: 歩数は全部、睡眠は 16 日（半分以上）、心拍は 15 日（半分未満）、体重は 0 日、運動は 1 日
  const days = daysOf('2026-03-01', 31, (i) => Object.assign({ steps: 5000 }, i < 16 ? { sleepMin: 400 } : {}, i < 15 ? { rhr: 60 } : {}, i === 3 ? { exCount: 1 } : {}));
  const g = C.monthGrid(days);
  assert.equal(g.years.length, 1);
  const ms = g.years[0].months;
  assert.equal(ms.length, 12);
  assert.deepEqual(ms.map((m) => m && m.month), [null, null, 3, null, null, null, null, null, null, null, null, null]);
  const c = ms[2].cells;
  assert.equal(ms[2].span, 31);
  assert.deepEqual(c.steps, { n: 31, level: 3 });
  assert.deepEqual(c.sleep, { n: 16, level: 2 });
  assert.deepEqual(c.rhr, { n: 15, level: 1 });
  assert.deepEqual(c.weight, { n: 0, level: 0 });
  assert.deepEqual(c.exercise, { n: 1, level: 1 });
  assert.deepEqual(c.score, { n: 0, level: 0 });
});

test('monthGrid: 最初と最後の月は期間に入る日数が分母', () => {
  // 3-20〜4-05: 3 月は 12 日、4 月は 5 日。全部の日に歩数があれば両方とも全部（3）
  const g = C.monthGrid(daysOf('2026-03-20', 17, () => ({ steps: 1 })));
  const [mar, apr] = [g.years[0].months[2], g.years[0].months[3]];
  assert.equal(mar.span, 12); assert.equal(apr.span, 5);
  assert.equal(mar.cells.steps.level, 3); assert.equal(apr.cells.steps.level, 3);
});

test('monthGrid: うるう年の 2 月は 29 日が分母', () => {
  const all = C.monthGrid(daysOf('2028-02-01', 29, () => ({ weight: 60 })), '2028-02-01', '2028-02-29');
  assert.equal(all.years[0].months[1].span, 29);
  assert.deepEqual(all.years[0].months[1].cells.weight, { n: 29, level: 3 });
  // 28 日だけ値があると、全部ではない（平年の 2 月の日数と取り違えない）
  const d = daysOf('2028-02-01', 29, (i) => (i < 28 ? { weight: 60 } : {}));
  assert.deepEqual(C.monthGrid(d, '2028-02-01', '2028-02-29').years[0].months[1].cells.weight, { n: 28, level: 2 });
  // 平年（2027）は 28 日
  assert.equal(C.monthGrid(daysOf('2027-02-01', 28, () => ({ weight: 60 }))).years[0].months[1].span, 28);
});

test('monthGrid: 6 年の期間は 1 年 1 段で 6 段（横に伸ばさない）', () => {
  const days = [{ date: '2020-03-15', steps: 1 }, { date: '2023-07-01', rhr: 55 }, { date: '2025-11-02', exCount: 2 }];
  const g = C.monthGrid(days);
  assert.deepEqual(g.years.map((y) => y.year), [2020, 2021, 2022, 2023, 2024, 2025]);
  for (const y of g.years) assert.equal(y.months.length, 12);
  assert.equal(g.years[0].months[1], null);                    // 2020-02 は期間の外
  assert.equal(g.years[0].months[2].span, 17);                 // 2020-03-15〜31
  assert.equal(g.years[5].months[10].span, 2);                 // 2025-11-01〜02
  assert.equal(g.years[5].months[11], null);                   // 2025-12 は期間の外
  assert.equal(g.years[4].months[1].span, 29);                 // 2024 はうるう年
  assert.deepEqual(g.years[3].months[6].cells.rhr, { n: 1, level: 1 });
  assert.deepEqual(g.years[5].months[10].cells.exercise, { n: 1, level: 2 });   // 2 日のうち 1 日 = 半分以上
  assert.equal(g.years.reduce((t, y) => t + y.months.filter(Boolean).length, 0), 69);   // 2020-03〜2025-11
});

test('monthGrid: 見本のデータで、升の日数が項目ごとの日数と合う', async () => {
  const res = await load(C.makeSample());
  const g = C.monthGrid(res.days);
  const sum = (it) => g.years.reduce((t, y) => t + y.months.filter(Boolean).reduce((u, m) => u + m.cells[it].n, 0), 0);
  const k = res.summary.counts;
  assert.equal(sum('steps'), k.steps); assert.equal(sum('sleep'), k.sleep); assert.equal(sum('score'), k.score);
  assert.equal(sum('rhr'), k.rhr); assert.equal(sum('weight'), k.weight);
  assert.equal(sum('exercise'), res.days.filter((d) => d.exCount).length);
});

// ---------- 2 つの列を 1 日 1 点で並べる図（Q-426） ----------
test('NUM_KEYS: 日ごとの行の数の列 15 個（日付・時刻・運動の種類を除く。DAILY_COLS の並び）', () => {
  assert.deepEqual(C.NUM_KEYS, ['steps', 'sleepMin', 'awakeMin', 'inBedMin', 'deep', 'light', 'rem', 'napMin', 'score', 'rhr', 'weight', 'bmi', 'fat', 'exCount', 'exMin']);
});

test('scatterPoints: 点の数 = 両方の値がある行の数（列の組 3 通り・欠けのある日）', () => {
  // 10 日: 歩数は全部、睡眠は偶数の日、心拍は 0〜5 日目、体重は 3 日目と 8 日目、7 日目は歩数も無い
  const days = daysOf('2026-05-01', 10, (i) => Object.assign({}, i !== 7 ? { steps: 1000 + i } : {}, i % 2 === 0 ? { sleepMin: 400 + i } : {},
    i <= 5 ? { rhr: 55 + i } : {}, i === 3 || i === 8 ? { weight: 60 + i / 10, weightKgRaw: 60 + i / 10 } : {}));
  const both = (a, b) => days.filter((d) => d[a] != null && d[b] != null).length;
  for (const [x, y] of [['steps', 'sleepMin'], ['sleepMin', 'rhr'], ['rhr', 'weight']]) {
    const p = C.scatterPoints(days, x, y);
    assert.equal(p.length, both(x, y), x + ' × ' + y);
    for (const q of p) { const d = days.find((r) => r.date === q.date); assert.equal(q.x, d[x]); assert.equal(q.y, d[y]); }
  }
  assert.equal(C.scatterPoints(days, 'steps', 'sleepMin').length, 5);   // 0・2・4・6・8 日目
  assert.equal(C.scatterPoints(days, 'sleepMin', 'rhr').length, 3);     // 0・2・4
  assert.equal(C.scatterPoints(days, 'rhr', 'weight').length, 1);       // 3
  // 日付の昇順
  const ds = C.scatterPoints(days, 'steps', 'sleepMin').map((q) => q.date);
  assert.deepEqual(ds, ds.slice().sort());
});

test('scatterPoints・scatterDefault: 1 列しか読めなかった記録は、どの組も点 0', async () => {
  const res = await load(C.makeSample().filter((f) => /resting_heart_rate/.test(f.path)));
  assert.ok(res.days.length > 0);
  assert.deepEqual(C.scatterDefault(res.days), ['rhr', 'steps']);
  for (const k of C.NUM_KEYS) if (k !== 'rhr') assert.equal(C.scatterPoints(res.days, 'rhr', k).length, 0, k);
});

test('scatterDefault: 値のある日数の多い 2 列。同じ数なら DAILY_COLS の並びの早い方', () => {
  // 心拍 5 日・体重 4 日・歩数 4 日 → 心拍と歩数（歩数が体重より前）
  const days = daysOf('2026-06-01', 5, (i) => Object.assign({ rhr: 60 }, i < 4 ? { weight: 60, steps: 10 } : {}));
  assert.deepEqual(C.scatterDefault(days), ['rhr', 'steps']);
  // 全部同じ数なら並びの先頭の 2 つ
  assert.deepEqual(C.scatterDefault(daysOf('2026-06-01', 3, () => ({ exMin: 1, fat: 20, score: 80, sleepMin: 400 }))), ['sleepMin', 'score']);
  // 0 件
  assert.deepEqual(C.scatterDefault([]), ['steps', 'sleepMin']);
});

test('scatterPoints: 押した日の 2 つの値 = 日ごとの CSV のその行の数（kg と lb）', async () => {
  const res = await load(C.makeSample());
  for (const unit of ['kg', 'lb']) {
    const cols = C.dailyCols(unit), csv = C.parseCsv(C.toCsv(res, 'daily', { weightOut: unit }));
    const byDate = new Map(csv.map((r) => [r['日付'], r]));   // parseCsv は見出しをキーにした行
    const col = (k) => cols.find((c) => c[0] === k)[1];
    for (const [x, y] of [['steps', 'weight'], ['sleepMin', 'score'], ['weight', 'fat']]) {
      const p = C.scatterPoints(res.days, x, y, unit);
      assert.ok(p.length >= 2, x + ' × ' + y);
      for (const q of p) {
        const row = byDate.get(q.date);
        assert.equal(String(q.x), row[col(x)]); assert.equal(String(q.y), row[col(y)]);
      }
    }
  }
});

test('axisTicks: 最小と最大と、その間の 2〜3 個（昇順）', () => {
  for (const [a, b] of [[0, 100], [55, 60], [390, 480], [3021, 14873], [67.9, 69.4], [1, 3], [0, 1], [56, 57], [148.3, 155.9]]) {
    const t = C.axisTicks(a, b);
    assert.equal(t[0], a); assert.equal(t[t.length - 1], b);
    assert.ok(t.length >= 4 && t.length <= 5, a + '〜' + b + ': ' + t);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], a + '〜' + b + ': ' + t);
  }
  assert.deepEqual(C.axisTicks(0, 100), [0, 25, 50, 75, 100]);
  assert.deepEqual(C.axisTicks(60, 60), [60]);
});

// ---------- 月ごとの平均を年ごとの線で重ねる図（Q-508） ----------
// 2025-11-20〜2027-02-10。2026-03 は記録が無い月、2026-07 は睡眠だけ、心拍は 2026 年だけ
function yoyDays() {
  return daysOf('2025-11-20', 448, (i) => {
    const t = Date.parse('2025-11-20T00:00:00Z') + i * 86400000, ym = new Date(t).toISOString().slice(0, 7);
    if (ym === '2026-03') return null;
    if (ym === '2026-07') return { sleepMin: 400 + (i % 7) };
    const o = { steps: 5000 + (i * 37) % 3000, sleepMin: 380 + (i % 50), score: 70 + (i % 15) };
    if (ym.startsWith('2026')) o.rhr = 55 + (i % 6);
    return o;
  }).filter((d) => d.date.slice(0, 7) !== '2026-03');
}

test('yearMonthAvg: 線の点の数 = avg が null でない月の数（項目 4 つ・年 3 つ・欠けた月）', () => {
  const days = yoyDays(), g = C.yearMonthAvg(days);
  assert.deepEqual(g.items, ['steps', 'sleepMin', 'score', 'rhr']);
  assert.deepEqual(g.years.map((y) => y.year), [2025, 2026, 2027]);
  // 月ごとに分けて、項目に値のある日が 1 日でもある月を数える（avg が null でない月）
  const byMonth = new Map();
  for (const d of days) { const k = d.date.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(d); }
  for (const it of g.items) {
    const want = [...byMonth.values()].filter((l) => l.some((d) => d[it] != null)).length;
    const got = g.years.reduce((t, y) => t + y.months.filter((m) => m && m[it] != null).length, 0);
    assert.equal(got, want, it);
  }
  assert.equal(g.years[0].months[9], null);          // 2025-10: 記録の前
  assert.equal(g.years[1].months[2], null);          // 2026-03: 記録の無い月
  assert.equal(g.years[1].months[6].steps, null);    // 2026-07: 歩数の無い月（0 にしない）
  assert.equal(g.years[2].months[2], null);          // 2027-03: 記録の後
  assert.equal(g.years[0].months[10].rhr, null);     // 2025-11: 心拍の無い年
});

test('yearMonthAvg: 月の平均 = 月ごとの Markdown の frontmatter の *_average（4 項目 × 3 か月）', () => {
  const days = daysOf('2026-04-01', 91, (i) => Object.assign({ steps: 4000 + i * 113, sleepMin: 350 + (i * 7) % 120, score: 60 + (i % 31) },
    i % 4 ? { rhr: 54 + (i % 9) } : {}));
  const g = C.yearMonthAvg(days), files = C.toMarkdownFiles({ days, exercises: [] }, { unit: 'month' });
  assert.equal(files.length, 3);
  let n = 0;
  for (const f of files) {
    const m = +f.name.slice(-5, -3), fm = Object.fromEntries(f.text.split('\n').filter((l) => /_average: /.test(l)).map((l) => l.split(': ')));
    for (const [k, key] of C.MONTH_AVG) { assert.equal(String(g.years[0].months[m - 1][k]), fm[key], f.name + ' ' + key); n++; }
  }
  assert.equal(n, 12);
});

test('yearMonthAvg: monthNote は同じ monthAvg から（見本の frontmatter が前と同じ）', async () => {
  const res = await load(C.makeSample());
  const fms = C.toMarkdownFiles(res, { unit: 'month' }).map((f) => f.text.split('\n---')[0]);
  assert.deepEqual(fms, [
    '---\nmonth: "2026-08"\ndays: 31\nsteps_average: 6169\nminutes_asleep_average: 438\nsleep_score_average: 78\nresting_heart_rate_average: 57\nsource: "fitbit-export"',
    '---\nmonth: "2026-09"\ndays: 19\nsteps_average: 6217\nminutes_asleep_average: 428\nsleep_score_average: 78\nresting_heart_rate_average: 58\nsource: "fitbit-export"',
  ]);
  const g = C.yearMonthAvg(res.days);
  assert.deepEqual(g.years.map((y) => y.year), [2026]);   // 年が 1 つの記録は 1 本
  assert.deepEqual(g.years[0].months[7], { steps: 6169, sleepMin: 438, score: 78, rhr: 57 });
});

test('yearMonthDefault: 平均の在る月のいちばん多い項目。同じ数なら歩数・睡眠時間・睡眠スコア・心拍の順', () => {
  assert.deepEqual(C.yearMonthDefault(C.yearMonthAvg(yoyDays())), { item: 'sleepMin', months: 15 });
  const same = daysOf('2026-01-01', 59, () => ({ score: 80, rhr: 55 }));
  assert.deepEqual(C.yearMonthDefault(C.yearMonthAvg(same)), { item: 'score', months: 2 });
  assert.deepEqual(C.yearMonthDefault(C.yearMonthAvg(daysOf('2026-01-01', 59, () => ({ rhr: 55, steps: 1 })))), { item: 'steps', months: 2 });
  const one = C.yearMonthAvg(daysOf('2026-01-01', 20, () => ({ steps: 1 })));
  assert.deepEqual(C.yearMonthDefault(one), { item: 'steps', months: 1 });   // 2 か月未満: 画面は図を出さない
  assert.deepEqual(C.yearMonthAvg([]).years, []);
  assert.deepEqual(C.yearMonthDefault(C.yearMonthAvg([])), { item: 'steps', months: 0 });
  // 既定の年は記録の最後の年（画面は years の最後を選ぶ）
  const g = C.yearMonthAvg(yoyDays());
  assert.equal(g.years[g.years.length - 1].year, 2027);
});
