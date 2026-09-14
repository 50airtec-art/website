/* ==========================================================================
   空調王｜元締めの道具（本体を載せる・ライセンスキーを配る）
   --------------------------------------------------------------------------
   これは BIGBOSS のパソコンでだけ動かす道具です。**サイトには置かれません。**

   ■ ふだんは、これだけ覚えていれば足ります

     node admin.mjs serve       画面をひらく（ボタンで全部できます）

   ■ 黒い画面から直に打ちたいとき

     node admin.mjs doctor                      いまの調子を見る（★困ったらまずこれ）
     node admin.mjs list                        いま誰に配っているか
     node admin.mjs issue "今野空調" 2027-03-31  キーを1つ発行する
     node admin.mjs renew  今野空調 2028-03-31   期限を延ばす
     node admin.mjs revoke 今野空調              止める（クラウドの札を消す）
     node admin.mjs publish                     本体をクラウドに載せる
     node admin.mjs publish --rotate            合鍵を作り直して、全員の札も書き直す
     node admin.mjs check  <キー>                その人の目線で本当に開けるか確かめる

   ■ 最初の1回だけ、やっておくこと

     1. Firebase コンソール → （歯車）プロジェクトの設定 → サービスアカウント
        →「新しい秘密鍵の生成」→ JSONファイルが落ちてくる
     2. そのファイルを、このフォルダに service-account.json という名前で置く

     ★ この JSON は**パスワードそのもの**です。人に見せない。
       .gitignore に入れてあるので GitHub には上がりません。
       アスラーダも中身は見ません（ファイルの場所を読むだけです）。

   ■ 覚え書き（licences.json）

     誰にどのキーを渡したかは、このフォルダの licences.json に控えます。
     クラウドの札は**そのキーで暗号にしてある**ので、キーを無くすと
     こちらからも読めなくなります。**このファイルは消さないこと。**
     （これも .gitignore に入っています）
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SA_PATH = process.env.AIRTEC_SA || path.join(HERE, 'service-account.json');
const LEDGER = path.join(HERE, 'licences.json');
const BUNDLE = path.join(HERE, '..', 'tools', 'estimate', 'bundle.js');
const PROJECT_ID = 'airtec-sync';

/* ==========================================================================
   1. 暗号。入口（index.html）の unseal とぴったり同じ形にする
   ========================================================================== */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 紛らわしい I O 0 1 は使わない

function makeKey() {
  const r = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) {
    out += ALPHABET[r[i] % ALPHABET.length];
    if (i % 5 === 4 && i !== 19) out += '-';
  }
  return out;                                          // 例 ABCDE-FGHJK-LMNPQ-RSTUV
}
function normKey(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0').replace(/I/g, '1');
}
const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** 人が打つキー用。総当たりを重くするため PBKDF2 を20万回まわす */
function keyFromPassphrase(code) {
  const n = normKey(code);
  const salt = Buffer.from(sha256hex('airtec-salt-v1:' + n), 'utf8');
  return crypto.pbkdf2Sync(Buffer.from(n, 'utf8'), salt, 200000, 32, 'sha256');
}
/** 機械が作った乱数用。総当たりは端から無理なので SHA-256 一発 */
function keyFromSecret(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
}

/** 中身 → 暗号の封筒。ブラウザの unseal がそのまま開ける形 */
function seal(obj, key) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  const packed = zlib.gzipSync(raw);
  const z = packed.length < raw.length ? 1 : 0;
  const body = z ? packed : raw;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  /* WebCrypto は「暗号文のうしろに16バイトの封印」を付けた形を返す。
     node は別々に返すので、こちらでつなげて同じ形にする */
  const ct = Buffer.concat([c.update(body), c.final(), c.getAuthTag()]);
  return JSON.stringify({ v: 1, z, iv: iv.toString('base64'), ct: ct.toString('base64') });
}
/** 封筒 → 中身（自分で確かめる用） */
function unseal(str, key) {
  const env = JSON.parse(str);
  const buf = Buffer.from(env.ct, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
  d.setAuthTag(buf.subarray(buf.length - 16));
  let plain = Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]);
  if (env.z) plain = zlib.gunzipSync(plain);
  return JSON.parse(plain.toString('utf8'));
}

