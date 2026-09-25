// ページの決まり（youheioonuki.github.io の README「ツールを追加するとき」23）: 英語のページ・hreflang の対・英語の画面に日本語を残さない
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const BASE = 'https://yorozu-craft.com/fitbit-export/';
const CJK = /[぀-ヿ㐀-鿿！-｠]/;
const { TEXT, errorText } = require('../text.js');
const K = require('../constants.js');

const PAIRS = [['index.html', 'en/index.html', '', 'en/'], ['guide.html', 'en/guide.html', 'guide.html', 'en/guide.html']];

/** 画面に出る文（コメント・script・style を除いた本文と、title・description・alt・aria-label） */
function visibleText(html) {
  const head = [...html.matchAll(/<title>([\s\S]*?)<\/title>|<meta (?:name="description"|property="og:[a-z]+") content="([^"]*)"/g)].map((m) => m[1] || m[2]).join('\n');
  const attrs = [...html.matchAll(/\s(?:aria-label|alt|title|placeholder)="([^"]*)"/g)].map((m) => m[1]).join('\n');
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<head>[\s\S]*?<\/head>/, '').replace(/<[^>]+>/g, ' ');
  return head + '\n' + attrs + '\n' + body;
}
/** 関数も含めて、文をすべて集める（関数は見本の値で呼ぶ） */
function allStrings(o, out = []) {
  const sample = { date: '2026-01-10', value: 150, compared: 2, unit: 'lb', sample: { date: '2026-01-10', value: 150 }, differ: 1, examples: [{ date: '2026-01-10', json: 1, csv: 2 }] };
  for (const v of Object.values(o)) {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') {
      // 引数の形は関数ごとに違うので、いくつかの形で呼んで、呼べたものの文を全部見る
      for (const args of [[sample, String], ['3', ['a'], true], [sample], ['1'], ['lb']]) {
        let r;
        try { r = v(...args); } catch (e) { continue; }
        if (Array.isArray(r)) out.push(...r.map(String)); else if (r != null) out.push(String(r));
      }
    } else if (Array.isArray(v)) out.push(...v.map(String));
    else if (v && typeof v === 'object') allStrings(v, out);
  }
  return out;
}

test('英語のページがあり、<html lang="en">・canonical は英語のページ自身', () => {
  for (const [, en, , enUrl] of PAIRS) {
    const s = read(en);
    assert.match(s, /<html lang="en">/, en);
    assert.ok(s.includes(`<link rel="canonical" href="${BASE}${enUrl}">`), en);
  }
});

test('hreflang: 日英の対が両方向に同じ 3 行（ja・en・x-default＝日本語）', () => {
  for (const [ja, en, jaUrl, enUrl] of PAIRS) {
    for (const f of [ja, en]) {
      const s = read(f);
      assert.ok(s.includes(`<link rel="alternate" hreflang="ja" href="${BASE}${jaUrl}">`), f + ' ja');
      assert.ok(s.includes(`<link rel="alternate" hreflang="en" href="${BASE}${enUrl}">`), f + ' en');
      assert.ok(s.includes(`<link rel="alternate" hreflang="x-default" href="${BASE}${jaUrl}">`), f + ' x-default');
    }
    assert.ok(read(ja).includes(`<link rel="canonical" href="${BASE}${jaUrl}">`), ja);
  }
});

test('日英の切り替えリンク（hreflang と lang つき）', () => {
  assert.ok(read('index.html').includes('<a href="./en/" hreflang="en" lang="en">English</a>'));
  assert.ok(read('guide.html').includes('<a href="./en/guide.html" hreflang="en" lang="en">English</a>'));
  assert.ok(read('en/index.html').includes('<a href="../" hreflang="ja" lang="ja">日本語</a>'));
  assert.ok(read('en/guide.html').includes('<a href="../guide.html" hreflang="ja" lang="ja">日本語</a>'));
});

test('英語のページのホームは英語のトップ（/en/）、共通ページも英語版', () => {
  for (const f of ['en/index.html', 'en/guide.html']) {
    const s = read(f);
    // en/ から ../../en/ は https://yorozu-craft.com/en/
    assert.equal(new URL('../../en/', BASE + 'en/').href, 'https://yorozu-craft.com/en/');
    assert.ok(s.includes('<li><a href="../../en/">yorozu-craft (English)</a></li>'), f);
    assert.ok(!/href="\.\.\/\.\.\/"/.test(s) && !/href="\.\.\/\.\.\/(about|privacy-policy)\.html"/.test(s), f + ' 日本語のトップ・共通ページに向けない');
    assert.ok(s.includes('href="../../en/about.html"') && s.includes('href="../../en/privacy-policy.html"'), f);
  }
});

