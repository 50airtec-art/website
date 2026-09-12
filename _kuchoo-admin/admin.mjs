/* ==========================================================================
   空調王｜元締めの道具（本体を載せる・ライセンスキーを配る）
   --------------------------------------------------------------------------
   これは BIGBOSS のパソコンでだけ動かす道具です。**サイトには置かれません。**

   ■ できること

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
/** 名前でもキーでも引ける */
function findLic(l, needle) {
  const n = normKey(needle);
  return l.licences.find((x) => normKey(x.key) === n) ||
         l.licences.find((x) => x.name === needle) ||
         l.licences.find((x) => x.name.indexOf(needle) >= 0);
}

const licDocName = (key)    => sha256hex('airtec-lic-v1:' + normKey(key)) + '_lic';
const appDocName = (secret) => sha256hex('airtec-app-v1:' + secret) + '_app';

/** 1人ぶんの札をクラウドに書く */
async function writeLic(lic, secret) {
  const blob = seal({ until: lic.until, name: lic.name, secret }, keyFromPassphrase(lic.key));
  await docPut(licDocName(lic.key), blob);
  return blob.length;
}

/* ==========================================================================
   4. 命令
   ========================================================================== */
const yen = (n) => n.toLocaleString('ja-JP');
const kb = (n) => (n / 1024).toFixed(1) + 'KB';
const today = () => new Date().toISOString().slice(0, 10);

async function cmdIssue(name, until) {
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(until || '')) {
    throw new Error('使い方： node admin.mjs issue "会社名" 2027-03-31');
  }
  const l = loadLedger();
  if (!l.secret) throw new Error('先に `node admin.mjs publish` で本体を載せてください（合鍵がまだありません）');
  if (l.licences.some((x) => x.name === name)) {
    throw new Error('「' + name + '」はもう発行ずみです。期限を延ばすなら renew を使ってください');
  }
  const lic = { name, key: makeKey(), until, issued: today() };
  await writeLic(lic, l.secret);
  l.licences.push(lic);
  saveLedger(l);
  console.log('');
  console.log('　' + name + ' さんのライセンスキー');
  console.log('');
  console.log('　　　' + lic.key);
  console.log('');
  console.log('　期限：' + until);
  console.log('　渡し方：このキーを伝えて、50airtec.com/m を開いてもらうだけです。');
  console.log('');
}

async function cmdRenew(needle, until) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until || '')) {
    throw new Error('使い方： node admin.mjs renew 今野空調 2028-03-31');
  }
  const l = loadLedger();
  const lic = findLic(l, needle);
  if (!lic) throw new Error('「' + needle + '」が見つかりません');
  lic.until = until;
  await writeLic(lic, l.secret);
  saveLedger(l);
  console.log('○ ' + lic.name + ' の期限を ' + until + ' にしました');
  console.log('　（相手の端末では、次にクラウドへつないだときに反映されます。最長30日）');
}

async function cmdRevoke(needle) {
  const l = loadLedger();
  const lic = findLic(l, needle);
  if (!lic) throw new Error('「' + needle + '」が見つかりません');
  await docDel(licDocName(lic.key));
  lic.revoked = today();
  saveLedger(l);
  console.log('○ ' + lic.name + ' の札をクラウドから消しました');
  console.log('　相手の端末は、手元の控えが切れたところ（最長30日）で開かなくなります。');
  console.log('　すぐ止めたいときは、合鍵を作り直してください： node admin.mjs publish --rotate');
}

function cmdList() {
  const l = loadLedger();
  if (!l.licences.length) { console.log('まだ1件も発行していません。'); return; }
  console.log('');
  console.log('  会社名'.padEnd(24) + 'キー'.padEnd(26) + '期限'.padEnd(13) + '状態');
  console.log('  ' + '-'.repeat(74));
  const t = today();
  l.licences.forEach((x) => {
    const state = x.revoked ? '止めた (' + x.revoked + ')' : (x.until < t ? '期限ぎれ' : '契約中');
    console.log('  ' + x.name.padEnd(22) + '  ' + x.key.padEnd(24) + '  ' + x.until.padEnd(11) + '  ' + state);
  });
  const alive = l.licences.filter((x) => !x.revoked && x.until >= t).length;
  console.log('');
  console.log('  契約中 ' + alive + '社　＝　月 ¥' + yen(alive * 2980) + '　／　年 ¥' + yen(alive * 2980 * 12));
  console.log('');
}