/* ==========================================================================
   2. クラウド（Firestore）。サービスアカウントで、ルールを通り越して書く
   ========================================================================== */
let tokenCache = null;

async function accessToken() {
  if (tokenCache && tokenCache.exp - 60000 > Date.now()) return tokenCache.tok;
  if (!fs.existsSync(SA_PATH)) {
    throw new Error(
      'service-account.json が見つかりません（' + SA_PATH + '）。\n' +
      '  Firebase コンソール →（歯車）プロジェクトの設定 → サービスアカウント\n' +
      '  →「新しい秘密鍵の生成」で落として、このフォルダに置いてください。');
  }
  const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat, exp: iat + 3600,
  });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).end()
    .sign(sa.private_key).toString('base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + unsigned + '.' + sig,
  });
  if (!res.ok) throw new Error('ログインできません：' + res.status + ' ' + (await res.text()).slice(0, 300));
  const j = await res.json();
  tokenCache = { tok: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tokenCache.tok;
}

const docUrl = (name) =>
  'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
  '/databases/(default)/documents/airtec/' + name;

async function docPut(name, blob) {
  const res = await fetch(docUrl(name), {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + (await accessToken()), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: { blob: { stringValue: blob }, at: { integerValue: String(Date.now()) } },
    }),
  });
  if (!res.ok) throw new Error('書けません：' + res.status + ' ' + (await res.text()).slice(0, 300));
}
async function docGet(name) {
  const res = await fetch(docUrl(name), {
    headers: { Authorization: 'Bearer ' + (await accessToken()) },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('読めません：' + res.status + ' ' + (await res.text()).slice(0, 300));
  const f = (await res.json()).fields || {};
  return { blob: f.blob ? f.blob.stringValue : '', at: f.at ? Number(f.at.integerValue) : 0 };
}
async function docDel(name) {
  const res = await fetch(docUrl(name), {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + (await accessToken()) },
  });
  if (!res.ok && res.status !== 404) throw new Error('消せません：' + res.status);
}

/* ==========================================================================
   3. 覚え書き
   ========================================================================== */
function loadLedger() {
  if (!fs.existsSync(LEDGER)) return { secret: null, licences: [] };
  return JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
}
function saveLedger(l) {
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2));
}
/** 名前でもキーでも引ける。
    ★ 空っぽで呼ばれたら、必ず「見つからない」にすること。
      `''.indexOf('')` は 0 なので、うっかりすると**いちばん上の1件に当たってしまう**。
      revoke を打ち間違えて、関係ない人を止める事故になる。 */
function findLic(l, needle) {
  const s = String(needle || '').trim();
  if (!s) return null;
  const n = normKey(s);
  return l.licences.find((x) => n && normKey(x.key) === n) ||
         l.licences.find((x) => x.name === s) ||
         l.licences.find((x) => x.name.indexOf(s) >= 0) || null;
}

const licDocName = (key)    => sha256hex('airtec-lic-v1:' + normKey(key)) + '_lic';
const appDocName = (secret) => sha256hex('airtec-app-v1:' + secret) + '_app';

/** 1人ぶんの札をクラウドに書く */
async function writeLic(lic, secret) {
  /* 合鍵が無いまま札を書くと、中身が {secret: 無し} になる。
     相手の端末は「本体の在処」を作れず、静かに開かなくなる。
     静かに壊れるのがいちばん困るので、ここで止める。 */
  if (!secret) throw new Error('合鍵がありません。先に［本体を載せる］を押してください');
  const blob = seal({ until: lic.until, name: lic.name, secret }, keyFromPassphrase(lic.key));
  await docPut(licDocName(lic.key), blob);
  return blob.length;
}

/* ==========================================================================
   4. 中身（画面からも、コマンドからも、同じここを呼ぶ）
   ========================================================================== */
