/* ==========================================================================
   空調王｜本体（bundle）を組み立てる
   --------------------------------------------------------------------------
   月額の鍵（[[project-kuchoo-lock]]）のための下ごしらえ。

   いまの空調王は、ファイル一式が 50airtec.com に置いてあって誰でも読める。
   画面に鍵をかけても、ページを保存されたら終わり。
   → **契約していない人のブラウザに、本体を一度も届けない**しかない。

   そのために、空調王を二つに割る。

     入口（index.html）… 誰でも読める。ちいさな読み込み役だけ
     本体（bundle.js） … 画面・見た目・中身ぜんぶ。ここを契約者にだけ渡す

   この道具は「本体」を1本のファイルに固める。

       node build.mjs

   段階1のいまは、できた bundle.js を index.html と同じ場所に置いて、
   鍵をかけずにそのまま読み込む（＝いままでと同じ動き）。
   段階2で、この中身をクラウド（Firestore）に載せ替える。

   ★ ソースは動かしていない。style.css も app.js も今までの場所にある。
     デスクトップの点検道具（カタログ点検.mjs など）がそのまま使えるように。
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V = fs.readFileSync(path.join(HERE, 'version.txt'), 'utf8').trim();

/* 読み込む順番は、前の index.html の <script> の並びと同じにすること。
   pricebook.js と survey.js が先に定数を置き、app.js がそれを使う。
   sync.js は app.js のあと（window.AirtecSync を後から差し込むため）。 */
const JS_FILES = [
  'pricebook.js',
  'survey.js',
  'firebase-config.js',
  'catalog.js',
  'app.js',
  'sync.js',
];

const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');

/* --------------------------------------------------------------------------
   版番号をそろえる。

   版番号は version.txt が正。ほかの場所がずれていると、
   「直したのにスマホに届かない」が起きる（2026-09-10 に起きた）。
   割ってからは入口（index.html）にも版番号が入ったので、置き場所が増えた。
   人が3つも4つも手で合わせるのは無理なので、**ここで機械が合わせる。**
   -------------------------------------------------------------------------- */
function syncVersion(file, label) {
  const p = path.join(HERE, file);
  const before = fs.readFileSync(p, 'utf8');
  const after = before.replace(/\b20\d{10}\b/g, V);
  if (before === after) return;
  fs.writeFileSync(p, after);
  const n = (before.match(/\b20\d{10}\b/g) || []).filter((x) => x !== V).length;
  console.log('　版番号をそろえました：', label, '(' + n + 'か所)');
}
syncVersion('index.html', '入口');
syncVersion('app.js', 'app.js の APP_VERSION');

const bundle = {
  v: V,
  html: read('body.html'),
  css: read('style.css'),
  js: JS_FILES.map((f) => [f, read(f)]),
};

/* JSONP の形にしておく。
   段階1は <script src="bundle.js"> で読むだけ。
   段階2でクラウドから文字列で受け取るときも、同じ mount() に渡せばよい。 */
const out =
  '/* 空調王 本体 ' + V + ' — この中身は build.mjs が作っています。手で直さないこと */\n' +
  'window.__KUCHOO_BUNDLE__(' + JSON.stringify(bundle) + ');\n';

const dest = path.join(HERE, 'bundle.js');
fs.writeFileSync(dest, out);

/* ---------- 自分で確かめる ---------------------------------------------- */
const kb = (n) => (n / 1024).toFixed(1) + 'KB';
console.log('版　　：', V);
console.log('画面　：', kb(bundle.html.length));
console.log('見た目：', kb(bundle.css.length));
bundle.js.forEach(([f, s]) => console.log('　　　 ', f.padEnd(20), kb(s.length)));
console.log('本体　：', kb(fs.statSync(dest).size), '→', dest);

/* 画面の中に <script> が残っていたら、二重に走ってしまう */
if (/<script/i.test(bundle.html)) {
  console.error('✗ body.html の中に <script> が残っています。JS_FILES に移してください');
  process.exitCode = 1;
}
/* 入口が使う目印が揃っているか */
['id="app"', 'id="preview"'].forEach((mark) => {
  if (bundle.html.indexOf(mark) < 0) {
    console.error('✗ body.html に ' + mark + ' が見つかりません');
    process.exitCode = 1;
  }
});
if (!process.exitCode) console.log('○ 点検 OK');
