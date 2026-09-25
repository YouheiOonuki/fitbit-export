// ===========================
// 書き出しの形式と手順について「どこで確かめたか」（出典と確認日）を 1 か所に持つ
// 形式は公式の仕様書が見つからない（Google・Fitbit のヘルプは中身の列を説明していない）ので、
// 公式ヘルプで確かめた手順（kind: official）と、公開の解析コードで確かめた形式（kind: public-code）を分けて書く。
// 確かめきれていない扱いは README「開いた問い」
// en は英語のページ（en/guide.html）に出す文。確認日と出典の先は上と同じ（url が無ければ上の url。値を 2 か所に持たない）
// ブラウザでは window.Constants、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  var CHECKED = '2026-09-25';   // 下の出典をこの日に見て確かめた（youheioonuki.github.io の check-site が読む）

  var SOURCES = {
    exportHelp: {
      label: '書き出しの手順',
      value: 'Google アカウントで使っているなら Google のデータ書き出し（Takeout）で「Google Health」を選ぶ。Fitbit アカウントのままなら fitbit.com の設定 → データ エクスポート',
      source: 'Google Health ヘルプ「Google Health データをエクスポートするにはどうすればいいですか？」',
      url: 'https://support.google.com/fitbit/answer/14236615?hl=ja',
      checked: CHECKED,
      kind: 'official',
      en: { label: "How to export", value: "If you use a Google Account, download your data with Google Takeout and select \"Google Health\". If you still use a Fitbit account, use Data Export in the Settings menu on fitbit.com", source: "Google Health Help: How do I export my Google Health data?", url: "https://support.google.com/fitbit/answer/14236615?hl=en" },
    },
    migration: {
      label: 'Fitbit アカウントの終了',
      value: '2026-05-19 以降は Fitbit アカウントでログインできない。2026-07-15 にデータの削除処理が始まる',
      source: 'Google Health ヘルプ「Fitbit アカウントを Google アカウントに移行する方法」',
      url: 'https://support.google.com/googlehealth/answer/14237024?hl=ja',
      checked: CHECKED,
      kind: 'official',
      en: { label: "End of Fitbit accounts", value: "From 2026-05-19 you cannot sign in with a Fitbit account. Data deletion starts on 2026-07-15", source: "Google Health Help: How to move your Fitbit Account to a Google Account", url: "https://support.google.com/googlehealth/answer/14237024?hl=en" },
    },
    takeout: {
      label: '書き出しファイルの形',
      value: '.zip か .tgz。選んだ上限のサイズ（最大 50 GB）を超えると複数のファイルに分かれる。アーカイブは約 7 日で期限切れ',
      source: 'Google アカウント ヘルプ「Google データをダウンロードする方法」',
      url: 'https://support.google.com/accounts/answer/3024190?hl=ja',
      checked: CHECKED,
      kind: 'official',
      en: { label: "Export file type", value: ".zip or .tgz. Exports larger than the size you choose (up to 50 GB) are split into several files. The archive expires after about 7 days", source: "Google Account Help: How to download your Google data", url: "https://support.google.com/accounts/answer/3024190?hl=en" },
    },
    legacyJson: {
      label: 'Global Export Data の JSON',
      value: 'sleep-日付.json（dateOfSleep・startTime は現地の時刻・levels.summary）、steps-日付.json と heart_rate-日付.json（dateTime は "MM/DD/YY HH:MM:SS"）、resting_heart_rate-日付.json、weight-日付.json、exercise-番号.json',
      source: '公開の解析コード: kev-m/FitOut（2026-03 更新）、saubury/duckdb-fitbit（2023）、barfittc/Takeout.Fitbit.Parser（2023）',
      url: 'https://github.com/kev-m/FitOut',
      checked: CHECKED,
      kind: 'public-code',
      en: { label: "JSON in Global Export Data", value: "sleep-YYYY-MM-DD.json (dateOfSleep, startTime in local time, levels.summary), steps-YYYY-MM-DD.json and heart_rate-YYYY-MM-DD.json (dateTime as \"MM/DD/YY HH:MM:SS\"), resting_heart_rate-YYYY-MM-DD.json, weight-YYYY-MM-DD.json, exercise-N.json", source: "Public parsers: kev-m/FitOut (updated 2026-03), saubury/duckdb-fitbit (2023), barfittc/Takeout.Fitbit.Parser (2023)" },
    },
    utcTimes: {
      label: '分ごとの記録と運動の時刻',
      value: 'steps・heart_rate の dateTime と exercise の startTime は UTC。ファイル名の日付は現地の日付（解析した人の観察）',
      source: 'saubury/duckdb-fitbit の解析ノート（UTC+11 の人が +11 時間して日ごとに集計）、iccir919/fitbit-json-to-csv（GMT から直す）',
      url: 'https://github.com/saubury/duckdb-fitbit',
      checked: CHECKED,
      kind: 'public-code',
      en: { label: "Minute data and exercise times", value: "dateTime in steps and heart_rate files and startTime in exercise files are UTC. The date in the file name is the local date (observed by the parser authors)", source: "saubury/duckdb-fitbit notes (a user at UTC+11 adds 11 hours before daily totals), iccir919/fitbit-json-to-csv (converts from GMT)" },
    },
    googleDataCsv: {
      label: '_GoogleData の CSV（新しい形）',
      value: 'Physical Activity_GoogleData の daily_resting_heart_rate.csv（timestamp, beats per minute）・steps_日付.csv（timestamp, steps）・weight.csv（weight grams）、Health Fitness Data_GoogleData の UserSleeps_*.csv、Sleep Score の sleep_score.csv',
      source: '公開の解析コード: armixlabs/FitbitToGarminConverter（2026-02）、joshgaus/FitBitDataAnalysis（2026-08）、kev-m/FitOut',
      url: 'https://github.com/armixlabs/FitbitToGarminConverter',
      checked: CHECKED,
      kind: 'public-code',
      en: { label: "CSV in _GoogleData folders (newer format)", value: "daily_resting_heart_rate.csv (timestamp, beats per minute), steps_YYYY-MM-DD.csv (timestamp, steps) and weight.csv (weight grams) in Physical Activity_GoogleData; UserSleeps_*.csv in Health Fitness Data_GoogleData; sleep_score.csv in Sleep Score", source: "Public parsers: armixlabs/FitbitToGarminConverter (2026-02), joshgaus/FitBitDataAnalysis (2026-08), kev-m/FitOut" },
    },
    weightUnit: {
      label: 'weight-日付.json の体重の単位',
      value: 'ポンドとして kg に換算している解析がある。weight.csv（グラム）と同じ日があれば比べて決める',
      source: 'armixlabs/FitbitToGarminConverter（lbs → kg に換算）',
      url: 'https://github.com/armixlabs/FitbitToGarminConverter',
      checked: CHECKED,
      kind: 'public-code',
      en: { label: "Weight unit in weight-YYYY-MM-DD.json", value: "One parser converts it from pounds to kg. If weight.csv (grams) has the same day, the two are compared", source: "armixlabs/FitbitToGarminConverter (lbs to kg)" },
    },
    browser: {
      label: 'zip の展開に使うブラウザの機能',
      value: "DecompressionStream('deflate-raw'): Chrome・Edge 103、Firefox 113、Safari 16.4 から",
      source: 'MDN browser-compat-data 8.1.3',
      url: 'https://developer.mozilla.org/docs/Web/API/DecompressionStream',
      checked: CHECKED,
      kind: 'official',
      en: { label: "Browser feature used to unzip", value: "DecompressionStream('deflate-raw'): Chrome and Edge 103, Firefox 113, Safari 16.4 and later", source: "MDN browser-compat-data 8.1.3" },
    },
  };

  var api = { CHECKED: CHECKED, SOURCES: SOURCES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Constants = api;
})(this);
