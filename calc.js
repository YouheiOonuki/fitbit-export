// ===========================
// Fitbit（Google Health）の書き出しを読んで、日ごとの表・CSV・Markdown にする（画面から切り離した関数）
// DOM に触らない。tests/*.test.js から node --test で確かめる。ブラウザでは window.Calc、Node では module.exports
//
// 流れ: classify（ファイル名で種類を決める）→ parseInto（種類ごとに読んで raw にためる。時差に依らない形）
//       → aggregate（時差・体重の単位を当てて日ごとにまとめる。設定を変えたらここだけやり直す）→ toCsv / toMarkdownFiles
// 読む形式と、どこで確かめたかは constants.js の FORMATS。確かめきれていない扱いは README「開いた問い」
// ===========================
(function (root) {
  'use strict';

  // ---------- 日時 ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** "MM/DD/YY HH:MM:SS" または "MM/DD/YY"（Global Export Data の形） */
  function parseUs(s) {
    var m = /^(\d{2})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    return { y: 2000 + Number(m[3]), mo: Number(m[1]), d: Number(m[2]), h: Number(m[4] || 0), mi: Number(m[5] || 0), s: Number(m[6] || 0), off: null };
  }

  /** "2024-03-20T22:04:00.000"・"2024-10-27T00:00:04Z"・"2025-12-03 21:12:30+0000"・"2024-10-27" など。off は分（時差の書きが無ければ null） */
  function parseIso(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    var off = null;
    if (m[7]) {
      if (m[7] === 'Z') off = 0;
      else { var t = m[7].replace(':', ''); off = (t[0] === '-' ? -1 : 1) * (Number(t.slice(1, 3)) * 60 + Number(t.slice(3, 5))); }
    }
    return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4] || 0), mi: Number(m[5] || 0), s: Number(m[6] || 0), off: off };
  }
  /** "+09:00"・"-0500" → 分 */
  function parseOffset(s) {
    var m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(s == null ? '' : s).trim());
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
  }
  function parseAny(s) { return parseIso(s) || parseUs(s); }
  function wallMs(p) { return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s); }
  function dateOfMs(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function timeOfMs(ms) { var d = new Date(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function dateOf(p) { return p.y + '-' + pad(p.mo) + '-' + pad(p.d); }
  /** 時差の書きがあれば UTC の時刻（ms）、無ければ null */
  function utcMsOf(p) { return p && p.off != null ? wallMs(p) - p.off * 60000 : null; }

  /** タイムゾーン名（例 Asia/Tokyo）として使えるか */
  function isValidZone(tz) {
    if (!tz) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
  }

  /**
   * UTC の時刻 → そのタイムゾーンの「壁の時計」の時刻（UTC で表した ms）に直す関数を作る
   * 時差は 15 分の区切りごとに求めて覚える（世界の時差は 15 分の倍数で、切り替わりも区切りの上）
   */
  function zoneShifter(tz) {
    var fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var cache = new Map(), dayCache = new Map();
    function offAt(base) {
      var off = cache.get(base);
      if (off === undefined) {
        var p = {};
        fmt.formatToParts(new Date(base)).forEach(function (x) { p[x.type] = x.value; });
        off = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second)) - base;
        cache.set(base, off);
      }
      return off;
    }
    return function (ms) {
      // 1 日（UTC）の始めと終わりで時差が同じなら、その日は同じ時差（切り替わりの日だけ 15 分ごとに求める）
      var day = Math.floor(ms / 86400000), d = dayCache.get(day);
      if (d === undefined) {
        var a = offAt(day * 86400000), b = offAt(day * 86400000 + 86400000 - 900000);
        d = a === b ? a : null;
        dayCache.set(day, d);
      }
      return ms + (d !== null ? d : offAt(Math.floor(ms / 900000) * 900000));
    };
  }

  // ---------- CSV を読む ----------
  /** RFC 4180 の CSV を行の配列に。見出しは小文字・前後の空白を取って { 見出し: 値 } にする */
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false, s = String(text).replace(/^﻿/, '');
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); cell = ''; rows.push(row); row = [];
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    return rows.slice(1).filter(function (r) { return r.length > 1 || r[0] !== ''; }).map(function (r) {
      var o = {}; head.forEach(function (h, k) { o[h] = r[k] == null ? '' : r[k].trim(); }); return o;
    });
  }
  function num(v) { if (v === '' || v == null) return null; var n = Number(v); return isFinite(n) ? n : null; }

  // ---------- ファイルの種類 ----------
  // フォルダ名は見ない（Takeout の「Fitbit/Global Export Data/」、旧アカウントアーカイブの「Sleep/」「Physical Activity/」など、
  // 同じ名前のファイルが別のフォルダに入る）。名前だけで決める。order は読む順（睡眠を睡眠スコアより先に）
  var KINDS = [
    { kind: 'sleep-json', re: /^sleep-\d{4}-\d{2}-\d{2}\.json$/, order: 1 },
    { kind: 'sleep-csv', re: /^UserSleeps_.*\.csv$/, order: 2 },
    { kind: 'score-csv', re: /^sleep_score\.csv$/, order: 3 },
    { kind: 'steps-json', re: /^steps-\d{4}-\d{2}-\d{2}\.json$/, order: 4 },
    { kind: 'steps-csv', re: /^steps_\d{4}-\d{2}-\d{2}\.csv$/, order: 5 },
    { kind: 'rhr-json', re: /^resting_heart_rate-\d{4}-\d{2}-\d{2}\.json$/, order: 6 },
    { kind: 'rhr-csv', re: /^daily_resting_heart_rate\.csv$/, order: 7 },
    { kind: 'weight-json', re: /^weight-\d{4}-\d{2}-\d{2}\.json$/, order: 8 },
    { kind: 'weight-csv', re: /^weight\.csv$/, order: 9 },
    { kind: 'exercise-json', re: /^exercise-\d+\.json$/, order: 10 },
  ];
  function baseName(path) { var p = String(path).replace(/\\/g, '/'); return p.slice(p.lastIndexOf('/') + 1); }
  /** パス → 種類（読まないファイルは null） */
  function classify(path) {
    var b = baseName(path);
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].re.test(b)) return KINDS[i].kind;
    return null;
  }
  function kindOrder(kind) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i].kind === kind) return KINDS[i].order; return 99; }

  // ---------- 読んでためる（時差に依らない形） ----------
  function newRaw() {
    return {
      sleep: new Map(), sleepCsv: new Map(), score: [],
      // 歩数は 15 分の区切りごとの合計（utc: UTC の時刻、wall: 時差の書きが無い時刻）。分ごとの記録を全部は持たない
      steps: { json: { utc: new Map(), wall: new Map() }, csv: { utc: new Map(), wall: new Map() } },
      rhr: { json: new Map(), csv: new Map() },
      weight: [], exercise: new Map(),
      files: {}, seen: new Set(),
    };
  }
  function addBucket(map, ms, v) { var k = Math.floor(ms / 900000); map.set(k, (map.get(k) || 0) + v); }
  function wallStr(p) { return p ? dateOf(p) + ' ' + pad(p.h) + ':' + pad(p.mi) : ''; }

  function sleepFromJson(s) {
    if (!s || typeof s.dateOfSleep !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.dateOfSleep)) return null;
    var sum = (s.levels && s.levels.summary) || {};
    var stage = function (k) { return sum[k] && typeof sum[k].minutes === 'number' ? sum[k].minutes : null; };
    var staged = s.type === 'stages';   // "classic"（古い形）は深い・浅い・レムの内訳が無い
    return {
      id: String(s.logId), date: s.dateOfSleep,
      start: wallStr(parseIso(s.startTime)), end: wallStr(parseIso(s.endTime)),
      asleep: num(s.minutesAsleep), awake: num(s.minutesAwake), inBed: num(s.timeInBed),
      main: s.mainSleep === true,
      deep: staged ? stage('deep') : null, light: staged ? stage('light') : null, rem: staged ? stage('rem') : null,
    };
  }

  /**
   * 1 ファイルを読んで raw にためる。形が違えば例外（呼び出し側でファイルごとの読めなかった理由にする）
   * @returns {number} 読めた記録の数
   */
  function parseInto(raw, kind, text) {
    var n = 0;
    var json = function () { var a = JSON.parse(text); if (!Array.isArray(a)) { var err = new Error('形が違います（配列ではありません）'); err.code = 'notArray'; throw err; } return a; };
    switch (kind) {
      case 'sleep-json':
        json().forEach(function (s) { var r = sleepFromJson(s); if (r) { raw.sleep.set(r.id, r); n++; } });
        break;
      case 'sleep-csv':
        // Health Fitness Data_GoogleData/UserSleeps_*.csv（新しい形。列名は公開のパーサー 1 件で確かめただけ）
        parseCsv(text).forEach(function (r) {
          var st = parseIso(r.sleep_start), en = parseIso(r.sleep_end);
          var so = parseOffset(r.start_utc_offset), eo = parseOffset(r.end_utc_offset);
          if (!st || !en || st.off == null || en.off == null || so == null || eo == null) return;
          var s = utcMsOf(st) + so * 60000, e = utcMsOf(en) + eo * 60000;
          var id = 'csv:' + (r.sleep_id || s);
          raw.sleepCsv.set(id, {
            id: id, date: dateOfMs(e), start: dateOfMs(s) + ' ' + timeOfMs(s), end: dateOfMs(e) + ' ' + timeOfMs(e),
            asleep: num(r.minutes_asleep), awake: num(r.minutes_awake), inBed: num(r.minutes_in_sleep_period),
            main: false, deep: null, light: null, rem: null,
          });
          n++;
        });
        break;
      case 'score-csv':
        parseCsv(text).forEach(function (r) {
          var p = parseAny(r.timestamp), v = num(r.overall_score);
          if (!p || v == null) return;
          raw.score.push({ id: r.sleep_log_entry_id ? String(r.sleep_log_entry_id) : null, date: dateOf(p), value: v });
          n++;
        });
        break;
      case 'steps-json':
        // 分ごとの記録。dateTime は UTC とみなす（constants.js の FORMATS）
        json().forEach(function (e) {
          var p = e && parseUs(e.dateTime), v = e && num(e.value);
          if (!p || v == null) return;
          addBucket(raw.steps.json.utc, wallMs(p), v); n++;
        });
        break;
      case 'steps-csv':
        parseCsv(text).forEach(function (r) {
          var p = parseAny(r.timestamp), v = num(r.steps);
          if (!p || v == null) return;
          var u = utcMsOf(p);
          if (u != null) addBucket(raw.steps.csv.utc, u, v); else addBucket(raw.steps.csv.wall, wallMs(p), v);
          n++;
        });
        break;
      case 'rhr-json':
        json().forEach(function (e) {
          var v = e && e.value && num(e.value.value);
          var p = (e && e.value && parseUs(e.value.date)) || (e && parseUs(e.dateTime));
          if (!p || v == null || v <= 0) return;
          raw.rhr.json.set(dateOf(p), v); n++;
        });
        break;
      case 'rhr-csv':
        // 1 日 1 行の値なので、時刻の部分は見ずに日付をそのまま使う
        parseCsv(text).forEach(function (r) {
          var p = parseAny(r.timestamp), v = num(r['beats per minute']);
          if (!p || v == null || v <= 0) return;
          raw.rhr.csv.set(dateOf(p), v); n++;
        });
        break;
      case 'weight-json':
        json().forEach(function (e) {
          var p = e && parseUs(e.date + ' ' + (e.time || '00:00:00')), v = e && num(e.weight);
          if (!p || v == null || v <= 0) return;
          raw.weight.push({ src: 'json', wall: wallMs(p), utc: null, value: v, bmi: num(e.bmi), fat: num(e.fat) }); n++;
        });
        break;
      case 'weight-csv':
        parseCsv(text).forEach(function (r) {
          var p = parseAny(r.timestamp), g = num(r['weight grams']);
          if (!p || g == null || g <= 0) return;
          raw.weight.push({ src: 'csv', wall: p.off == null ? wallMs(p) : null, utc: utcMsOf(p), value: g / 1000, bmi: null, fat: null }); n++;
        });
        break;
      case 'exercise-json':
        json().forEach(function (e) {
          if (!e || e.logId == null) return;
          // originalStartTime に時差の書きがあれば、その壁の時計。無ければ startTime（UTC とみなす）
          var o = parseIso(e.originalStartTime), p = parseUs(e.startTime);
          var local = o && o.off != null;
          var rec = {
            id: String(e.logId), name: String(e.activityName || ''),
            wall: local ? wallMs(o) : null, utc: local ? null : (p ? wallMs(p) : null),
            minutes: num(e.duration) != null ? Math.round(num(e.duration) / 60000) : null,
            activeMinutes: num(e.activeDuration) != null ? Math.round(num(e.activeDuration) / 60000) : null,
            steps: num(e.steps), calories: num(e.calories), hr: num(e.averageHeartRate),
          };
          if (rec.wall == null && rec.utc == null) return;
          raw.exercise.set(rec.id, rec); n++;
        });
        break;
      default:
        return 0;
    }
    raw.files[kind] = (raw.files[kind] || 0) + 1;
    return n;
  }

  /**
   * 読むファイルの一覧を順に読む。ファイルは端末の中で読むだけで、どこにも送らない
   * @param {Array<{path:string, size?:number, read:function():Promise<string>}>} sources
   * @param {function({done:number,total:number,path:string})} [onProgress]
   * @param {object} [raw] 足していくときの前回の raw
   * @returns {Promise<{raw:object, errors:Array<{path:string,message:string}>, skipped:number, total:number}>}
   */
  function importSources(sources, onProgress, raw) {
    raw = raw || newRaw();
    var errors = [], picked = [], skipped = 0;
    sources.forEach(function (s) {
      var kind = classify(s.path);
      if (!kind) { skipped++; return; }
      var key = String(s.path).replace(/\\/g, '/') + '|' + (s.size == null ? '' : s.size);   // 同じファイルを 2 回選んでも 1 回だけ読む
      if (raw.seen.has(key)) return;
      raw.seen.add(key);
      picked.push({ s: s, kind: kind });
    });
    picked.sort(function (a, b) { return kindOrder(a.kind) - kindOrder(b.kind) || (a.s.path < b.s.path ? -1 : 1); });
    var done = 0;
    return picked.reduce(function (p, it) {
      return p.then(function () {
        return Promise.resolve().then(function () { return it.s.read(); })
          .then(function (text) { parseInto(raw, it.kind, text); })
          .catch(function (e) { errors.push({ path: it.s.path, message: e && e.message ? e.message : String(e), code: e && e.code, arg: e && e.arg }); })
          .then(function () { done++; if (onProgress) onProgress({ done: done, total: picked.length, path: it.s.path }); });
      });
    }, Promise.resolve()).then(function () {
      return { raw: raw, errors: errors, skipped: skipped, total: picked.length };
    });
  }

  // ---------- 日ごとにまとめる ----------
  var LB = 0.45359237;
  function push(map, k, v) { var a = map.get(k); if (!a) { a = []; map.set(k, a); } a.push(v); }

  /**
   * @param {object} raw importSources の raw
   * @param {{tz:string, weightUnit:'auto'|'lb'|'kg'}} opts
   * @returns {{days:object[], exercises:object[], summary:object}}
   */
  function aggregate(raw, opts) {
    opts = opts || {};
    var tz = isValidZone(opts.tz) ? opts.tz : 'UTC';
    var shift = zoneShifter(tz);
    var days = new Map();
    function day(d) { var r = days.get(d); if (!r) { r = { date: d }; days.set(d, r); } return r; }

    // 歩数: JSON と CSV を別々に日ごとに足し、同じ日があれば比べる（食い違いは内訳に出す）。両方あれば JSON を使う
    function stepsByDay(src) {
      var m = new Map();
      src.utc.forEach(function (v, k) { var d = dateOfMs(shift(k * 900000)); m.set(d, (m.get(d) || 0) + v); });
      src.wall.forEach(function (v, k) { var d = dateOfMs(k * 900000); m.set(d, (m.get(d) || 0) + v); });
      return m;
    }
    var sj = stepsByDay(raw.steps.json), sc = stepsByDay(raw.steps.csv);
    var stepCompare = { compared: 0, differ: 0, examples: [] };
    sj.forEach(function (v, d) { day(d).steps = Math.round(v); });
    sc.forEach(function (v, d) {
      if (!sj.has(d)) { day(d).steps = Math.round(v); return; }
      stepCompare.compared++;
      if (Math.round(v) !== Math.round(sj.get(d))) {
        stepCompare.differ++;
        if (stepCompare.examples.length < 3) stepCompare.examples.push({ date: d, json: Math.round(sj.get(d)), csv: Math.round(v) });
      }
    });

    // 睡眠: JSON（Global Export Data）を使い、JSON の無い日だけ新しい形の CSV を使う
    var sleepByDate = new Map(), sleepSrc = { json: 0, csv: 0 };
    raw.sleep.forEach(function (s) { push(sleepByDate, s.date, s); });
    var jsonDates = new Set(sleepByDate.keys());
    raw.sleepCsv.forEach(function (s) { if (!jsonDates.has(s.date)) push(sleepByDate, s.date, s); });
    var idToDate = new Map();
    sleepByDate.forEach(function (list, d) {
      list.forEach(function (s) { idToDate.set(s.id, d); });
      var mains = list.filter(function (s) { return s.main; });
      var main = (mains.length ? mains : list).reduce(function (a, b) { return (b.asleep || 0) > (a.asleep || 0) ? b : a; });
      var r = day(d);
      r.sleepStart = main.start || null; r.sleepEnd = main.end || null;
      r.sleepMin = main.asleep; r.awakeMin = main.awake; r.inBedMin = main.inBed;
      r.deep = main.deep; r.light = main.light; r.rem = main.rem;
      var others = list.filter(function (s) { return s !== main; }).reduce(function (t, s) { return t + (s.asleep || 0); }, 0);
      r.napMin = others || null;
      if (String(main.id).indexOf('csv:') === 0) sleepSrc.csv++; else sleepSrc.json++;
    });

    // 睡眠スコア: 記録の ID（sleep_log_entry_id）が睡眠の記録と結べればその日、結べなければ timestamp の日付
    var scoreLinked = 0;
    raw.score.forEach(function (s) {
      var d = s.id && idToDate.get(s.id);
      if (d) scoreLinked++; else d = s.date;
      day(d).score = s.value;
    });

    // 安静時心拍数: 両方あれば JSON。整数に四捨五入
    raw.rhr.csv.forEach(function (v, d) { day(d).rhr = Math.round(v); });
    raw.rhr.json.forEach(function (v, d) { day(d).rhr = Math.round(v); });

    // 体重: JSON の単位（ポンドか kg か）を決める。CSV（グラム）と同じ日があれば比べて決める
    var unitInfo = decideWeightUnit(raw.weight, opts.weightUnit, shift);
    raw.weight.map(function (w) {
      var local = w.wall != null ? w.wall : shift(w.utc);
      var kg = w.src === 'json' && unitInfo.unit === 'lb' ? w.value * LB : w.value;
      return { date: dateOfMs(local), t: local, kg: kg, bmi: w.bmi, fat: w.fat, src: w.src };
    }).sort(function (a, b) { return a.t - b.t || (a.src === 'json' ? 1 : -1); }).forEach(function (w) {
      var r = day(w.date);   // その日の最後の記録（同じ時刻なら JSON）
      r.weight = Math.round(w.kg * 10) / 10;
      r.weightKgRaw = w.kg;   // 丸める前の kg（出力をポンドにするとき、丸めた kg から戻して 0.1 ずれないように）
      if (w.bmi != null) r.bmi = Math.round(w.bmi * 10) / 10;
      if (w.fat != null) r.fat = Math.round(w.fat * 10) / 10;
    });

    // 運動
    var exercises = [];
    raw.exercise.forEach(function (e) {
      var local = e.wall != null ? e.wall : shift(e.utc);
      exercises.push({ date: dateOfMs(local), start: dateOfMs(local) + ' ' + timeOfMs(local), t: local, name: e.name,
        minutes: e.minutes, activeMinutes: e.activeMinutes, steps: e.steps, calories: e.calories, hr: e.hr });
    });
    exercises.sort(function (a, b) { return a.t - b.t; });
    exercises.forEach(function (e) {
      var r = day(e.date);
      r.exCount = (r.exCount || 0) + 1;
      r.exMin = (r.exMin || 0) + (e.minutes || 0);
      r.exNames = (r.exNames || []).concat(e.name);
    });

    var list = Array.from(days.values()).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var count = function (k) { return list.filter(function (r) { return r[k] != null; }).length; };
    return {
      days: list, exercises: exercises,
      summary: {
        tz: tz, from: list.length ? list[0].date : null, to: list.length ? list[list.length - 1].date : null, dayCount: list.length,
        counts: { steps: count('steps'), sleep: count('sleepMin'), score: count('score'), rhr: count('rhr'), weight: count('weight'), exercise: exercises.length },
        sources: { stepsJson: sj.size, stepsCsv: sc.size, sleepJson: sleepSrc.json, sleepCsv: sleepSrc.csv, rhrJson: raw.rhr.json.size, rhrCsv: raw.rhr.csv.size,
          scoreLinked: scoreLinked, scoreTotal: raw.score.length },
        stepCompare: stepCompare, weightUnit: unitInfo, files: Object.assign({}, raw.files),
      },
    };
  }

  /** JSON の体重の単位。選んだ単位 → CSV（グラム）と同じ日で比べる → どちらも無ければポンドとみなす */
  function decideWeightUnit(weights, choice, shift) {
    var json = weights.filter(function (w) { return w.src === 'json'; });
    var last = json.reduce(function (a, b) { return !a || b.wall > a.wall ? b : a; }, null);
    var info = { unit: 'lb', reason: 'assumed', sample: last ? { date: dateOfMs(last.wall), value: last.value } : null, compared: 0 };
    if (choice === 'lb' || choice === 'kg') { info.unit = choice; info.reason = 'chosen'; return info; }
    if (!json.length) { info.reason = 'none'; return info; }
    var csvByDate = new Map();
    weights.forEach(function (w) { if (w.src === 'csv') csvByDate.set(dateOfMs(w.wall != null ? w.wall : shift(w.utc)), w.value); });
    var lb = 0, kg = 0;
    json.forEach(function (w) {
      var c = csvByDate.get(dateOfMs(w.wall));
      if (c == null) return;
      if (Math.abs(w.value * LB - c) < 0.3) lb++;
      else if (Math.abs(w.value - c) < 0.3) kg++;
    });
    info.compared = lb + kg;
    if (lb + kg > 0) { info.unit = lb >= kg ? 'lb' : 'kg'; info.reason = 'matched'; }
    return info;
  }

  // ---------- 書き出し ----------
  // [キー, 日本語の列名, 英語の列名（Markdown の frontmatter のキーと同じ）]
  var DAILY_COLS = [
    ['date', '日付', 'date'],
    ['steps', '歩数', 'steps'],
    ['sleepStart', '寝た時刻', 'sleep_start'],
    ['sleepEnd', '起きた時刻', 'sleep_end'],
    ['sleepMin', '睡眠時間(分)', 'minutes_asleep'],
    ['awakeMin', '目覚めていた時間(分)', 'minutes_awake'],
    ['inBedMin', 'ベッドにいた時間(分)', 'time_in_bed'],
    ['deep', '深い睡眠(分)', 'deep_minutes'],
    ['light', '浅い睡眠(分)', 'light_minutes'],
    ['rem', 'レム睡眠(分)', 'rem_minutes'],
    ['napMin', 'ほかの睡眠(分)', 'other_sleep_minutes'],
    ['score', '睡眠スコア', 'sleep_score'],
    ['rhr', '安静時心拍数', 'resting_heart_rate'],
    ['weight', '体重(kg)', 'weight_kg'],
    ['bmi', 'BMI', 'bmi'],
    ['fat', '体脂肪率(%)', 'body_fat_percent'],
    ['exCount', '運動(回)', 'exercise_count'],
    ['exMin', '運動(分)', 'exercise_minutes'],
    ['exNames', '運動の種類', 'exercise_types'],
  ];
  var EXERCISE_COLS = [
    ['start', '開始', 'start'],
    ['name', '種類', 'activity'],
    ['minutes', '記録の長さ(分)', 'duration_minutes'],
    ['activeMinutes', '動いた時間(分)', 'active_minutes'],
    ['steps', '歩数', 'steps'],
    ['calories', '消費カロリー(kcal)', 'calories'],
    ['hr', '平均心拍数', 'average_heart_rate'],
  ];

  /** 出力の体重の単位（'kg' か 'lb'）。英語の画面で選べる。既定は kg */
  function weightOut(u) { return u === 'lb' ? 'lb' : 'kg'; }
  /** その日の体重を出力の単位で（0.1 に丸める） */
  function weightIn(r, unit) {
    if (r.weight == null) return null;
    if (weightOut(unit) === 'kg') return r.weight;
    var kg = r.weightKgRaw != null ? r.weightKgRaw : r.weight;
    return Math.round(kg / LB * 10) / 10;
  }
  /** 日ごとの列（体重の列だけ単位で名前が変わる） */
  function dailyCols(unit) {
    if (weightOut(unit) === 'kg') return DAILY_COLS;
    return DAILY_COLS.map(function (c) { return c[0] === 'weight' ? ['weight', '体重(lb)', 'weight_lb'] : c; });
  }
  function cellValue(r, key, unit) { return key === 'weight' ? weightIn(r, unit) : r[key]; }

  function inRange(d, from, to) { return (!from || d >= from) && (!to || d <= to); }
  function csvCell(v) {
    if (v == null) return '';
    var s = Array.isArray(v) ? v.join(' / ') : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /**
   * 表を CSV に（Excel 向けに行末は CRLF。BOM を付けると Excel が UTF-8 と分かる）
   * @param {'daily'|'exercise'} which
   * @param {{bom?:boolean, lang?:'ja'|'en', from?:string, to?:string, weightOut?:'kg'|'lb'}} o
   */
  function toCsv(result, which, o) {
    o = o || {};
    var cols = which === 'exercise' ? EXERCISE_COLS : dailyCols(o.weightOut);
    var rows = (which === 'exercise' ? result.exercises : result.days).filter(function (r) { return inRange(r.date, o.from, o.to); });
    var lines = [cols.map(function (c) { return csvCell(o.lang === 'en' ? c[2] : c[1]); }).join(',')];
    rows.forEach(function (r) { lines.push(cols.map(function (c) { return csvCell(which === 'exercise' ? r[c[0]] : cellValue(r, c[0], o.weightOut)); }).join(',')); });
    return (o.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
  }

  function yamlValue(v) {
    if (Array.isArray(v)) return '[' + v.map(function (x) { return JSON.stringify(String(x)); }).join(', ') + ']';
    if (typeof v === 'number') return String(v);
    return JSON.stringify(String(v));   // 文字列はすべて二重引用符（"22:04" が数に読まれないように）
  }
  function hm(min) { return Math.floor(min / 60) + (min % 60 < 10 ? ':0' : ':') + (min % 60); }
  var L = {
    ja: { steps: '歩数', sleep: '睡眠', score: '睡眠スコア', rhr: '安静時心拍数', weight: '体重', ex: '運動', deep: '深い', light: '浅い', rem: 'レム', fat: '体脂肪率', nap: 'ほかの睡眠',
      min: '分', stepsU: ' 歩', date: '日付', dash: '〜', sep: '・', exSep: '、', open: '（', close: '）', stageLead: '',
      dur: function (m) { return Math.floor(m / 60) + '時間' + (m % 60) + '分'; } },
    en: { steps: 'Steps', sleep: 'Sleep', score: 'Sleep score', rhr: 'Resting heart rate', weight: 'Weight', ex: 'Exercise', deep: 'deep', light: 'light', rem: 'REM', fat: 'body fat', nap: 'Other sleep',
      min: ' min', stepsU: '', date: 'Date', dash: '–', sep: ', ', exSep: ', ', open: ' (', close: ')', stageLead: ', ',
      dur: function (m) { return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; } },
  };
  function fmtInt(n, lang) { return Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'ja-JP'); }
  function sleepLine(r, t) {
    if (r.sleepMin == null) return null;
    var s = (r.sleepStart ? r.sleepStart.slice(11) + t.dash + (r.sleepEnd || '').slice(11) : '') + t.open + t.dur(r.sleepMin) + t.close;
    var st = [];
    if (r.deep != null) st.push(t.deep + ' ' + r.deep + t.min);
    if (r.light != null) st.push(t.light + ' ' + r.light + t.min);
    if (r.rem != null) st.push(t.rem + ' ' + r.rem + t.min);
    return (s + (st.length ? t.stageLead + st.join(t.sep) : '')).trim();
  }

  /** 1 日分のノート（frontmatter つき） */
  function dayNote(r, lang, unit) {
    var t = L[lang === 'en' ? 'en' : 'ja'], fm = ['---'], wu = weightOut(unit);
    dailyCols(wu).forEach(function (c) {
      var v = cellValue(r, c[0], wu);
      if (v == null) return;
      if (c[0] === 'sleepStart' || c[0] === 'sleepEnd') v = v.replace(' ', 'T');
      fm.push(c[2] + ': ' + yamlValue(v));
    });
    fm.push('source: "fitbit-export"', '---', '', '# ' + r.date, '');
    var b = [];
    if (r.steps != null) b.push('- ' + t.steps + ': ' + fmtInt(r.steps, lang) + t.stepsU);
    var sl = sleepLine(r, t); if (sl) b.push('- ' + t.sleep + ': ' + sl);
    if (r.napMin != null) b.push('- ' + t.nap + ': ' + r.napMin + t.min);
    if (r.score != null) b.push('- ' + t.score + ': ' + r.score);
    if (r.rhr != null) b.push('- ' + t.rhr + ': ' + r.rhr);
    if (r.weight != null) b.push('- ' + t.weight + ': ' + weightIn(r, wu) + ' ' + wu + (r.fat != null ? t.open + t.fat + ' ' + r.fat + '%' + t.close : ''));
    if (r.exNames) b.push('- ' + t.ex + ': ' + r.exNames.join(t.exSep) + (r.exMin ? t.open + r.exMin + t.min + t.close : ''));
    return fm.concat(b).join('\n') + '\n';
  }

  function avg(list, k) {
    var v = list.map(function (r) { return r[k]; }).filter(function (x) { return x != null; });
    return v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length) : null;
  }
  /** 1 か月分のノート（frontmatter に平均、本文に日ごとの表） */
  function monthNote(month, list, lang, unit) {
    var t = L[lang === 'en' ? 'en' : 'ja'], wu = weightOut(unit);
    var fm = ['---', 'month: ' + yamlValue(month), 'days: ' + list.length];
    [['steps', 'steps_average'], ['sleepMin', 'minutes_asleep_average'], ['score', 'sleep_score_average'], ['rhr', 'resting_heart_rate_average']].forEach(function (p) {
      var a = avg(list, p[0]); if (a != null) fm.push(p[1] + ': ' + a);
    });
    fm.push('source: "fitbit-export"', '---', '', '# ' + month, '');
    var head = [t.date, t.steps, t.sleep, t.score, t.rhr, t.weight + ' (' + wu + ')', t.ex];
    var rows = ['| ' + head.join(' | ') + ' |', '|' + head.map(function () { return ' --- '; }).join('|') + '|'];
    list.forEach(function (r) {
      var cells = [r.date, r.steps != null ? fmtInt(r.steps, lang) : '', r.sleepMin != null ? hm(r.sleepMin) : '', r.score != null ? r.score : '',
        r.rhr != null ? r.rhr : '', r.weight != null ? weightIn(r, wu) : '', r.exNames ? r.exNames.join(t.exSep) : ''];
      rows.push('| ' + cells.map(function (c) { return String(c).replace(/\|/g, '\\|'); }).join(' | ') + ' |');
    });
    return fm.concat(rows).join('\n') + '\n';
  }

  /**
   * Markdown のファイルの束（zip に入れる）。フォルダ「Fitbit/」の下に 1 日 1 ファイルか 1 か月 1 ファイル
   * @param {{unit?:'day'|'month', lang?:'ja'|'en', from?:string, to?:string, weightOut?:'kg'|'lb'}} o
   * @returns {Array<{name:string, text:string}>}
   */
  function toMarkdownFiles(result, o) {
    o = o || {};
    var rows = result.days.filter(function (r) { return inRange(r.date, o.from, o.to); });
    if (o.unit === 'month') {
      var byMonth = new Map();
      rows.forEach(function (r) { push(byMonth, r.date.slice(0, 7), r); });
      return Array.from(byMonth.keys()).map(function (m) { return { name: 'Fitbit/' + m + '.md', text: monthNote(m, byMonth.get(m), o.lang, o.weightOut) }; });
    }
    return rows.map(function (r) { return { name: 'Fitbit/' + r.date + '.md', text: dayNote(r, o.lang, o.weightOut) }; });
  }

  // ---------- 見本（架空のデータ） ----------
  /**
   * 書き出しと同じ名前・形の架空のファイルを作る（画面の「見本で試す」とテストで使う。実在の人のデータではない）
   * 日本時間で 2026-08-01〜2026-09-19 の 50 日分。歩数と運動の時刻は UTC で書く（本物の書き出しの扱いに合わせる）
   * 体重はポンド（150 lb 前後 ≒ 68 kg）
   */
  function makeSample() {
    var seed = 20260925;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    var D = 'Takeout/Fitbit/Global Export Data/';
    var us = function (ms) { var d = new Date(ms); return pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + '/' + pad(d.getUTCFullYear() % 100) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); };
    var iso = function (ms) { return new Date(ms).toISOString().slice(0, 23); };
    var JST = 9 * 3600000, start = Date.UTC(2026, 7, 1), N = 50;
    var sleep = [], steps = [], rhr = [], weight = [], ex = [];
    var scores = ['sleep_log_entry_id,timestamp,overall_score,composition_score,revitalization_score,duration_score,deep_sleep_in_minutes,resting_heart_rate,restlessness'];
    for (var i = 0; i < N; i++) {
      var dayWall = start + i * 86400000;   // その日の 0:00（日本時間の壁の時計を UTC で表したもの）
      var date = dateOfMs(dayWall);
      // 睡眠: 前の日の 23 時台に寝て、その日の 6〜7 時台に起きる
      var bed = dayWall - 3600000 + Math.floor(rnd() * 50) * 60000, dur = 390 + Math.floor(rnd() * 90);
      var deep = 50 + Math.floor(rnd() * 40), rem = 70 + Math.floor(rnd() * 40), wake = 30 + Math.floor(rnd() * 25);
      var id = 50000000000 + i, end = bed + (dur + wake) * 60000;
      sleep.push({ logId: id, dateOfSleep: date, startTime: iso(bed), endTime: iso(end), duration: (dur + wake) * 60000,
        minutesToFallAsleep: 0, minutesAsleep: dur, minutesAwake: wake, minutesAfterWakeup: 0, timeInBed: dur + wake, efficiency: 90 + Math.floor(rnd() * 8),
        type: 'stages', infoCode: 0, logType: 'auto_detected',
        levels: { summary: { deep: { count: 3, minutes: deep, thirtyDayAvgMinutes: 0 }, wake: { count: 20, minutes: wake, thirtyDayAvgMinutes: 0 },
          light: { count: 25, minutes: dur - deep - rem, thirtyDayAvgMinutes: 0 }, rem: { count: 5, minutes: rem, thirtyDayAvgMinutes: 0 } }, data: [], shortData: [] },
        mainSleep: true });
      scores.push(id + ',' + date + 'T' + timeOfMs(end) + ':00Z,' + (70 + Math.floor(rnd() * 20)) + ',20,20,40,' + deep + ',' + (55 + Math.floor(rnd() * 6)) + ',0.08');
      // 歩数: 7〜22 時（日本時間）に 5 分おきの記録。書き出しの時刻は UTC
      for (var h = 7; h < 22; h++) for (var m = 0; m < 60; m += 5) {
        steps.push({ dateTime: us(dayWall + (h * 60 + m) * 60000 - JST), value: String(Math.floor(rnd() * 70)) });
      }
      rhr.push({ dateTime: us(dayWall).slice(0, 8) + ' 00:00:00', value: { date: us(dayWall).slice(0, 8), value: 55 + rnd() * 5, error: 6.5 } });
      if (i % 3 === 0) weight.push({ logId: 1780000000000 + i, weight: Math.round((150 + rnd() * 3) * 10) / 10, bmi: 22.4, fat: 20 + Math.round(rnd() * 20) / 10, date: us(dayWall).slice(0, 8), time: '07:10:00', source: 'Aria' });
      if (i % 4 === 1) {
        var ws = dayWall + (18 * 60 + 30) * 60000;
        ex.push({ logId: 60000000000 + i, activityName: i % 8 === 1 ? 'Walk' : 'Run', activityTypeId: i % 8 === 1 ? 90013 : 90009, averageHeartRate: 110 + Math.floor(rnd() * 30),
          calories: 150 + Math.floor(rnd() * 150), duration: (25 + Math.floor(rnd() * 20)) * 60000, activeDuration: (24 + Math.floor(rnd() * 20)) * 60000,
          steps: 3000 + Math.floor(rnd() * 3000), logType: 'auto_detected', startTime: us(ws - JST), hasGps: false });
      }
    }
    var J = function (a) { return JSON.stringify(a, null, 1); };
    return [
      { path: D + 'sleep-2026-07-31.json', text: J(sleep.slice(0, 30).reverse()) },
      { path: D + 'sleep-2026-08-30.json', text: J(sleep.slice(30).reverse()) },
      { path: D + 'steps-2026-08-01.json', text: J(steps.slice(0, 31 * 180)) },
      { path: D + 'steps-2026-09-01.json', text: J(steps.slice(31 * 180)) },
      { path: D + 'resting_heart_rate-2026-08-01.json', text: J(rhr) },
      { path: D + 'weight-2026-08-01.json', text: J(weight) },
      { path: D + 'exercise-0.json', text: J(ex) },
      { path: 'Takeout/Fitbit/Sleep Score/sleep_score.csv', text: scores.join('\n') + '\n' },
      { path: D + 'heart_rate-2026-08-01.json', text: '[]' },   // 読まないファイルの例
    ];
  }

  var api = {
    parseUs: parseUs, parseIso: parseIso, parseOffset: parseOffset, parseCsv: parseCsv, isValidZone: isValidZone, zoneShifter: zoneShifter,
    classify: classify, newRaw: newRaw, parseInto: parseInto, importSources: importSources, aggregate: aggregate,
    toCsv: toCsv, toMarkdownFiles: toMarkdownFiles, dayNote: dayNote, monthNote: monthNote, makeSample: makeSample,
    weightIn: weightIn, DAILY_COLS: DAILY_COLS, EXERCISE_COLS: EXERCISE_COLS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
