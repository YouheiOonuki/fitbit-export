// ===========================
// 画面に出す文（main.js が <html lang> で ja か en を選ぶ）
// 日本語（index.html）と英語（en/index.html）で同じ main.js・calc.js を使い、文だけをここで分ける
// ブラウザでは window.TEXT、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  var LB = 0.45359237;
  /** 英語の複数形（1 だけ単数） */
  function pl(n, one, many) { return n + ' ' + (String(n) === '1' ? one : many); }
  function kgOf(lb) { return Math.round(lb * LB * 10) / 10; }

  var TEXT = {
    ja: {
      locale: 'ja-JP',
      here: '（この端末）',
      outState: function (o) {
        return (o.bom ? 'Excel 向け' : 'BOM なし') + (o.lang === 'en' ? '・英語の列名' : '') + '・' + (o.unit === 'month' ? '1 か月 1 ファイル' : '1 日 1 ファイル') + (o.from || o.to ? '・期間あり' : '');
      },
      timeState: function (tz, wunit) { return tz + '・体重 ' + ({ auto: '自動', lb: 'ポンド', kg: 'kg' })[wunit]; },
      days: function (n) { return n + ' 日分'; },
      range: function (s, parts, ex) { return s.from + '〜' + s.to + '（' + parts.join('・') + ' 日' + (ex ? '、運動 ' + ex + ' 回' : '') + '）'; },
      part: { steps: '歩数', sleep: '睡眠', rhr: '心拍', weight: '体重' },
      noRecords: '読める記録が見つかりませんでした。Fitbit（Google Health）の書き出しか、内訳で確かめてください。',
      reading: '読み込み中',
      progress: function (done, total) { return '読み込み中… ' + done + ' / ' + total + ' ファイル'; },
      failed: function (m) { return '読み込めませんでした: ' + m; },
      emptyRange: 'この期間には記録がありません。',
      tableHead: ['項目', '日数', '読んだファイル'],
      items: { steps: '歩数', sleep: '睡眠', score: '睡眠スコア', rhr: '安静時心拍数', weight: '体重', exercise: '運動（回）' },
      files: {
        'steps-json': 'steps-日付.json', 'steps-csv': 'steps_日付.csv', 'sleep-json': 'sleep-日付.json', 'sleep-csv': 'UserSleeps',
        'rhr-json': 'resting_heart_rate-日付.json', 'weight-json': 'weight-日付.json', 'exercise-json': 'exercise-番号.json',
      },
      listSep: '、',
      utc: function (tz) { return '歩数と運動の時刻は UTC で記録されているので、' + tz + ' の日付に分けました。'; },
      stepCompare: function (c, fmt) {
        return '歩数は 2 つの形（JSON と CSV）で ' + c.compared + ' 日重なり、' + (c.differ ? c.differ + ' 日で食い違いました（JSON の値を使用）' : 'すべて一致しました') +
          c.examples.map(function (e) { return '。' + e.date + ': ' + fmt(e.json) + ' と ' + fmt(e.csv); }).join('') + '。';
      },
      sleepCsv: function (n) { return '睡眠のうち ' + n + ' 日は新しい形（UserSleeps）から読みました。深い・浅い・レムの内訳は出ません。'; },
      scoreUnlinked: function (n) { return '睡眠スコア ' + n + ' 件は睡眠の記録と結べず、timestamp の日付に置きました。'; },
      weight: {
        assumed: function (w) { return '体重（weight-日付.json）はポンドとみなして kg に直しました' + (w.sample ? '（例: ' + w.sample.date + ' の ' + w.sample.value + ' → ' + kgOf(w.sample.value) + ' kg）' : '') + '。アプリの値と違えば「時刻と単位」で kg を選んでください。'; },
        matched: function (w) { return '体重の単位は weight.csv（グラム）と ' + w.compared + ' 回比べて「' + (w.unit === 'lb' ? 'ポンド' : 'kg') + '」と判断しました。'; },
        chosen: function (w) { return '体重は選んだ単位（' + (w.unit === 'lb' ? 'ポンド' : 'kg') + '）で読みました。'; },
        none: function () { return null; },
      },
      skipped: function (n) { return '対象外のファイル ' + n + ' 件は読んでいません（心拍数の細かい記録など）。'; },
      errors: function (n, list, more) { return '読めなかったファイル ' + n + ' 件: ' + list.join('、') + (more ? ' ほか' : ''); },
      errorItem: function (name, msg) { return name + '（' + msg + '）'; },
      tgz: '.tgz は読めません。書き出しの形式で .zip を選ぶか、展開したフォルダを選んでください',
      // calc.js・zip.js の例外（code つき）。日本語は例外の message をそのまま使う
      err: null,
      previewCaption: '直近 7 日（アプリの値と見比べてください）',
      previewHead: function () { return ['日付', '歩数', '睡眠', 'スコア', '心拍', '体重']; },
      previewDate: function (d) { return d.slice(5); },
    },

    en: {
      locale: 'en-US',
      here: ' (this device)',
      outState: function (o) {
        return (o.bom ? 'Excel-ready' : 'No BOM') + (o.lang === 'ja' ? ' · Japanese columns' : '') + ' · ' + o.weightOut + ' · ' + (o.unit === 'month' ? 'one file per month' : 'one file per day') + (o.from || o.to ? ' · date range' : '');
      },
      timeState: function (tz, wunit) { return tz + ' · weight file: ' + ({ auto: 'auto', lb: 'lb', kg: 'kg' })[wunit]; },
      days: function (n) { return pl(n, 'day', 'days'); },
      range: function (s, parts, ex) { return s.from + ' to ' + s.to + ' (days with ' + parts.join(', ') + (ex ? '; ' + pl(ex, 'exercise session', 'exercise sessions') : '') + ')'; },
      part: { steps: 'steps', sleep: 'sleep', rhr: 'resting HR', weight: 'weight' },
      noRecords: 'No readable records found. Check that this is a Fitbit (Google Health) export, and open Details.',
      reading: 'Reading…',
      progress: function (done, total) { return 'Reading… ' + done + ' / ' + total + ' files'; },
      failed: function (m) { return 'Could not read the files: ' + m; },
      emptyRange: 'No records in this date range.',
      tableHead: ['Item', 'Days', 'Files read'],
      items: { steps: 'Steps', sleep: 'Sleep', score: 'Sleep score', rhr: 'Resting heart rate', weight: 'Weight', exercise: 'Exercise (sessions)' },
      files: {
        'steps-json': 'steps-YYYY-MM-DD.json', 'steps-csv': 'steps_YYYY-MM-DD.csv', 'sleep-json': 'sleep-YYYY-MM-DD.json', 'sleep-csv': 'UserSleeps',
        'rhr-json': 'resting_heart_rate-YYYY-MM-DD.json', 'weight-json': 'weight-YYYY-MM-DD.json', 'exercise-json': 'exercise-N.json',
      },
      listSep: ', ',
      utc: function (tz) { return 'Step and exercise times are recorded in UTC, so they were split into days in ' + tz + '.'; },
      stepCompare: function (c, fmt) {
        return 'Steps appear in both formats (JSON and CSV) on ' + pl(c.compared, 'day', 'days') + '; ' + (c.differ ? pl(c.differ, 'day differs', 'days differ') + ' (JSON values used)' : (c.compared === 1 ? 'it matches' : 'all of them match')) +
          c.examples.map(function (e) { return '. ' + e.date + ': ' + fmt(e.json) + ' vs ' + fmt(e.csv); }).join('') + '.';
      },
      sleepCsv: function (n) { return 'Sleep for ' + pl(n, 'day', 'days') + ' came from the newer format (UserSleeps), which has no deep, light or REM breakdown.'; },
      scoreUnlinked: function (n) { return pl(n, 'sleep score', 'sleep scores') + ' could not be matched to a sleep record, so ' + (n === 1 ? 'it uses its' : 'they use their') + ' timestamp date.'; },
      weight: {
        assumed: function (w) { return 'Weight in weight-YYYY-MM-DD.json was read as pounds' + (w.sample ? ' (e.g. ' + w.sample.date + ': ' + w.sample.value + ' lb = ' + kgOf(w.sample.value) + ' kg)' : '') + '. If this does not match the app, choose kg under "Time zone and units".'; },
        matched: function (w) { return 'Weight unit set to ' + w.unit + ' after comparing ' + pl(w.compared, 'entry', 'entries') + ' with weight.csv (grams).'; },
        chosen: function (w) { return 'Weight was read in the unit you chose (' + w.unit + ').'; },
        none: function () { return null; },
      },
      skipped: function (n) { return pl(n, 'other file was', 'other files were') + ' skipped (for example, minute-by-minute heart rate).'; },
      errors: function (n, list, more) { return pl(n, 'file', 'files') + ' could not be read: ' + list.join(', ') + (more ? ', and more' : ''); },
      errorItem: function (name, msg) { return name + ' (' + msg + ')'; },
      tgz: 'Cannot read .tgz. Choose .zip as the export file type, or select the unzipped folder',
      err: {
        notArray: 'unexpected format (not a list)',
        notZip: 'not a zip file',
        badIndex: 'the zip index is damaged',
        badEntry: 'the zip contents are damaged',
        encrypted: 'password-protected zips cannot be read',
        method: function (n) { return 'compression method ' + n + ' is not supported'; },
        noDecompress: 'this browser cannot unzip files. Try the latest Chrome, Edge, Firefox or Safari',
      },
      previewCaption: 'Last 7 days (compare with the app)',
      previewHead: function (wu) { return ['Date', 'Steps', 'Sleep', 'Score', 'RHR', 'Weight (' + wu + ')']; },
      previewDate: function (d) { return d; },
    },
  };

  /** 例外（calc.js・zip.js）を画面の言語の文に。code が無い・日本語の画面なら message のまま */
  function errorText(t, e) {
    var m = e && e.code && t.err ? t.err[e.code] : null;
    if (typeof m === 'function') return m(e.arg);
    return m || (e && e.message ? e.message : String(e));
  }

  var api = { TEXT: TEXT, errorText: errorText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Text = api;
})(this);
