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
    result: $('result'), sub: $('result-sub'), grid: $('grid'), dlRow: $('dl-row'), detail: $('detail'), detailTable: $('detail-table'), notes: $('notes'), preview: $('preview'),
    bom: $('bom'), lang: $('lang'), mdUnit: $('md-unit'), from: $('from'), to: $('to'), tz: $('tz'), wunit: $('wunit'),
    wout: $('wout'),   // 出力の体重の単位（英語の画面だけ。日本語の画面は kg）
  };
  var state = { raw: null, res: null, errors: [], skipped: 0, busy: false };

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

  // --- 結果を出す ---

  function render() {
    var r = state.res, s = r.summary;
    el.detail.hidden = false;
    renderGrid(r.days);
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
    state.errors = []; state.skipped = 0;
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