const yen = (n) => n.toLocaleString('ja-JP');
const kb = (n) => (n / 1024).toFixed(1) + 'KB';
/* 日本語は1文字で2文字ぶんの幅を取るので、けた合わせは字数ではなく幅で数える */
const wide = (s) => [...String(s)].reduce((a, c) => a + (/[　-ヿ㐀-鿿！-｠]/.test(c) ? 2 : 1), 0);
const padJa = (s, n) => String(s) + ' '.repeat(Math.max(0, n - wide(s)));
const today = () => new Date().toISOString().slice(0, 10);
const TSUKI = 2980;                                   // 月額（[[research-2026-09-06-kuchoo-revenue]]）

const isAlive = (x, t) => !x.revoked && x.until >= t;

/** bundle.js を読んで、中の {...} を取り出す */
function readBundle() {
  if (!fs.existsSync(BUNDLE)) {
    throw new Error('bundle.js がありません。先に `cd tools\\estimate && node build.mjs` を走らせてください');
  }
  const src = fs.readFileSync(BUNDLE, 'utf8');
  const from = src.indexOf('window.__KUCHOO_BUNDLE__(');
  if (from < 0) throw new Error('bundle.js の形がちがいます。build.mjs で作り直してください');
  return { src, bundle: JSON.parse(src.slice(from + 'window.__KUCHOO_BUNDLE__('.length, src.lastIndexOf(');'))) };
}

async function doIssue(name, until) {
  name = String(name || '').trim();
  if (!name) throw new Error('会社名を入れてください');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until || '')) throw new Error('期限は 2027-03-31 の形で入れてください');
  const l = loadLedger();
  if (!l.secret) throw new Error('先に［本体を載せる］を押してください（合鍵がまだありません）');
  if (l.licences.some((x) => x.name === name && !x.revoked)) {
    throw new Error('「' + name + '」はもう発行ずみです。期限を延ばすなら［のばす］を使ってください');
  }
  const lic = { name, key: makeKey(), until, issued: today() };
  await writeLic(lic, l.secret);
  l.licences.push(lic);
  saveLedger(l);
  return lic;
}

async function doRenew(needle, until) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until || '')) throw new Error('期限は 2028-03-31 の形で入れてください');
  const l = loadLedger();
  const lic = findLic(l, needle);
  if (!lic) throw new Error('「' + needle + '」が見つかりません');
  lic.until = until;
  delete lic.revoked;                       // 止めたものを生き返らせることもある
  await writeLic(lic, l.secret);
  saveLedger(l);
  return lic;
}

async function doRevoke(needle) {
  const l = loadLedger();
  const lic = findLic(l, needle);
  if (!lic) throw new Error('「' + needle + '」が見つかりません');
  await docDel(licDocName(lic.key));
  lic.revoked = today();
  saveLedger(l);
  return lic;
}

async function doPublish(rotate) {
  const { src, bundle } = readBundle();
  /* 先にログインしておく。暗号に半秒かかるので、
     「鍵が無い」で落ちるなら、その前に言ってあげたほうが親切 */
  await accessToken();

  const l = loadLedger();
  const fresh = !l.secret || rotate;
  if (fresh) l.secret = crypto.randomBytes(32).toString('hex');

  const blob = seal(bundle, keyFromSecret(l.secret));
  if (blob.length > 950000) {
    throw new Error('大きすぎます（1件950KBまで／いまは ' + kb(blob.length) + '）。本体を減らすか、分けて置く必要があります');
  }
  await docPut(appDocName(l.secret), blob);

  /* 合鍵を作り直したら、契約中の人の札を全部書き直す。
     やらないと、次に開いたとき全員が古い合鍵で本体を探して、見つからない */
  const t = today();
  const alive = l.licences.filter((x) => isAlive(x, t));
  for (const lic of alive) await writeLic(lic, l.secret);

  l.publishedAt = new Date().toISOString();
  l.publishedVersion = bundle.v;
  saveLedger(l);
  return { version: bundle.v, rawKB: kb(src.length), sealedKB: kb(blob.length), fresh, rotate,
           rewritten: alive.map((x) => x.name) };
}