async function cmdPublish(rotate) {
  if (!fs.existsSync(BUNDLE)) {
    throw new Error('bundle.js がありません。先に `cd tools\\estimate && node build.mjs` を走らせてください');
  }
  /* 先にログインしておく。暗号に半秒かかるので、
     「鍵が無い」で落ちるなら、その前に言ってあげたほうが親切 */
  await accessToken();
  /* bundle.js は「window.__KUCHOO_BUNDLE__({...});」の形。中の {...} だけ取り出す */
  const src = fs.readFileSync(BUNDLE, 'utf8');
  const from = src.indexOf('window.__KUCHOO_BUNDLE__(');
  if (from < 0) throw new Error('bundle.js の形がちがいます。build.mjs で作り直してください');
  const json = src.slice(from + 'window.__KUCHOO_BUNDLE__('.length, src.lastIndexOf(');'));
  const bundle = JSON.parse(json);

  const l = loadLedger();
  const fresh = !l.secret || rotate;
  if (fresh) l.secret = crypto.randomBytes(32).toString('hex');

  const blob = seal(bundle, keyFromSecret(l.secret));
  console.log('本体　：' + kb(src.length) + ' → 暗号にして ' + kb(blob.length));
  if (blob.length > 950000) {
    throw new Error('大きすぎます（1件950KBまで）。本体を減らすか、分けて置く必要があります');
  }
  await docPut(appDocName(l.secret), blob);
  console.log('○ 本体を載せました（版 ' + bundle.v + '）');
  if (fresh) console.log('○ 合鍵を' + (rotate ? '作り直しました' : '作りました'));

  /* 合鍵を作り直したら、契約中の人の札を全部書き直す。
     やらないと、次に開いたとき全員が古い合鍵で本体を探して、見つからない */
  const t = today();
  const alive = l.licences.filter((x) => !x.revoked && x.until >= t);
  for (const lic of alive) {
    await writeLic(lic, l.secret);
    console.log('　札を書き直しました：' + lic.name);
  }
  saveLedger(l);
  console.log('○ 済み（契約中 ' + alive.length + '社）');
}

async function cmdCheck(key) {
  if (!key) throw new Error('使い方： node admin.mjs check ABCDE-FGHJK-LMNPQ-RSTUV');
  console.log('お客さんと同じ順番でたどってみます。');
  const licDoc = await docGet(licDocName(key));
  if (!licDoc) { console.log('✗ 札がありません（このキーでは開けません）'); return; }
  const info = unseal(licDoc.blob, keyFromPassphrase(key));
  console.log('○ 札：' + info.name + '　期限 ' + info.until +
              (info.until < today() ? '　← 期限ぎれ' : ''));
  const appDoc = await docGet(appDocName(info.secret));
  if (!appDoc) { console.log('✗ 本体がありません（publish がまだ）'); return; }
  const bundle = unseal(appDoc.blob, keyFromSecret(info.secret));
  console.log('○ 本体：版 ' + bundle.v + '　画面 ' + kb(bundle.html.length) +
              '　中身 ' + bundle.js.length + '本');
  console.log('○ この人は開けます。');
}

/* ==========================================================================
   5. 入口
   ========================================================================== */
const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === 'issue')        await cmdIssue(a, b);
  else if (cmd === 'renew')   await cmdRenew(a, b);
  else if (cmd === 'revoke')  await cmdRevoke(a);
  else if (cmd === 'list')    cmdList();
  else if (cmd === 'publish') await cmdPublish(a === '--rotate');
  else if (cmd === 'check')   await cmdCheck(a);
  else {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('■ できること')[1].split('■ 最初の1回')[0].replace(/^\s*\n/, ''));
  }
} catch (e) {
  console.error('');
  console.error('✗ ' + e.message);
  console.error('');
  process.exitCode = 1;
}
