# Fitbit データ CSV 変換

公開 URL: **https://yorozu-craft.com/fitbit-export/**（英語版 **https://yorozu-craft.com/fitbit-export/en/**）

Fitbit（2026 年 5 月から Google Health）の書き出し（Google Takeout の zip）をブラウザの中で読み、睡眠・睡眠スコア・歩数・安静時心拍数・体重・運動を日ごとの CSV（Excel 用）と Markdown（Obsidian 用）にする。
yorozu-craft のツールの1つです（共通ルールは [youheioonuki.github.io の README](https://github.com/YouheiOonuki/youheioonuki.github.io) を参照）。企画書は yorozu-plans の `docs/23_Fitbit書き出し変換.md`（K81）。

## 機能

- 書き出しの `.zip`（分割された複数の zip も一度に）、展開したフォルダ、個別の JSON・CSV を読む。ドロップも可
- 結果の前に、日数・期間・項目ごとの日数・読めなかったファイル・直近 7 日の表を出す（アプリの値と見比べる用）
- 出力: 日ごとの CSV（BOM あり/なし、列名 日本語/英語、期間）、運動の一覧の CSV、Markdown の zip（1 日 1 ファイルの frontmatter つき、または 1 か月 1 ファイルの表）
- **ファイルは端末の外に出ない**: 送信・アップロード・API・トークンは使わない。ファイルも設定も localStorage に保存しない（健康の記録を端末に残さない）。オフライン対応（`sw.js`）なので、一度開けば機内モードでも動く
- Garmin・Apple ヘルスケア・Strava の取り込み形式への変換はしない（MVP の外）

## 英語版（`en/`、2026-09-25）

- `en/index.html`・`en/guide.html`。同じ `calc.js`・`zip.js`・`main.js` を使い、画面の文だけ `text.js` の `en`（`<html lang="en">` で切り替え）。calc.js・zip.js の例外は `code` を持ち、英語の文は `text.js` の `err`
- 英語の既定: 列名は英語、体重の出力の単位を選べる（`#wout`。端末の言語が `-US` なら lb、ほかは kg）。日本語の画面は kg のまま。`weight-*.json` の単位の判断（自動・lb・kg）は日英で同じ
- hreflang（ja・en・x-default＝日本語）を日英の 4 ページに。切り替えリンクは上端。英語のフッターのホームは `/en/`、共通ページは `/en/about.html`・`/en/privacy-policy.html`
- 出典の英語の文は `constants.js` の `SOURCES.*.en`（確認日は同じ `CHECKED`）
- 何も保存しないので、リセットのボタンは置かない（画面に "Nothing is saved." と書く）

## 読み方

| 段 | どこ | 中身 |
|---|---|---|
| zip | `zip.js` | 末尾の中央ディレクトリだけ読み、要る項目だけ `Blob.slice` で取り出して `DecompressionStream('deflate-raw')` で展開。ZIP64 対応。zip 全体をメモリに載せない。心拍数の細かい記録（`heart_rate-*.json`、書き出しで最も大きい）は開かない |
| 種類 | `calc.js` の `classify` | フォルダ名は見ず、ファイル名だけで決める（Takeout の `Fitbit/Global Export Data/`、旧アカウントアーカイブの `Sleep/`・`Physical Activity/`、フォルダ名が `Google Health` の場合のどれでも読めるように） |
| 読む | `parseInto` | 時差に依らない形でためる。歩数は 15 分の区切りごとの合計だけ持つ（5 年分でも数十万件） |
| まとめる | `aggregate` | タイムゾーンと体重の単位を当てて日ごとに。設定を変えたらここだけやり直す |
| 出す | `toCsv`・`toMarkdownFiles`・`Zip.makeZip`（無圧縮） | CSV は CRLF。Markdown の frontmatter の文字列はすべて二重引用符 |

zip の読み方にライブラリ（fflate など）を使わなかった理由: (1) Takeout の zip は 2〜50 GB になり、`unzipSync` のように全体を `ArrayBuffer` に読むとスマホで落ちる。(2) ストリームで頭から読む方式でも、使わない心拍数のファイル（数 GB）まで全部読むことになる。(3) 中央ディレクトリの読み取りは 100 行ほどで、第三者のコードを同梱・保守しなくて済む。展開はブラウザの標準機能（Chrome・Edge 103、Firefox 113、Safari 16.4 から）。

### 読むファイルと扱い

| ファイル（名前だけで判定） | 使う値 | 時刻・日付の扱い |
|---|---|---|
| `sleep-YYYY-MM-DD.json` | `dateOfSleep`・`startTime`・`endTime`・`minutesAsleep`・`minutesAwake`・`timeInBed`・`mainSleep`・`levels.summary` の deep/light/rem（`type: "stages"` のときだけ） | 現地の時刻のまま。`mainSleep` の最長をその日の睡眠、ほかは「ほかの睡眠」 |
| `UserSleeps_*.csv` | `sleep_start`・`sleep_end`・`start_utc_offset`・`end_utc_offset`・`minutes_asleep`・`minutes_awake`・`minutes_in_sleep_period` | UTC に offset を足す。JSON の睡眠が無い日だけ使う。内訳は出さない |
| `sleep_score.csv` | `sleep_log_entry_id`・`timestamp`・`overall_score` | ID が睡眠の `logId` と結べればその日、結べなければ timestamp の日付 |
| `steps-YYYY-MM-DD.json` | `dateTime`（`MM/DD/YY HH:MM:SS`）・`value` | **UTC とみなして**選んだタイムゾーンで日付を分ける |
| `steps_YYYY-MM-DD.csv` | `timestamp`・`steps` | 時差の書き（`Z` など）があれば UTC。JSON と同じ日があれば JSON を使い、食い違いを数えて内訳に出す |
| `resting_heart_rate-YYYY-MM-DD.json` | `value.date`・`value.value` | 日付そのまま。0 と空は捨てる。整数に四捨五入 |
| `daily_resting_heart_rate.csv` | `timestamp`・`beats per minute` | 日付の部分をそのまま。JSON が優先 |
| `weight-YYYY-MM-DD.json` | `weight`・`bmi`・`fat`・`date`・`time` | **単位はポンドとみなす**。`weight.csv` と同じ日があれば比べて決める。画面で lb / kg を選べる |
| `weight.csv` | `timestamp`・`weight grams` | 時差の書きがあれば UTC |
| `exercise-N.json` | `activityName`・`startTime`・`originalStartTime`・`duration`・`activeDuration`・`steps`・`calories`・`averageHeartRate` | `originalStartTime` に時差の書きがあればその時刻、無ければ `startTime` を UTC とみなす |

形式の出典（2026-09-25 確認。`constants.js` の `SOURCES` にも同じもの）:

- 手順・期限（公式）: [Google Health ヘルプ 14236615](https://support.google.com/fitbit/answer/14236615?hl=ja)（Google アカウントなら Takeout で「Google Health」を選ぶ。Fitbit アカウントなら fitbit.com の設定 → データ エクスポート）、[14237024](https://support.google.com/googlehealth/answer/14237024?hl=ja)（2026-05-19 以降 Fitbit アカウントでログイン不可、2026-07-15 削除処理開始）、[Google アカウント ヘルプ 3024190](https://support.google.com/accounts/answer/3024190?hl=ja)（.zip / .tgz、上限を超えると分割、最大 50 GB、約 7 日で期限切れ）
- 形式（公開の解析コード。Google は中身の列を説明していない）: [kev-m/FitOut](https://github.com/kev-m/FitOut)（sleep・resting_heart_rate・weight・exercise の JSON の例、`heart_rate_YYYY-MM-DD.csv` の `timestamp,beats per minute` と `...Z`）、[saubury/duckdb-fitbit](https://github.com/saubury/duckdb-fitbit)（steps・heart_rate の `MM/DD/YY HH:MM:SS` と、UTC+11 の人が +11 時間して集計、sleep の stages と classic の違い、exercise の `startTime` にも +11 時間）、[barfittc/Takeout.Fitbit.Parser](https://github.com/barfittc/Takeout.Fitbit.Parser)（`MM/dd/yy HH:mm:ss`）、[armixlabs/FitbitToGarminConverter](https://github.com/armixlabs/FitbitToGarminConverter)（`_GoogleData` の CSV の列名、UserSleeps、weight の lbs と `weight grams`、`sleep_score.csv` の列）、[joshgaus/FitBitDataAnalysis](https://github.com/joshgaus/FitBitDataAnalysis)（2026-08 の書き出しで `Physical Activity_GoogleData/daily_resting_heart_rate.csv`・`Sleep Score/sleep_score.csv` と JSON が並ぶ）

## テスト

`node --test tests/*.test.js`（CI は `.github/workflows/test.yml`）。

- `tests/fixtures/takeout/` と `Calc.makeSample()`（画面の「見本で試す」）は**架空のデータ**。実在の人の記録ではない。上の表の形に合わせて手で作った（JSON と CSV の重なる日、classic の睡眠、昼寝、値 0 の心拍、ポンドとグラムの体重、UTC の日付またぎ、`originalStartTime` を含む）
- `sleep_score.csv` の `sleep_log_entry_id`・`restlessness` の列名は、公開コード（armixlabs は `timestamp` ほか 6 列を名前で、joshgaus は列番号 1・2・6・8 で読む）と矛盾しない形にしただけで、実物では確かめていない
- zip は Node の zlib で deflate した zip と ZIP64 の目次を組み立てて読む

## 保守

| 時期 | 確認すること | 直す場所 |
|------|------------|---------|
| 半年ごと・問い合わせがあったとき | 書き出しのフォルダ・ファイル名・列名が変わっていないか（Google Health の改名後も形式が動いている）。公開の解析コードの更新も見る | `calc.js` の `KINDS`・`parseInto`、`constants.js` の `SOURCES` と `CHECKED`、`guide.html` の更新履歴 |
| 確認日から 12 か月まで | 公式ヘルプの手順（Takeout の製品名「Google Health」） | `guide.html` の「エクスポートする方法」、`constants.js` |

## 開いた問い（実物の書き出しで確かめる）

1. `steps-*.json`・`exercise-*.json` の時刻が UTC か（公開の解析の観察どおりか）。同じ書き出しに `steps_*.csv`（`Z` つき）があれば、画面の内訳の「食い違い」で確かめられる
2. `weight-*.json` の単位がポンドか（表示の設定が kg でもか）
3. 2026 年の書き出しの一番上のフォルダ名（`Fitbit` か `Google Health` か）と、`Global Export Data` がまだ全期間入るか。ファイル名で読むので、どちらでも動く
4. `UserSleeps_*.csv`・`weight.csv`・`sleep_score.csv` の列名（1〜2 件の公開コードでしか確かめていない）
5. `sleep_score.csv` の `timestamp` が起きた時刻か、UTC か現地か（ID で結べないときだけ効く）
6. 書き出しの `.tgz` は読まない（展開したフォルダなら読める）

## ファイル

| ファイル | 役割 |
|---------|------|
| `index.html` | ツール本体（ファイルを選ぶ → 結果とダウンロード → 出力の形・時刻と単位） |
| `guide.html` | 使い方・書き出し方・読むファイルと時刻の扱い・よくある質問・注意・更新履歴 |
| `zip.js` | zip の読み（中央ディレクトリ・ZIP64・deflate）と書き（無圧縮） |
| `calc.js` | 種類の判定・読み込み・日ごとのまとめ・CSV・Markdown・見本（架空） |
| `constants.js` | 形式と手順の出典・確認日（`CHECKED`）。英語の文は `en` |
| `text.js` | 画面の文（日本語・英語） |
| `en/index.html`・`en/guide.html` | 英語版の本体と使い方 |
| `main.js` | 画面の制御（ファイルの選択・ドロップ・ダウンロード）。保存はしない |
| `screen.js` | 画面の部品（`details` の `summary` の状態表示） |
| `style.css` | 見た目（和紙風の配色、ダークモード対応） |
| `sw.js` / `manifest.webmanifest` | オフライン対応（キャッシュ名 `fitbit-export-v1`） |
| `404.html` | ツール配下の存在しない URL で出るページ（サイト共通のもの） |
| `favicon.svg` / `apple-touch-icon.png` / `og-image.png` | アイコン / ホーム画面用アイコン / SNS 共有用画像（1200×630） |
| `sitemap.xml` | サイトマップ（robots.txt はドメイン直下で管理） |
| `tests/*.test.js`・`tests/fixtures/` | テストと架空の書き出し |

## ライセンス

MIT License（`LICENSE`）。第三者のコード・データは同梱していない。