async function doCheck(key) {
  if (!key) throw new Error('キーを入れてください');
  const steps = [];
  const licDoc = await docGet(licDocName(key));
  if (!licDoc) { steps.push(['✗', '札がありません（このキーでは開けません）']); return { ok: false, steps }; }
  const info = unseal(licDoc.blob, keyFromPassphrase(key));
  const sugi = info.until < today();
  steps.push([sugi ? '✗' : '○', '札：' + info.name + '　期限 ' + info.until + (sugi ? '　← 期限ぎれ' : '')]);
  if (sugi) return { ok: false, steps };
  const appDoc = await docGet(appDocName(info.secret));
  if (!appDoc) { steps.push(['✗', '本体がありません（［本体を載せる］がまだ）']); return { ok: false, steps }; }
  const bundle = unseal(appDoc.blob, keyFromSecret(info.secret));
  steps.push(['○', '本体：版 ' + bundle.v + '　画面 ' + kb(bundle.html.length) + '　中身 ' + bundle.js.length + '本']);
  steps.push(['○', 'この人は開けます。']);
  return { ok: true, steps };
}

/* --------------------------------------------------------------------------
   クラウドの調子を見る

   ★ いちばん見たいのは「firestore.rules を貼り直したかどうか」。
     元締めの道具はサービスアカウントで動いていて、ルールを**通り越して**
     書き読みできてしまう。つまり、この道具が動くこと自体は、
     お客さんが開けることの証拠にならない。

     だから、ここだけは**お客さんとまったく同じやり方**（公開のAPIキーで
     匿名ログインして読む）で確かめる。無い置き場所を読みに行って
       404 …… ルールが新しい（その形の名前を読んでよい、と書いてある）
       403 …… ルールが古い（貼り直していない）
     -------------------------------------------------------------------------- */
const PUBLIC_API_KEY = 'AIzaSyC2OqPA7QwRfi9IMEOg3dD0TY2E-oN_SAo';

async function anonToken() {
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + PUBLIC_API_KEY,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  if (!res.ok) throw new Error('匿名ログインができません：' + res.status);
  return (await res.json()).idToken;
}

async function doDoctor() {
  const out = { sa: fs.existsSync(SA_PATH), bundle: null, ledger: null, rules: {}, note: [] };

  try { const { bundle } = readBundle(); out.bundle = { v: bundle.v, js: bundle.js.length }; }
  catch (e) { out.note.push(e.message); }

  const l = loadLedger();
  const t = today();
  out.ledger = {
    secret: !!l.secret,
    publishedAt: l.publishedAt || null,
    publishedVersion: l.publishedVersion || null,
    total: l.licences.length,
    alive: l.licences.filter((x) => isAlive(x, t)).length,
  };
  if (out.bundle && out.ledger.publishedVersion && out.bundle.v !== out.ledger.publishedVersion) {
    out.note.push('手元の本体（版 ' + out.bundle.v + '）が、載せてある版（' +
                  out.ledger.publishedVersion + '）と違います。［本体を載せる］を押してください。');
  }

  const none = '0'.repeat(64);
  try {
    const tok = await anonToken();
    for (const [part, label] of [['lic', '契約者の札'], ['app', '本体'], ['work', '見積の連動']]) {
      const res = await fetch('https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
        '/databases/(default)/documents/airtec/' + none + '_' + part,
        { headers: { Authorization: 'Bearer ' + tok } });
      out.rules[part] = { label, status: res.status, ok: res.status === 404 };
    }
  } catch (e) {
    out.note.push('クラウドにつながりません：' + e.message);
  }
  const bad = Object.keys(out.rules).filter((k) => !out.rules[k].ok);
  if (bad.length) {
    out.note.push('Firestore のルールが古いままです（' + bad.join(' / ') +
      ' が読めない）。tools/estimate/firestore.rules を Firebase コンソールに貼り直してください。' +
      '**貼らないと、誰も空調王を開けません。**');
  }
  return out;
}