test('英語の画面に日本語を残さない（切り替えリンクの「日本語」だけ）', () => {
  for (const f of ['en/index.html', 'en/guide.html']) {
    const t = visibleText(read(f)).replace('日本語', '');
    const hit = t.split('\n').filter((l) => CJK.test(l));
    assert.deepEqual(hit, [], f);
  }
  const en = allStrings(TEXT.en);
  assert.ok(en.length > 40);
  assert.deepEqual(en.filter((x) => CJK.test(x)), []);
  // 出典の一覧（英語の使い方ページ）
  for (const [k, s] of Object.entries(K.SOURCES)) {
    assert.ok(s.en && s.en.label && s.en.value && s.en.source, k);
    assert.ok(!CJK.test(s.en.label + s.en.value + s.en.source), k);
  }
  // main.js に画面の文を直接書かない（コメントを除いて日本語が無い）
  const code = read('main.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!CJK.test(code), 'main.js');
});

test('日英で同じ部品（id）を持つ（main.js を共有するため）', () => {
  const ids = (s) => new Set([...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const ja = ids(read('index.html')), en = ids(read('en/index.html'));
  for (const id of ja) assert.ok(en.has(id), id);
  assert.ok(en.has('wout'));
});

test('商標の注記（非公式・関係なし）が名前の近くにある', () => {
  assert.ok(read('en/index.html').includes('<p class="tm">Unofficial. Not affiliated with Fitbit or Google.</p>'));
  assert.ok(read('en/guide.html').includes('<p class="tm">Unofficial. Not affiliated with Fitbit or Google.</p>'));
  assert.ok(read('index.html').includes('<p class="tm">非公式のツールです。Fitbit・Google とは関係ありません。</p>'));
});

test('何も保存しない: localStorage を使わず、英語の画面にもそう書く（リセットのボタンは要らない）', () => {
  for (const f of ['main.js', 'calc.js', 'zip.js', 'text.js', 'screen.js']) assert.ok(!/localStorage|sessionStorage|indexedDB/.test(read(f).replace(/\/\/.*$/gm, '')), f);
  assert.ok(read('en/index.html').includes('Nothing is saved.'));
});

test('sitemap と Service Worker に英語のページ', () => {
  const sm = read('sitemap.xml');
  for (const u of ['fitbit-export/</loc>', 'fitbit-export/guide.html</loc>', 'fitbit-export/en/</loc>', 'fitbit-export/en/guide.html</loc>']) assert.ok(sm.includes(u), u);
  const sw = read('sw.js');
  for (const u of ["'./en/'", "'./en/index.html'", "'./en/guide.html'", "'./text.js'"]) assert.ok(sw.includes(u), u);
  assert.ok(read('main.js').includes("EN ? '../sw.js' : './sw.js'"));
});

test('AdSense とビーコンが日英の全ページに 1 つずつ', () => {
  for (const f of ['index.html', 'guide.html', 'en/index.html', 'en/guide.html']) {
    const s = read(f);
    assert.equal((s.match(/cloudflareinsights\.com\/beacon/g) || []).length, 1, f);
    assert.equal((s.match(/name="google-adsense-account"/g) || []).length, 1, f);
  }
});

test('例外の文: 英語は code から、日本語は message のまま', () => {
  const e = Object.assign(new Error('この圧縮方式（12）は読めません'), { code: 'method', arg: 12 });
  assert.equal(errorText(TEXT.en, e), 'compression method 12 is not supported');
  assert.equal(errorText(TEXT.ja, e), 'この圧縮方式（12）は読めません');
  assert.equal(errorText(TEXT.en, new Error('Unexpected token')), 'Unexpected token');
  for (const code of ['notArray', 'notZip', 'badIndex', 'badEntry', 'encrypted', 'noDecompress']) assert.equal(typeof TEXT.en.err[code], 'string', code);
});

test('英語の文: 1 のときは単数', () => {
  const T = TEXT.en;
  assert.equal(T.days('1'), '1 day');
  assert.equal(T.days('50'), '50 days');
  assert.equal(T.skipped(1), '1 other file was skipped (for example, minute-by-minute heart rate).');
  assert.equal(T.range({ from: '2026-08-01', to: '2026-09-19' }, ['steps 50'], '1'), '2026-08-01 to 2026-09-19 (days with steps 50; 1 exercise session)');
});
