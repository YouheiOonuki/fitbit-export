// ===========================
// Fitbit データ CSV 変換 — 画面の制御
// 読み込みと変換は calc.js・zip.js。ファイルはこの端末の中で読むだけで、どこにも送らない（fetch も使わない）
// ファイルも設定も localStorage に保存しない（健康の記録を端末に残さないため。README「決めたこと」）
// ===========================
(function () {
  'use strict';
  var C = window.Calc, Z = window.Zip;
  function $(id) { return document.getElementById(id); }
  var el = {
    result: $('result'), sub: $('result-sub'), dlRow: $('dl-row'), detail: $('detail'), detailTable: $('detail-table'), notes: $('notes'), preview: $('preview'),
    bom: $('bom'), lang: $('lang'), mdUnit: $('md-unit'), from: $('from'), to: $('to'), tz: $('tz'), wunit: $('wunit'),
  };
  var state = { raw: null, res: null, errors: [], skipped: 0, busy: false };

  // --- タイムゾーンの選択肢（既定はこの端末の設定） ---
  var here = 'UTC';
  try { here = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* 古いブラウザ */ }
  var zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = []; }
  [here, 'Asia/Tokyo', 'UTC'].forEach(function (z) { if (zones.indexOf(z) < 0) zones.unshift(z); });
  zones.forEach(function (z) {
    var o = document.createElement('option'); o.value = z; o.textContent = z + (z === here ? '（この端末）' : '');
    el.tz.appendChild(o);
  });
  el.tz.value = here;

  function fmt(n) { return Number(n).toLocaleString('ja-JP'); }
  function text(e, t) { e.textContent = t; }
  function cell(tag, t) { var c = document.createElement(tag); c.textContent = t == null ? '' : String(t); return c; }
  function row(tag, cells) { var tr = document.createElement('tr'); cells.forEach(function (t) { tr.appendChild(cell(tag, t)); }); return tr; }
  function li(t) { var x = document.createElement('li'); x.textContent = t; el.notes.appendChild(x); }

  function outOpts() { return { bom: el.bom.checked, lang: el.lang.value, unit: el.mdUnit.value, from: el.from.value || null, to: el.to.value || null }; }
  function syncSummary() {
    var o = outOpts();
    YorozuScreen.detailsSummary({
      'opt-out': (o.bom ? 'Excel 向け' : 'BOM なし') + (o.lang === 'en' ? '・英語の列名' : '') + '・' + (o.unit === 'month' ? '1 か月 1 ファイル' : '1 日 1 ファイル') + (o.from || o.to ? '・期間あり' : ''),
      'opt-time': el.tz.value + '・体重 ' + ({ auto: '自動', lb: 'ポンド', kg: 'kg' })[el.wunit.value],
    });
  }

  // --- 結果を出す ---
  var WEIGHT_NOTE = {
    assumed: function (w) { return '体重（weight-日付.json）はポンドとみなして kg に直しました' + (w.sample ? '（例: ' + w.sample.date + ' の ' + w.sample.value + ' → ' + (Math.round(w.sample.value * 0.45359237 * 10) / 10) + ' kg）' : '') + '。アプリの値と違えば「時刻と単位」で kg を選んでください。'; },
    matched: function (w) { return '体重の単位は weight.csv（グラム）と ' + w.compared + ' 回比べて「' + (w.unit === 'lb' ? 'ポンド' : 'kg') + '」と判断しました。'; },
    chosen: function (w) { return '体重は選んだ単位（' + (w.unit === 'lb' ? 'ポンド' : 'kg') + '）で読みました。'; },
    none: function () { return null; },
  };

  function render() {
    var r = state.res, s = r.summary;
    el.detail.hidden = false;
    if (!s.dayCount) {
      text(el.result, '—');
      text(el.sub, '読める記録が見つかりませんでした。Fitbit（Google Health）の書き出しか、内訳で確かめてください。');
      el.dlRow.hidden = true;
    } else {
      text(el.result, fmt(s.dayCount) + ' 日分');
      var parts = [];
      if (s.counts.steps) parts.push('歩数 ' + fmt(s.counts.steps));
      if (s.counts.sleep) parts.push('睡眠 ' + fmt(s.counts.sleep));
      if (s.counts.rhr) parts.push('心拍 ' + fmt(s.counts.rhr));
      if (s.counts.weight) parts.push('体重 ' + fmt(s.counts.weight));
      text(el.sub, s.from + '〜' + s.to + '（' + parts.join('・') + ' 日' + (s.counts.exercise ? '、運動 ' + fmt(s.counts.exercise) + ' 回' : '') + '）');
      el.dlRow.hidden = false;
      $('dl-ex').hidden = !s.counts.exercise;
    }

    // 項目ごとの日数と、使ったファイル
    var f = s.files, src = s.sources;
    el.detailTable.innerHTML = '';
    el.detailTable.appendChild(row('th', ['項目', '日数', '読んだファイル']));
    [
      ['歩数', s.counts.steps, [f['steps-json'] && 'steps-日付.json ' + f['steps-json'], f['steps-csv'] && 'steps_日付.csv ' + f['steps-csv']]],
      ['睡眠', s.counts.sleep, [f['sleep-json'] && 'sleep-日付.json ' + f['sleep-json'], f['sleep-csv'] && 'UserSleeps ' + f['sleep-csv']]],
      ['睡眠スコア', s.counts.score, [f['score-csv'] && 'sleep_score.csv']],
      ['安静時心拍数', s.counts.rhr, [f['rhr-json'] && 'resting_heart_rate-日付.json ' + f['rhr-json'], f['rhr-csv'] && 'daily_resting_heart_rate.csv']],
      ['体重', s.counts.weight, [f['weight-json'] && 'weight-日付.json ' + f['weight-json'], f['weight-csv'] && 'weight.csv']],
      ['運動（回）', s.counts.exercise, [f['exercise-json'] && 'exercise-番号.json ' + f['exercise-json']]],
    ].forEach(function (x) { el.detailTable.appendChild(row('td', [x[0], fmt(x[1]), x[2].filter(Boolean).join('、') || '—'])); });

    // 注意
    el.notes.innerHTML = '';
    if (src.stepsJson || s.counts.exercise) li('歩数と運動の時刻は UTC で記録されているので、' + s.tz + ' の日付に分けました。');
    if (s.stepCompare.compared) {
      li('歩数は 2 つの形（JSON と CSV）で ' + s.stepCompare.compared + ' 日重なり、' + (s.stepCompare.differ ? s.stepCompare.differ + ' 日で食い違いました（JSON の値を使用）' : 'すべて一致しました') +
        s.stepCompare.examples.map(function (e) { return '。' + e.date + ': ' + fmt(e.json) + ' と ' + fmt(e.csv); }).join('') + '。');
    }
    if (src.sleepCsv) li('睡眠のうち ' + src.sleepCsv + ' 日は新しい形（UserSleeps）から読みました。深い・浅い・レムの内訳は出ません。');
    if (src.scoreTotal && src.scoreLinked < src.scoreTotal) li('睡眠スコア ' + (src.scoreTotal - src.scoreLinked) + ' 件は睡眠の記録と結べず、timestamp の日付に置きました。');
    var wn = WEIGHT_NOTE[s.weightUnit.reason](s.weightUnit); if (wn) li(wn);
    if (state.skipped) li('対象外のファイル ' + fmt(state.skipped) + ' 件は読んでいません（心拍数の細かい記録など）。');
    if (state.errors.length) {
      li('読めなかったファイル ' + state.errors.length + ' 件: ' + state.errors.slice(0, 5).map(function (e) { return e.path.split('/').pop() + '（' + e.message + '）'; }).join('、') + (state.errors.length > 5 ? ' ほか' : ''));
    }

    // 直近 7 日（アプリの値と見比べる用）
    el.preview.innerHTML = '';
    var last = r.days.slice(-7);
    if (last.length) {
      var cap = document.createElement('caption'); cap.textContent = '直近 7 日（アプリの値と見比べてください）'; el.preview.appendChild(cap);
      el.preview.appendChild(row('th', ['日付', '歩数', '睡眠', 'スコア', '心拍', '体重']));
      last.forEach(function (d) {
        el.preview.appendChild(row('td', [d.date.slice(5), d.steps != null ? fmt(d.steps) : '', d.sleepMin != null ? Math.floor(d.sleepMin / 60) + ':' + ('0' + d.sleepMin % 60).slice(-2) : '',
          d.score != null ? d.score : '', d.rhr != null ? d.rhr : '', d.weight != null ? d.weight : '']));
      });
    }
  }

  function recompute() {
    if (!state.raw) return;
    state.res = C.aggregate(state.raw, { tz: el.tz.value, weightUnit: el.wunit.value });
    render();
  }

  // --- 読み込み ---
  function progress(p) { text(el.sub, '読み込み中… ' + fmt(p.done) + ' / ' + fmt(p.total) + ' ファイル'); }

  function sourcesFromFiles(files) {
    var list = [], zips = [], bad = [];
    files.forEach(function (file) {
      var name = file.webkitRelativePath || file.relPath || file.name;
      if (/\.zip$/i.test(file.name)) zips.push(file);
      else if (/\.(tgz|tar\.gz|tar)$/i.test(file.name)) bad.push(file.name);
      else list.push({ path: name, size: file.size, read: function () { return file.text(); } });
    });
    if (bad.length) state.errors.push({ path: bad[0], message: '.tgz は読めません。書き出しの形式で .zip を選ぶか、展開したフォルダを選んでください' });
    return zips.reduce(function (p, zf) {
      return p.then(function () {
        return Z.readIndex(zf).then(function (entries) {
          entries.forEach(function (en) { list.push({ path: en.name, size: en.size, read: function () { return Z.readText(zf, en); } }); });
        }, function (e) { state.errors.push({ path: zf.name, message: e.message }); });
      });
    }, Promise.resolve()).then(function () { return list; });
  }

  function run(makeSources) {
    if (state.busy) return;
    state.busy = true;
    state.errors = []; state.skipped = 0;
    text(el.result, '読み込み中'); text(el.sub, '');
    el.dlRow.hidden = true;
    Promise.resolve().then(makeSources).then(function (sources) {
      return C.importSources(sources, progress);
    }).then(function (r) {
      state.raw = r.raw; state.skipped = r.skipped; state.errors = state.errors.concat(r.errors);
      recompute();
    }).catch(function (e) {
      text(el.result, '—'); text(el.sub, '読み込めませんでした: ' + (e && e.message ? e.message : e));
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
    if (!files.length) { text(el.sub, 'この期間には記録がありません。'); return; }
    save(stem('markdown') + '.zip', new Blob([Z.makeZip(files)], { type: 'application/zip' }));
  });

  // --- 設定 ---
  [el.bom, el.lang, el.mdUnit, el.from, el.to].forEach(function (x) { x.addEventListener('change', syncSummary); });
  [el.tz, el.wunit].forEach(function (x) { x.addEventListener('change', function () { syncSummary(); recompute(); }); });
  syncSummary();

  // オフライン対応（登録は './sw.js' だけ。scope: '/' を指定しない）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
  }
})();