function doList() {
  const l = loadLedger();
  const t = today();
  const rows = l.licences.map((x) => ({
    name: x.name, key: x.key, until: x.until, issued: x.issued || '',
    state: x.revoked ? '止めた' : (x.until < t ? '期限ぎれ' : '契約中'),
    revoked: x.revoked || null,
  }));
  const alive = rows.filter((r) => r.state === '契約中').length;
  return { rows, alive, tsuki: alive * TSUKI, nen: alive * TSUKI * 12 };
}

/* ==========================================================================
   5. コマンドで使うとき
   ========================================================================== */
async function cmdIssue(name, until) {
  const lic = await doIssue(name, until);
  console.log('');
  console.log('　' + lic.name + ' さんのライセンスキー');
  console.log('');
  console.log('　　　' + lic.key);
  console.log('');
  console.log('　期限：' + lic.until);
  console.log('　渡し方：このキーを伝えて、50airtec.com/m を開いてもらうだけです。');
  console.log('');
}
async function cmdRenew(needle, until) {
  const lic = await doRenew(needle, until);
  console.log('○ ' + lic.name + ' の期限を ' + lic.until + ' にしました');
  console.log('　（相手の端末では、次にクラウドへつないだときに反映されます。最長30日）');
}
async function cmdRevoke(needle) {
  const lic = await doRevoke(needle);
  console.log('○ ' + lic.name + ' の札をクラウドから消しました');
  console.log('　相手の端末は、手元の控えが切れたところ（最長30日）で開かなくなります。');
  console.log('　すぐ止めたいときは、合鍵を作り直してください： node admin.mjs publish --rotate');
}
function cmdList() {
  const r = doList();
  if (!r.rows.length) { console.log('まだ1件も発行していません。'); return; }
  console.log('');
  console.log('  ' + padJa('会社名', 22) + '  ' + padJa('キー', 24) + '  ' + padJa('期限', 11) + '  状態');
  console.log('  ' + '-'.repeat(74));
  r.rows.forEach((x) => {
    console.log('  ' + padJa(x.name, 22) + '  ' + padJa(x.key, 24) + '  ' + padJa(x.until, 11) + '  ' +
                x.state + (x.revoked ? ' (' + x.revoked + ')' : ''));
  });
  console.log('');
  console.log('  契約中 ' + r.alive + '社　＝　月 ¥' + yen(r.tsuki) + '　／　年 ¥' + yen(r.nen));
  console.log('');
}
async function cmdPublish(rotate) {
  const r = await doPublish(rotate);
  console.log('本体　：' + r.rawKB + ' → 暗号にして ' + r.sealedKB);
  console.log('○ 本体を載せました（版 ' + r.version + '）');
  if (r.fresh) console.log('○ 合鍵を' + (r.rotate ? '作り直しました' : '作りました'));
  r.rewritten.forEach((n) => console.log('　札を書き直しました：' + n));
  console.log('○ 済み（契約中 ' + r.rewritten.length + '社）');
}
async function cmdCheck(key) {
  console.log('お客さんと同じ順番でたどってみます。');
  (await doCheck(key)).steps.forEach(([m, s]) => console.log(m + ' ' + s));
}
async function cmdDoctor() {
  const d = await doDoctor();
  console.log('');
  console.log('　クラウドに書く鍵　：' + (d.sa ? '○ あります' : '✗ service-account.json がありません'));
  console.log('　手元の本体　　　　：' + (d.bundle ? '○ 版 ' + d.bundle.v : '✗ bundle.js がありません'));
  console.log('　載せてある版　　　：' + (d.ledger.publishedVersion || '（まだ載せていません）'));
  console.log('　契約　　　　　　　：' + d.ledger.alive + '社（発行ぜんぶで ' + d.ledger.total + '件）');
  console.log('');
  console.log('　ルール（お客さんと同じやり方で確かめました）');
  Object.keys(d.rules).forEach((k) => {
    const r = d.rules[k];
    console.log('　　' + padJa(r.label, 14) + (r.ok ? '○ 読める' : '✗ ' + r.status + ' で断られた'));
  });
  console.log('');
  d.note.forEach((n) => console.log('　※ ' + n));
  if (d.note.length) console.log('');
}

