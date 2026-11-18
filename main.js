// ===========================
// Fitbit データ CSV 変換 — 画面の制御
// 読み込みと変換は calc.js・zip.js、画面の文は text.js（<html lang="en"> なら英語）。ファイルはこの端末の中で読むだけで、どこにも送らない（fetch も使わない）
// ファイルも設定も localStorage に保存しない（健康の記録を端末に残さないため。README「決めたこと」）
// ===========================
(function () {
  'use strict';
  var C = window.Calc, Z = window.Zip;
  var EN = document.documentElement.lang === 'en';
  var T = window.Text.TEXT[EN ? 'en' : 'ja'];
  function $(id) { return document.getElementById(id); }
  var el = {
    result: $('result'), sub: $('result-sub'), grid: $('grid'), scatter: $('scatter'), dlRow: $('dl-row'), detail: $('detail'), detailTable: $('detail-table'), notes: $('notes'), preview: $('preview'),
    bom: $('bom'), lang: $('lang'), mdUnit: $('md-unit'), from: $('from'), to: $('to'), tz: $('tz'), wunit: $('wunit'),
    wout: $('wout'),   // 出力の体重の単位（英語の画面だけ。日本語の画面は kg）
  };
  // sx・sy: 図の横と縦の列（null なら記録から決まる既定）。sel: 図で選んだ日の日付
  var state = { raw: null, res: null, errors: [], skipped: 0, busy: false, sx: null, sy: null, sel: null };

  // --- タイムゾーンの選択肢（既定はこの端末の設定） ---
  var here = 'UTC';
  try { here = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* 古いブラウザ */ }
  var zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = []; }
  [here, 'Asia/Tokyo', 'UTC'].forEach(function (z) { if (zones.indexOf(z) < 0) zones.unshift(z); });
  zones.forEach(function (z) {
    var o = document.createElement('option'); o.value = z; o.textContent = z + (z === here ? T.here : '');
    el.tz.appendChild(o);
  });
  el.tz.value = here;

  function fmt(n) { return Number(n).toLocaleString(T.locale); }
  function text(e, t) { e.textContent = t; }
  function cell(tag, t) { var c = document.createElement(tag); c.textContent = t == null ? '' : String(t); return c; }
  function row(tag, cells) { var tr = document.createElement('tr'); cells.forEach(function (t) { tr.appendChild(cell(tag, t)); }); return tr; }
  function li(t) { var x = document.createElement('li'); x.textContent = t; el.notes.appendChild(x); }

  function outOpts() {
    return { bom: el.bom.checked, lang: el.lang.value, unit: el.mdUnit.value, from: el.from.value || null, to: el.to.value || null, weightOut: el.wout ? el.wout.value : 'kg' };
  }
  function syncSummary() {
    YorozuScreen.detailsSummary({ 'opt-out': T.outState(outOpts()), 'opt-time': T.timeState(el.tz.value, el.wunit.value) });
  }

  // --- 項目 × 月の升目（図。数は升ごとの aria-label。並びは calc.js の monthGrid） ---
  var SVG = 'http://www.w3.org/2000/svg';
  var G = { label: 64, pitch: 22, size: 18, head: 18 };   // 行の名前の幅・升の間隔・升の大きさ・月の行の高さ（viewBox の単位）
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(SVG, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function svgText(parent, x, y, t, cls) { svgEl('text', { x: x, y: y, 'class': cls, 'aria-hidden': 'true' }, parent).textContent = t; }
  // 段を色だけで分けない: 0 は枠だけ、1・2 は中の四角の大きさ、3 は塗りに点
  function mark(parent, x, y, level) {
    var s = G.size;
    svgEl('rect', { x: x + 0.5, y: y + 0.5, width: s - 1, height: s - 1, rx: 2, 'class': 'g-frame' }, parent);
    if (level === 1 || level === 2) {
      var w = level === 1 ? 8 : 13, o = (s - w) / 2;
      svgEl('rect', { x: x + o, y: y + o, width: w, height: w, rx: 1, 'class': 'g-fill' }, parent);
    }
    if (level === 3) {
      svgEl('rect', { x: x, y: y, width: s, height: s, rx: 2, 'class': 'g-fill' }, parent);
      svgEl('circle', { cx: x + s / 2, cy: y + s / 2, r: 2.5, 'class': 'g-dot' }, parent);
    }
  }
  function renderGrid(days) {
    var g = C.monthGrid(days), GT = T.grid;
    el.grid.innerHTML = '';
    el.grid.hidden = !g.years.length;
    if (!g.years.length) return;
    var cap = document.createElement('p'); cap.className = 'grid-caption'; cap.textContent = GT.caption; el.grid.appendChild(cap);
    var W = G.label + 12 * G.pitch, H = G.head + g.items.length * G.pitch;
    // 1 年 1 枚（期間が長くても横に伸びず、下に積む）
    g.years.forEach(function (yr) {
      var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'grid-year', role: 'group', 'aria-label': String(yr.year) }, el.grid);
      svgText(svg, 0, 13, String(yr.year), 'g-year');
      for (var m = 1; m <= 12; m++) svgText(svg, G.label + (m - 1) * G.pitch + G.size / 2, 13, String(m), 'g-month');
      g.items.forEach(function (it, i) {
        var y = G.head + i * G.pitch;
        svgText(svg, 0, y + 13, GT.short[it], 'g-item');
        yr.months.forEach(function (mo, j) {
          if (!mo) return;   // 期間の外の月は升を置かない
          var c = mo.cells[it];
          mark(svgEl('g', { role: 'img', 'aria-label': GT.cell(yr.year, mo.month, GT.full[it], c.n) }, svg), G.label + j * G.pitch, y, c.level);
        });
      });
    });
    var lg = document.createElement('p'); lg.className = 'grid-legend'; lg.setAttribute('aria-hidden', 'true');
    GT.legend.forEach(function (t, lv) {
      var span = document.createElement('span');
      mark(svgEl('svg', { viewBox: '0 0 18 18', width: 14, height: 14 }, span), 0, 0, lv);
      span.appendChild(document.createTextNode(t));
      lg.appendChild(span);
    });
    el.grid.appendChild(lg);
  }

  // --- 2 つの列を 1 日 1 点で並べる図（Q-426。点の並びと既定の列は calc.js の scatterPoints・scatterDefault） ---
  var SC = { w: 320, h: 230, l: 46, r: 10, t: 16, b: 22, hit: 18 };   // viewBox の幅・高さ、描く枠の左右上下の余白、点を押したとみなす距離
  function renderScatter(days) {
    var ST = T.scatter, wu = outOpts().weightOut, keys = C.NUM_KEYS, box = el.scatter;
    var names = {};
    C.dailyCols(wu).forEach(function (c) { names[c[0]] = c[ST.col]; });
    // 列ごとの、値のある日の印（押す所の disabled を決める）
    var has = {};
    keys.forEach(function (k) { has[k] = days.map(function (r) { return (k === 'weight' ? C.weightIn(r, wu) : r[k]) != null; }); });
    function pairN(a, b) { var n = 0, A = has[a], B = has[b]; for (var i = 0; i < A.length; i++) if (A[i] && B[i]) n++; return n; }
    var any = false;
    for (var i = 0; i < keys.length && !any; i++) for (var j = i + 1; j < keys.length && !any; j++) any = pairN(keys[i], keys[j]) >= 2;
    box.innerHTML = '';
    box.hidden = !any;
    if (!any) return;
    if (!state.sx || !state.sy) { var d0 = C.scatterDefault(days); state.sx = d0[0]; state.sy = d0[1]; }
    var sx = state.sx, sy = state.sy;

    // 横と縦の押す所（字は列の名前。同じ列どうしと、点が 2 つ未満になる組は押せない）。図の下に置く（図を先に。Q-430）
    var rows = [];
    [0, 1].forEach(function (axis) {
      var row = document.createElement('div'); row.className = 'sc-axis';
      row.setAttribute('role', 'group'); row.setAttribute('aria-label', ST.label[axis]);
      var head = document.createElement('span'); head.className = 'sc-axis-name'; head.textContent = ST.axis[axis]; row.appendChild(head);
      keys.forEach(function (k) {
        var other = axis ? sx : sy, b = document.createElement('button');
        b.type = 'button'; b.className = 'sc-btn'; b.textContent = names[k];
        b.setAttribute('aria-pressed', String(k === (axis ? sy : sx)));
        b.disabled = k === other || pairN(k, other) < 2;
        b.addEventListener('click', function () {
          if (axis) state.sy = k; else state.sx = k;
          renderScatter(days);
          var again = box.querySelectorAll('.sc-axis')[axis].querySelector('[aria-pressed="true"]');
          if (again) again.focus();
        });
        row.appendChild(b);
      });
      rows.push(row);
    });

    var pts = C.scatterPoints(days, sx, sy, wu);
    var svg = svgEl('svg', { viewBox: '0 0 ' + SC.w + ' ' + SC.h, 'class': 'scatter-svg', role: 'img', tabindex: '0', 'aria-label': names[sx] + ' × ' + names[sy] }, box);
    var line = document.createElement('p'); line.className = 'sc-read'; line.setAttribute('aria-live', 'polite'); box.appendChild(line);
    rows.forEach(function (row) { box.appendChild(row); });
    var x0 = SC.l, x1 = SC.w - SC.r, y0 = SC.h - SC.b, y1 = SC.t;
    function range(k) {
      var lo = Infinity, hi = -Infinity;
      pts.forEach(function (p) { if (p[k] < lo) lo = p[k]; if (p[k] > hi) hi = p[k]; });
      return pts.length ? [lo, hi] : [0, 1];
    }
    var rx = range('x'), ry = range('y');
    // 最小 = 最大の列は、その値を真ん中に
    function scale(r, a, b) { var lo = r[0], hi = r[1]; if (hi === lo) { lo -= 1; hi += 1; } return function (v) { return a + (v - lo) / (hi - lo) * (b - a); }; }
    var fx = scale(rx, x0, x1), fy = scale(ry, y0, y1);
    svgEl('line', { x1: x0, y1: y0, x2: x1, y2: y0, 'class': 's-axis' }, svg);
    svgEl('line', { x1: x0, y1: y0, x2: x0, y2: y1, 'class': 's-axis' }, svg);
    if (pts.length) {
      C.axisTicks(rx[0], rx[1]).forEach(function (v, i, a) {
        var x = fx(v), end = a.length > 1 && i === a.length - 1;
        svgEl('line', { x1: x, y1: y0, x2: x, y2: y0 + 3, 'class': 's-axis' }, svg);
        svgText(svg, x, y0 + 14, String(v), 's-tick' + (end ? ' s-end' : ''));
      });
      C.axisTicks(ry[0], ry[1]).forEach(function (v) {
        var y = fy(v);
        svgEl('line', { x1: x0 - 3, y1: y, x2: x0, y2: y, 'class': 's-axis' }, svg);
        svgText(svg, x0 - 5, y + 3.5, String(v), 's-tick s-y');
      });
    }
    // 点（薄い点の重なりで濃さが出る）。1 本の path にまとめる
    var d = [];
    pts.forEach(function (p) { var x = fx(p.x), y = fy(p.y); d.push('M' + (x - 2.5).toFixed(1) + ' ' + y.toFixed(1) + 'a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0'); });
    if (d.length) svgEl('path', { d: d.join(''), 'class': 's-dot' }, svg);
    var ring = svgEl('circle', { r: 5, 'class': 's-sel', visibility: 'hidden' }, svg);

    // 選んだ日の 1 行（日付と 2 つの値。CSV のその行と同じ数・同じ書き方）
    var cur = -1;
    function show(idx) {
      var p = pts[idx];
      cur = p ? idx : -1;
      if (!p) { state.sel = null; ring.setAttribute('visibility', 'hidden'); line.textContent = ''; return; }
      state.sel = p.date;
      ring.setAttribute('cx', fx(p.x)); ring.setAttribute('cy', fy(p.y)); ring.setAttribute('visibility', 'visible');
      line.textContent = p.date + ST.sep + names[sx] + ' ' + String(p.x) + ST.sep + names[sy] + ' ' + String(p.y);
    }
    var keep = -1;
    if (state.sel) for (var q = 0; q < pts.length; q++) if (pts[q].date === state.sel) { keep = q; break; }
    show(keep);
    svg.addEventListener('click', function (e) {
      var m = svg.getScreenCTM(); if (!m) return;
      var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; pt = pt.matrixTransform(m.inverse());
      var best = -1, bd = SC.hit * SC.hit;
      pts.forEach(function (p, i) { var dx = fx(p.x) - pt.x, dy = fy(p.y) - pt.y, dd = dx * dx + dy * dy; if (dd <= bd) { bd = dd; best = i; } });
      if (best >= 0) show(best);
    });
    // ← → で日付の順に 1 日ずつ。Shift と ← → で 7 日（7 日先・前の日に点が無ければ、それより先・前でいちばん近い点）
    function addDays(date, n) { var t = new Date(date + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
    svg.addEventListener('keydown', function (e) {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !pts.length) return;
      e.preventDefault();
      var fwd = e.key === 'ArrowRight', next;
      if (cur < 0) next = fwd ? 0 : pts.length - 1;
      else if (!e.shiftKey) next = Math.min(pts.length - 1, Math.max(0, cur + (fwd ? 1 : -1)));
      else {
        var target = addDays(pts[cur].date, fwd ? 7 : -7);
        next = fwd ? pts.length - 1 : 0;
        if (fwd) { for (var i = cur + 1; i < pts.length; i++) if (pts[i].date >= target) { next = i; break; } }
        else { for (var j = cur - 1; j >= 0; j--) if (pts[j].date <= target) { next = j; break; } }
      }
      show(next);
    });
  }

  // --- 結果を出す ---

  function render() {
    var r = state.res, s = r.summary;
    el.detail.hidden = false;
    renderGrid(r.days);
    renderScatter(r.days);
    if (!s.dayCount) {
      text(el.result, '—');
      text(el.sub, T.noRecords);
      el.dlRow.hidden = true;
    } else {
      text(el.result, T.days(fmt(s.dayCount)));
      var parts = [];
      ['steps', 'sleep', 'rhr', 'weight'].forEach(function (k) { if (s.counts[k]) parts.push(T.part[k] + ' ' + fmt(s.counts[k])); });
      text(el.sub, T.range(s, parts, s.counts.exercise ? fmt(s.counts.exercise) : ''));
      el.dlRow.hidden = false;
      $('dl-ex').hidden = !s.counts.exercise;
    }

    // 項目ごとの日数と、使ったファイル
    var f = s.files, src = s.sources, I = T.items;
    function fl(k) { return f[k] && T.files[k] + ' ' + f[k]; }   // ファイルの種類と数
    el.detailTable.innerHTML = '';
    el.detailTable.appendChild(row('th', T.tableHead));
    [
      [I.steps, s.counts.steps, [fl('steps-json'), fl('steps-csv')]],
      [I.sleep, s.counts.sleep, [fl('sleep-json'), fl('sleep-csv')]],
      [I.score, s.counts.score, [f['score-csv'] && 'sleep_score.csv']],
      [I.rhr, s.counts.rhr, [fl('rhr-json'), f['rhr-csv'] && 'daily_resting_heart_rate.csv']],
      [I.weight, s.counts.weight, [fl('weight-json'), f['weight-csv'] && 'weight.csv']],
      [I.exercise, s.counts.exercise, [fl('exercise-json')]],
    ].forEach(function (x) { el.detailTable.appendChild(row('td', [x[0], fmt(x[1]), x[2].filter(Boolean).join(T.listSep) || '—'])); });

    // 注意
    el.notes.innerHTML = '';
    if (src.stepsJson || s.counts.exercise) li(T.utc(s.tz));
    if (s.stepCompare.compared) li(T.stepCompare(s.stepCompare, fmt));
    if (src.sleepCsv) li(T.sleepCsv(src.sleepCsv));
    if (src.scoreTotal && src.scoreLinked < src.scoreTotal) li(T.scoreUnlinked(src.scoreTotal - src.scoreLinked));
    var wn = T.weight[s.weightUnit.reason](s.weightUnit); if (wn) li(wn);
    if (state.skipped) li(T.skipped(fmt(state.skipped)));
    if (state.errors.length) {
      li(T.errors(state.errors.length, state.errors.slice(0, 5).map(function (e) { return T.errorItem(e.path.split('/').pop(), window.Text.errorText(T, e)); }), state.errors.length > 5));
    }

    // 直近 7 日（アプリの値と見比べる用）
    el.preview.innerHTML = '';
    var last = r.days.slice(-7);
    if (last.length) {
      var wu = outOpts().weightOut;
      var cap = document.createElement('caption'); cap.textContent = T.previewCaption; el.preview.appendChild(cap);
      el.preview.appendChild(row('th', T.previewHead(wu)));
      last.forEach(function (d) {
        el.preview.appendChild(row('td', [T.previewDate(d.date), d.steps != null ? fmt(d.steps) : '', d.sleepMin != null ? Math.floor(d.sleepMin / 60) + ':' + ('0' + d.sleepMin % 60).slice(-2) : '',
          d.score != null ? d.score : '', d.rhr != null ? d.rhr : '', d.weight != null ? C.weightIn(d, wu) : '']));
      });
    }
    window.yzUsed?.();
  }

  function recompute() {
    if (!state.raw) return;
    state.res = C.aggregate(state.raw, { tz: el.tz.value, weightUnit: el.wunit.value });
    render();
  }

  // --- 読み込み ---
  function progress(p) { text(el.sub, T.progress(fmt(p.done), fmt(p.total))); }

  function sourcesFromFiles(files) {
    var list = [], zips = [], bad = [];
    files.forEach(function (file) {
      var name = file.webkitRelativePath || file.relPath || file.name;
      if (/\.zip$/i.test(file.name)) zips.push(file);
      else if (/\.(tgz|tar\.gz|tar)$/i.test(file.name)) bad.push(file.name);
      else list.push({ path: name, size: file.size, read: function () { return file.text(); } });
    });
    if (bad.length) state.errors.push({ path: bad[0], message: T.tgz });
    return zips.reduce(function (p, zf) {
      return p.then(function () {
        return Z.readIndex(zf).then(function (entries) {
          entries.forEach(function (en) { list.push({ path: en.name, size: en.size, read: function () { return Z.readText(zf, en); } }); });
        }, function (e) { state.errors.push({ path: zf.name, message: e.message, code: e.code, arg: e.arg }); });
      });
    }, Promise.resolve()).then(function () { return list; });
  }

  function run(makeSources) {
    if (state.busy) return;
    state.busy = true;
    state.errors = []; state.skipped = 0; state.sx = state.sy = state.sel = null;
    text(el.result, T.reading); text(el.sub, '');
    el.dlRow.hidden = true;
    Promise.resolve().then(makeSources).then(function (sources) {
      return C.importSources(sources, progress);
    }).then(function (r) {
      state.raw = r.raw; state.skipped = r.skipped; state.errors = state.errors.concat(r.errors);
      recompute();
    }).catch(function (e) {
      text(el.result, '—'); text(el.sub, T.failed(window.Text.errorText(T, e)));
    }).then(function () { state.busy = false; });
  }

  function pickFiles(files) {
    var list = Array.prototype.slice.call(files || []);   // input.value = '' で FileList が空になる前に写す
    if (list.length) run(function () { return sourcesFromFiles(list); });
  }

  $('pick-zip').addEventListener('click', function () { $('file-zip').click(); });
  $('pick-dir').addEventListener('click', function () { $('file-dir').click(); });
  $('file-zip').addEventListener('change', function () { pickFiles(this.files); this.value = ''; });
  $('file-dir').addEventListener('change', function () { pickFiles(this.files); this.value = ''; });
  $('try-sample').addEventListener('click', function () {
    run(function () { return C.makeSample().map(function (f) { return { path: f.path, size: f.text.length, read: function () { return Promise.resolve(f.text); } }; }); });
  });
  if (!('webkitdirectory' in document.createElement('input'))) $('pick-dir').hidden = true;

  // ドロップ（フォルダごと落としても、中のファイルをたどる）
  function entryFiles(entry, prefix) {
    if (entry.isFile) {
      return new Promise(function (ok) { entry.file(function (f) { f.relPath = prefix + f.name; ok([f]); }, function () { ok([]); }); });
    }
    if (!entry.isDirectory) return Promise.resolve([]);
    var reader = entry.createReader(), all = [];
    return new Promise(function (ok) {
      (function next() {
        reader.readEntries(function (es) {
          if (!es.length) { Promise.all(all).then(function (x) { ok([].concat.apply([], x)); }); return; }
          es.forEach(function (e) { all.push(entryFiles(e, prefix + entry.name + '/')); });
          next();
        }, function () { ok([]); });
      })();
    });
  }
  var zone = $('drop');
  ['dragenter', 'dragover'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('dragging'); }); });
  ['dragleave', 'drop'].forEach(function (t) { zone.addEventListener(t, function () { zone.classList.remove('dragging'); }); });
  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    var items = e.dataTransfer && e.dataTransfer.items;
    var entries = items ? Array.prototype.map.call(items, function (it) { return it.webkitGetAsEntry && it.webkitGetAsEntry(); }).filter(Boolean) : [];
    if (entries.length) run(function () { return Promise.all(entries.map(function (en) { return entryFiles(en, ''); })).then(function (x) { return sourcesFromFiles([].concat.apply([], x)); }); });
    else pickFiles(e.dataTransfer && e.dataTransfer.files);
  });

  // --- ダウンロード（この端末の中でファイルを作るだけ） ---
  function save(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function stem(kind) {
    var o = outOpts(), s = state.res.summary;
    return 'fitbit-' + kind + '_' + (o.from || s.from) + '_' + (o.to || s.to);
  }
  $('dl-csv').addEventListener('click', function () {
    if (state.res) save(stem('daily') + '.csv', new Blob([C.toCsv(state.res, 'daily', outOpts())], { type: 'text/csv' }));
  });
  $('dl-ex').addEventListener('click', function () {
    if (state.res) save(stem('exercise') + '.csv', new Blob([C.toCsv(state.res, 'exercise', outOpts())], { type: 'text/csv' }));
  });
  $('dl-md').addEventListener('click', function () {
    if (!state.res) return;
    var files = C.toMarkdownFiles(state.res, outOpts());
    if (!files.length) { text(el.sub, T.emptyRange); return; }
    save(stem('markdown') + '.zip', new Blob([Z.makeZip(files)], { type: 'application/zip' }));
  });

  // --- 設定 ---
  [el.bom, el.lang, el.mdUnit, el.from, el.to].forEach(function (x) { x.addEventListener('change', syncSummary); });
  if (el.wout) {
    // 既定: 端末の地域が米国なら lb、それ以外は kg（Fitbit のアプリの既定の表示に近い方。画面で変えられる）
    try { if (/-US$/i.test(navigator.language || '')) el.wout.value = 'lb'; } catch (e) { /* 既定の kg のまま */ }
    el.wout.addEventListener('change', function () { syncSummary(); if (state.res) render(); });
  }
  [el.tz, el.wunit].forEach(function (x) { x.addEventListener('change', function () { syncSummary(); recompute(); }); });
  syncSummary();

  // オフライン対応（登録は './sw.js' だけ。scope: '/' を指定しない）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // 英語のページ（en/）からも、ツールの直下の sw.js を登録する（scope は /fitbit-export/ 全体）
    addEventListener('load', function () { navigator.serviceWorker.register(EN ? '../sw.js' : './sw.js').catch(function () {}); });
  }
})();
