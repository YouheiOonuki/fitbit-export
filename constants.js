// ===========================
// 書き出しの形式と手順について「どこで確かめたか」（出典と確認日）を 1 か所に持つ
// 形式は公式の仕様書が見つからない（Google・Fitbit のヘルプは中身の列を説明していない）ので、
// 公式ヘルプで確かめた手順（kind: official）と、公開の解析コードで確かめた形式（kind: public-code）を分けて書く。
// 確かめきれていない扱いは README「開いた問い」
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
    },
    migration: {
      label: 'Fitbit アカウントの終了',
      value: '2026-05-19 以降は Fitbit アカウントでログインできない。2026-07-15 にデータの削除処理が始まる',
      source: 'Google Health ヘルプ「Fitbit アカウントを Google アカウントに移行する方法」',
      url: 'https://support.google.com/googlehealth/answer/14237024?hl=ja',
      checked: CHECKED,
      kind: 'official',
    },
    takeout: {
      label: '書き出しファイルの形',
      value: '.zip か .tgz。選んだ上限のサイズ（最大 50 GB）を超えると複数のファイルに分かれる。アーカイブは約 7 日で期限切れ',
      source: 'Google アカウント ヘルプ「Google データをダウンロードする方法」',
      url: 'https://support.google.com/accounts/answer/3024190?hl=ja',
      checked: CHECKED,
      kind: 'official',
    },
    legacyJson: {
      label: 'Global Export Data の JSON',
      value: 'sleep-日付.json（dateOfSleep・startTime は現地の時刻・levels.summary）、steps-日付.json と heart_rate-日付.json（dateTime は "MM/DD/YY HH:MM:SS"）、resting_heart_rate-日付.json、weight-日付.json、exercise-番号.json',
      source: '公開の解析コード: kev-m/FitOut（2026-03 更新）、saubury/duckdb-fitbit（2023）、barfittc/Takeout.Fitbit.Parser（2023）',
      url: 'https://github.com/kev-m/FitOut',
      checked: CHECKED,
      kind: 'public-code',
    },
    utcTimes: {
      label: '分ごとの記録と運動の時刻',
      value: 'steps・heart_rate の dateTime と exercise の startTime は UTC。ファイル名の日付は現地の日付（解析した人の観察）',
      source: 'saubury/duckdb-fitbit の解析ノート（UTC+11 の人が +11 時間して日ごとに集計）、iccir919/fitbit-json-to-csv（GMT から直す）',
      url: 'https://github.com/saubury/duckdb-fitbit',
      checked: CHECKED,
      kind: 'public-code',
    },
    googleDataCsv: {
      label: '_GoogleData の CSV（新しい形）',
      value: 'Physical Activity_GoogleData の daily_resting_heart_rate.csv（timestamp, beats per minute）・steps_日付.csv（timestamp, steps）・weight.csv（weight grams）、Health Fitness Data_GoogleData の UserSleeps_*.csv、Sleep Score の sleep_score.csv',
      source: '公開の解析コード: armixlabs/FitbitToGarminConverter（2026-02）、joshgaus/FitBitDataAnalysis（2026-08）、kev-m/FitOut',
      url: 'https://github.com/armixlabs/FitbitToGarminConverter',
      checked: CHECKED,
      kind: 'public-code',
    },
    weightUnit: {
      label: 'weight-日付.json の体重の単位',
      value: 'ポンドとして kg に換算している解析がある。weight.csv（グラム）と同じ日があれば比べて決める',
      source: 'armixlabs/FitbitToGarminConverter（lbs → kg に換算）',
      url: 'https://github.com/armixlabs/FitbitToGarminConverter',
      checked: CHECKED,
      kind: 'public-code',
    },
    browser: {
      label: 'zip の展開に使うブラウザの機能',
      value: "DecompressionStream('deflate-raw'): Chrome・Edge 103、Firefox 113、Safari 16.4 から",
      source: 'MDN browser-compat-data 8.1.3',
      url: 'https://developer.mozilla.org/docs/Web/API/DecompressionStream',
      checked: CHECKED,
      kind: 'official',
    },
  };

  var api = { CHECKED: CHECKED, SOURCES: SOURCES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Constants = api;
})(this);