/* ==========================================================================
   6. 画面で使うとき（自分のパソコンの中だけで動く小さなサーバー）
   --------------------------------------------------------------------------
   ★ サービスアカウントの鍵は、ブラウザに渡しません。
     鍵はこの node の中にだけあり、ブラウザは「してほしいこと」を頼むだけです。

   ★ 127.0.0.1（自分のパソコン）だけで待ち受けます。外からは入れません。
     さらに、起動のたびに作る合言葉を知らないと何もできないようにしてあります
     （たまたま別のページが localhost を叩いても、素通りさせないため）。
   ========================================================================== */
async function cmdServe() {
  const http = await import('node:http');
  const token = crypto.randomBytes(16).toString('hex');
  /* 画面は頼まれるたびに読み直す。立ち上げ直さずに直せるように */
  const pagePath = path.join(HERE, 'console.html');

  const send = (res, code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    /* 別のサイトのページから叩かれないようにする */
    const host = String(req.headers.host || '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, 'text/plain', 'no');
    if (req.headers.origin && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(req.headers.origin)) {
      return send(res, 403, 'text/plain', 'no');
    }

    if (url.pathname === '/') {
      if (url.searchParams.get('t') !== token) return send(res, 403, 'text/plain', '合言葉が違います');
      return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(pagePath, 'utf8'));
    }

    if (url.pathname.startsWith('/api/')) {
      if (req.headers['x-airtec-token'] !== token) return send(res, 403, 'application/json', '{"error":"合言葉が違います"}');
      let body = '';
      for await (const c of req) body += c;
      const q = body ? JSON.parse(body) : {};
      try {
        let out;
        if (url.pathname === '/api/doctor')       out = await doDoctor();
        else if (url.pathname === '/api/list')    out = doList();
        else if (url.pathname === '/api/issue')   out = await doIssue(q.name, q.until);
        else if (url.pathname === '/api/renew')   out = await doRenew(q.key, q.until);
        else if (url.pathname === '/api/revoke')  out = await doRevoke(q.key);
        else if (url.pathname === '/api/publish') out = await doPublish(!!q.rotate);
        else if (url.pathname === '/api/check')   out = await doCheck(q.key);
        else return send(res, 404, 'application/json', '{"error":"そんな頼みごとはありません"}');
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, data: out }));
      } catch (e) {
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: false, error: e.message }));
      }
    }
    send(res, 404, 'text/plain', 'no');
  });

  await new Promise((r) => server.listen(8790, '127.0.0.1', r));
  const addr = 'http://127.0.0.1:8790/?t=' + token;
  console.log('');
  console.log('　空調王の元締め画面をひらきました。');
  console.log('');
  console.log('　　' + addr);
  console.log('');
  console.log('　この住所をブラウザに貼ってください（自分のパソコンの中だけで動いています）。');
  console.log('　終わるときは、この黒い画面で Ctrl + C を押してください。');
  console.log('');
}

/* ==========================================================================
   7. 入口
   ========================================================================== */
const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === 'issue')        await cmdIssue(a, b);
  else if (cmd === 'renew')   await cmdRenew(a, b);
  else if (cmd === 'revoke')  await cmdRevoke(a);
  else if (cmd === 'list')    cmdList();
  else if (cmd === 'publish') await cmdPublish(a === '--rotate');
  else if (cmd === 'check')   await cmdCheck(a);
  else if (cmd === 'doctor')  await cmdDoctor();
  else if (cmd === 'serve')   await cmdServe();
  else {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('■ ふだんは')[1].split('■ 最初の1回')[0].replace(/^[^\n]*\n/, ''));
  }
} catch (e) {
  console.error('');
  console.error('✗ ' + e.message);
  console.error('');
  process.exitCode = 1;
}
