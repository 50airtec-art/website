/* ==========================================================================
   空調王：スマホ ⇄ パソコンの連動（同期）
   --------------------------------------------------------------------------
   考え方
   - データは「この端末の中で暗号化してから」クラウド(Firestore)に置く。
     クラウド側には意味の分からない文字列しか残らないので、
     万一のぞかれても中身（お客様名・金額）は読めない。
   - 暗号のカギは「あいことば」。あいことばを知っている端末だけが読める。
     あいことばはクラウドには絶対に送らない。
   - 置き場所の名前（doc id）も、あいことばから作った当てられない64桁。
   - Firebase の SDK は読み込まない。REST（ただの fetch）だけで済ませる。
     外から読み込むスクリプトを増やさないため。

   同期のしかた
   - 現場・見積・請求書（小さい・よく変わる）→ 1件ずつ突き合わせて合体。
     消したものは「墓標」を残して、相手側でも消えるようにする。
   - 単価マスタ・機種データ（大きい・たまにしか変わらない）
     → まるごと1つ。あとから直したほうが勝ち。
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.AIRTEC_FIREBASE || null;
  var READY = !!(CFG && CFG.apiKey && CFG.projectId);

  /* ---------- 保存キー ---------- */
  var K_SYNC  = 'airtec_sync_v1';        // 連動の設定と覚え書き
  var K_AUTH  = 'airtec_sync_auth_v1';   // ログインの引換券
  var KEY_PB  = 'airtec_pricebook_v1';
  var KEY_MDL = 'airtec_models_v1';
  var LISTS = [
    { name: 'sites',     key: 'airtec_sites_v1',     label: '現場' },
    { name: 'estimates', key: 'airtec_estimates_v1', label: '見積' },
    { name: 'invoices',  key: 'airtec_invoices_v1',  label: '請求書' }
  ];

  var PUSH_WAIT_WORK   = 3000;    // 変更してから送るまで（小さいデータ）
  var PUSH_WAIT_MASTER = 15000;   // 同上（大きいデータ）
  var POLL_MS          = 45000;   // 相手の変更を見に行く間隔
  var MAX_BLOB         = 900000;  // 1回に置ける上限（Firestore は約1MB）
  var TOMB_DAYS        = 120;     // 墓標を残しておく日数

  /* 現場写真は1枚ずつ別の入れ物に預ける。
     まとめて送ると1MBの上限に一発で当たるし、1枚ごとなら
     途中で電波が切れても、送れたぶんは残る。
     1周でまとめて何十枚も動かすと、その間ずっと待たされるので枚数を区切る。 */
  var PH_UP_PER_ROUND   = 6;      // 1周で預ける枚数
  var PH_DOWN_PER_ROUND = 10;     // 1周でもらう枚数
  var PH_SOON_MS        = 4000;   // まだ残っているとき、次の周までの間

  /* ---------- ちいさな道具 ---------- */
  function lsGet(k, fb) {
    try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; }
    catch (e) { return fb; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function now() { return Date.now(); }
  function strHash(s) {                     // 中身が変わったかを見るだけの簡易ハッシュ
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return h.toString(36);
  }
  function b64enc(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  }
  function b64dec(str) {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---------- 連動の状態 ---------- */
  var S = null;
  function defState() {
    return {
      on: false,
      code: '',            // あいことば（この端末の中だけ）
      vault: '',           // 置き場所の名前（64桁）
      lastSync: 0,
      stamps: { sites: {}, estimates: {}, invoices: {} },   // 1件ごとの最終更新
      tomb:   { sites: {}, estimates: {}, invoices: {} },   // 消した印
      shadow: { sites: {}, estimates: {}, invoices: {} },   // 前回の中身（変更検知用）
      masterAt: 0,         // この端末で単価マスタを最後に直した時刻
      remoteMasterAt: 0,   // 取り込み済みのクラウド側マスタの時刻
      /* 現場写真。1枚ごとに見る。
         up は「その写真そのものを預け終えたか」。回転すると中身が変わるので、
         印には寸法と大きさ（見た目の指紋）を入れておき、違っていたら預け直す。 */
      ph: { stamps: {}, tomb: {}, shadow: {}, up: {}, big: {}, count: 0, bytes: 0 }
    };
  }
  function loadState() {
    S = lsGet(K_SYNC, null) || defState();
    var d = defState();
    ['stamps', 'tomb', 'shadow'].forEach(function (g) {
      S[g] = Object.assign({}, d[g], S[g] || {});
    });
    S.ph = Object.assign({}, d.ph, S.ph || {});
    ['stamps', 'tomb', 'shadow', 'up', 'big'].forEach(function (g) {
      if (!S.ph[g] || typeof S.ph[g] !== 'object') S.ph[g] = {};
    });
    if (typeof S.masterAt !== 'number') S.masterAt = 0;
    if (typeof S.remoteMasterAt !== 'number') S.remoteMasterAt = 0;
    return S;
  }
  function saveState() { lsSet(K_SYNC, S); }

  /* ======================================================================
     あいことば と 暗号
     ====================================================================== */
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 紛らわしい I O 0 1 は使わない

  function makeCode() {
    var r = new Uint8Array(20), out = '';
    crypto.getRandomValues(r);
    for (var i = 0; i < 20; i++) {
      out += ALPHABET[r[i] % ALPHABET.length];
      if (i % 5 === 4 && i !== 19) out += '-';
    }
    return out;                                        // 例 ABCDE-FGHJK-LMNPQ-RSTUV
  }
  function normCode(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      .replace(/O/g, '0').replace(/I/g, '1');          // 打ち間違いをある程度救う
  }
  function fmtCode(s) {
    var n = normCode(s), out = [];
    for (var i = 0; i < n.length; i += 5) out.push(n.slice(i, i + 5));
    return out.join('-');
  }

  async function sha256hex(str) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }
  async function vaultIdOf(code) { return sha256hex('airtec-vault-v1:' + normCode(code)); }

  var keyCache = null;
  async function aesKey(code) {
    if (keyCache && keyCache.code === code) return keyCache.key;
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normCode(code)),
      'PBKDF2', false, ['deriveKey']);
    var saltSrc = await sha256hex('airtec-salt-v1:' + normCode(code));
    var key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode(saltSrc), iterations: 200000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    keyCache = { code: code, key: key };
    return key;
  }

  async function gzip(bytes) {
    if (typeof CompressionStream !== 'function') return null;
    var st = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(st).arrayBuffer());
  }
  async function gunzip(bytes) {
    var st = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(st).arrayBuffer());
  }

  /** オブジェクト → 暗号化した文字列 */
  async function seal(obj) {
    var raw = new TextEncoder().encode(JSON.stringify(obj));
    var z = 0, body = raw;
    var packed = await gzip(raw);
    if (packed && packed.length < raw.length) { z = 1; body = packed; }
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await aesKey(S.code);
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, body));
    return JSON.stringify({ v: 1, z: z, iv: b64enc(iv), ct: b64enc(ct) });
  }
  /** 暗号化した文字列 → オブジェクト（あいことばが違えば例外になる） */
  async function unseal(str) {
    var env = JSON.parse(str);
    var key = await aesKey(S.code);
    var plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64dec(env.iv) }, key, b64dec(env.ct)));
    if (env.z) plain = await gunzip(plain);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /* ======================================================================
     クラウド（Firestore）とのやり取り　※ふつうの fetch だけ
     ====================================================================== */
  async function idToken() {
    var a = lsGet(K_AUTH, null);
    if (a && a.idToken && a.exp - 60000 > now()) return a.idToken;

    var res, j;
    if (a && a.refreshToken) {                       // 期限切れ → 更新
      res = await fetch('https://securetoken.googleapis.com/v1/token?key=' + CFG.apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(a.refreshToken)
      });
      if (res.ok) {
        j = await res.json();
        var t1 = { idToken: j.id_token, refreshToken: j.refresh_token, exp: now() + Number(j.expires_in) * 1000 };
        lsSet(K_AUTH, t1);
        return t1.idToken;
      }
    }
    // 匿名でログイン（メールもパスワードも使わない）
    res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + CFG.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true })
    });
    if (!res.ok) throw new Error('login:' + res.status + ':' + (await res.text()).slice(0, 200));
    j = await res.json();
    var t2 = { idToken: j.idToken, refreshToken: j.refreshToken, exp: now() + Number(j.expiresIn) * 1000 };
    lsSet(K_AUTH, t2);
    return t2.idToken;
  }

  function docUrl(part) {
    return 'https://firestore.googleapis.com/v1/projects/' + CFG.projectId +
           '/databases/(default)/documents/airtec/' + S.vault + '_' + part;
  }
  /** クラウドから読む。無ければ null */
  async function docGet(part) {
    var res = await fetch(docUrl(part), { headers: { Authorization: 'Bearer ' + (await idToken()) } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('get:' + res.status + ':' + (await res.text()).slice(0, 200));
    var j = await res.json();
    var f = j.fields || {};
    return { blob: f.blob ? f.blob.stringValue : '', at: f.at ? Number(f.at.integerValue) : 0 };
  }
  /** クラウドから消す。もう無ければそれでよし */
  async function docDel(part) {
    var res = await fetch(docUrl(part), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + (await idToken()) }
    });
    if (!res.ok && res.status !== 404) throw new Error('del:' + res.status);
  }
  /** クラウドに書く（無ければ作られる） */
  async function docPut(part, blob, at) {
    if (blob.length > MAX_BLOB) throw new Error('too-big');
    var res = await fetch(docUrl(part), {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + (await idToken()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { blob: { stringValue: blob }, at: { integerValue: String(at) } } })
    });
    if (!res.ok) throw new Error('put:' + res.status + ':' + (await res.text()).slice(0, 200));
  }

  /* ======================================================================
     変更の見つけかた（1件ごとの更新時刻をこちらで付ける）
     ----------------------------------------------------------------------
     見積などのデータ自体には手を入れたくないので、
     「前回の中身」を覚えておいて、変わった件だけ時刻を打ち直す。
     ====================================================================== */
  function listOf(name) {
    var d = null;
    LISTS.forEach(function (l) { if (l.name === name) d = l; });
    return d;
  }
  function readList(name) {
    var v = lsGet(listOf(name).key, []);
    return Array.isArray(v) ? v : [];
  }

  /** ローカルの変更を見て、stamps と tomb を最新にする */
  function scanLocal(t) {
    t = t || now();
    var touched = false;
    LISTS.forEach(function (l) {
      var arr = readList(l.name);
      var shadow = S.shadow[l.name] || {};
      var next = {};
      arr.forEach(function (it) {
        if (!it || !it.id) return;
        var h = strHash(JSON.stringify(it));
        next[it.id] = h;
        if (shadow[it.id] !== h) {                 // 新しい or 直した
          S.stamps[l.name][it.id] = t;
          delete S.tomb[l.name][it.id];
          touched = true;
        }
      });
      Object.keys(shadow).forEach(function (id) {  // 消えた
        if (!next[id]) {
          S.tomb[l.name][id] = t;
          delete S.stamps[l.name][id];
          touched = true;
        }
      });
      S.shadow[l.name] = next;
    });
    return touched;
  }

  /** 古い墓標を捨てる（増えつづけないように） */
  function pruneTombs() {
    var limit = now() - TOMB_DAYS * 86400000;
    LISTS.forEach(function (l) {
      Object.keys(S.tomb[l.name]).forEach(function (id) {
        if (S.tomb[l.name][id] < limit) delete S.tomb[l.name][id];
      });
    });
  }

  /* ======================================================================
     合体（マージ）
     ====================================================================== */
  function mergeList(name, remote) {
    var local = readList(name);
    var lStamp = S.stamps[name] || {};
    var rStamp = (remote && remote.stamps && remote.stamps[name]) || {};
    var lTomb  = S.tomb[name] || {};
    var rTomb  = (remote && remote.tomb && remote.tomb[name]) || {};
    var rItems = (remote && remote.data && remote.data[name]) || [];

    var byId = {}, order = [];
    function put(it, from) {
      if (!it || !it.id) return;
      if (!byId[it.id]) order.push(it.id);
      byId[it.id] = byId[it.id] || {};
      byId[it.id][from] = it;
    }
    local.forEach(function (it) { put(it, 'l'); });
    rItems.forEach(function (it) { put(it, 'r'); });

    var out = [], stamps = {}, tomb = {};
    Object.keys(lTomb).forEach(function (id) { tomb[id] = lTomb[id]; });
    Object.keys(rTomb).forEach(function (id) {
      if (!tomb[id] || rTomb[id] > tomb[id]) tomb[id] = rTomb[id];
    });

    /* 並び順は id 順に固定する。
       端末ごとに順番が違うと「相手と違う」と判断して送り合いが止まらなくなるため。
       画面に出すときは、アプリ側が日付などで並べ直すので見た目には影響しない。 */
    order.sort();

    order.forEach(function (id) {
      var pair = byId[id];
      var ls = lStamp[id] || 0, rs = rStamp[id] || 0;
      var pick, stamp;
      if (pair.l && pair.r) { pick = (rs > ls) ? pair.r : pair.l; stamp = Math.max(ls, rs); }
      else if (pair.l)      { pick = pair.l; stamp = ls; }
      else                  { pick = pair.r; stamp = rs; }
      if (tomb[id] && tomb[id] >= stamp) return;        // 消されたほうが新しい → 出さない
      out.push(pick);
      stamps[id] = stamp || 0;
    });

    /* クラウド側が「合体後」と同じかどうか。違うなら送り直す必要がある。
       （2台がほぼ同時に書くと、片方の書き込みがもう片方を上書きしてしまう。
         そのとき、こちらが持っている分をもう一度送らないと消えたままになる） */
    var remoteSame = sameList(rItems, out) && sameMap(rStamp, stamps) && sameMap(rTomb, tomb);

    return { items: out, stamps: stamps, tomb: tomb, remoteSame: remoteSame };
  }

  function sameList(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function sameMap(a, b) {
    a = a || {}; b = b || {};
    var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i] || a[ka[i]] !== b[ka[i]]) return false;
    }
    return true;
  }

  /* ======================================================================
     同期の本体
     ====================================================================== */
  var busy = false, pushTimer = null, pushMaster = false, lastErr = '';
  /* 写真の不調は別に持つ。見積や現場は通っているのに
     「つながりません」と出ると、直すべき場所を見誤る */
  var photoErr = '';
  var pendingReload = false;

  function markChanged(key) {
    if (!S || !S.on) return;
    if (key === KEY_PB || key === KEY_MDL) {
      S.masterAt = now();
      pushMaster = true;
      saveState();
      schedule(PUSH_WAIT_MASTER);
    } else {
      schedule(PUSH_WAIT_WORK);
    }
  }
  function schedule(ms) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { syncNow(); }, ms);
  }

  /* ======================================================================
     現場写真の同期
     ----------------------------------------------------------------------
     置きかた
       <置き場所>_plist   … 何が在るかの一覧（覚え書き・時刻・消した印）。小さい
       <置き場所>_p_<id>  … 写真そのもの1枚。1件1枚ずつ

     写真そのものは app.js の中（IndexedDB）にあって、ここからは触れない。
     window.AirtecPhotos を通して受け渡す。暗号にするのはここの仕事。

     1周でやること
       ① この端末で増えた・直した・消したを見つける
       ② 一覧をもらって突き合わせる（新しいほうが勝つ）
       ③ 消えたものをこの端末からも消す
       ④ 足りないものをもらう
       ⑤ まだ預けていないものを預ける
       ⑥ 一覧を書き戻す
     ④⑤は枚数を区切る。残っていれば「まだある」と返して、すぐ次の周を回す。
     ====================================================================== */
  /** 写真の中身が入れ替わったかを見分ける印（回転すると変わる） */
  function phMark(m) { return (m.w || 0) + 'x' + (m.h || 0) + ':' + (m.size || 0); }

  function prunePhTombs() {
    var limit = now() - TOMB_DAYS * 86400000;
    Object.keys(S.ph.tomb).forEach(function (id) {
      if (S.ph.tomb[id] < limit) {
        delete S.ph.tomb[id];
        delete S.ph.up[id];
        delete S.ph.big[id];
      }
    });
  }

  /** 1周ぶんの写真の同期。まだ残っていれば true を返す */
  async function syncPhotos(t) {
    var api = window.AirtecPhotos;
    if (!api) return false;

    var localList = await api.list();
    var localById = {};
    localList.forEach(function (p) { localById[p.id] = p; });

    /* ① この端末での増減 */
    var touched = false;
    Object.keys(localById).forEach(function (id) {
      var h = strHash(JSON.stringify(localById[id]));
      if (S.ph.shadow[id] !== h) {
        S.ph.stamps[id] = t;
        delete S.ph.tomb[id];
        touched = true;
      }
    });
    Object.keys(S.ph.shadow).forEach(function (id) {
      if (!localById[id]) {
        S.ph.tomb[id] = t;
        delete S.ph.stamps[id];
        delete S.ph.big[id];
        // up はわざと残す。「クラウドにも1枚ある」という覚えで、
        // これを頼りに下で本体を片付ける（消したら up も消える）
        touched = true;
      }
    });

    /* ② クラウドの一覧 */
    var doc = await docGet('plist');
    var remote = (doc && doc.blob) ? await unseal(doc.blob) : null;
    var rMeta  = (remote && remote.meta)   || {};
    var rStamp = (remote && remote.stamps) || {};
    var rTomb  = (remote && remote.tomb)   || {};

    var ids = {};
    [localById, rMeta, S.ph.stamps, S.ph.tomb, rStamp, rTomb].forEach(function (o) {
      Object.keys(o).forEach(function (id) { ids[id] = 1; });
    });

    var meta = {}, stamps = {}, tomb = {};
    var want = [], drop = [], fix = [];
    Object.keys(ids).forEach(function (id) {
      var lS = S.ph.stamps[id] || 0, lT = S.ph.tomb[id] || 0;
      var rS = rStamp[id] || 0,      rT = rTomb[id] || 0;
      var st = Math.max(lS, rS), tb = Math.max(lT, rT);

      if (tb && tb >= st) {                       // 消えている
        tomb[id] = tb;
        if (localById[id]) drop.push(id);
        return;
      }
      if (!st) return;                            // どちらにも印が無い＝知らない
      stamps[id] = st;

      var useRemote = (rS > lS) && rMeta[id];
      meta[id] = useRemote ? rMeta[id] : (localById[id] || rMeta[id]);
      if (!meta[id]) { delete stamps[id]; return; }

      if (!localById[id]) {
        want.push(id);                            // この端末に無い → もらう
      } else if (useRemote) {
        // 相手のほうが新しい。写真そのものが入れ替わっている（回した）なら
        // もらい直す。覚え書きだけの違いなら、その文字だけ入れ替える
        if (phMark(rMeta[id]) !== phMark(localById[id])) want.push(id);
        else fix.push(id);
      }
    });

    var changed = false;

    /* ③ 消えたもの */
    for (var a = 0; a < drop.length; a++) {
      await api.del(drop[a]);
      changed = true;          // up はそのまま。クラウド側の本体は下で片付ける
    }

    /* 覚え書き・種類だけ直されたもの */
    for (var b = 0; b < fix.length; b++) {
      await api.setMeta(fix[b], meta[fix[b]]);
      changed = true;
    }

    /* ④ 足りないものをもらう */
    var pending = 0, got = {};
    for (var i = 0; i < want.length; i++) {
      if (i >= PH_DOWN_PER_ROUND) { pending += want.length - i; break; }
      var id2 = want[i];
      var d2 = await docGet('p_' + id2);
      if (!d2 || !d2.blob) {                      // 一覧にはあるが本体がまだ無い
        delete stamps[id2]; delete meta[id2];
        continue;
      }
      var body = await unseal(d2.blob);
      var m2 = meta[id2];
      await api.put({
        id: id2, siteId: m2.siteId, kind: m2.kind, memo: m2.memo,
        at: m2.at, w: m2.w, h: m2.h, data: body.data
      });
      S.ph.up[id2] = phMark(m2);                  // もらった＝すでに預かってある
      got[id2] = 1;
      changed = true;
    }

    /* ⑤ まだ預けていないものを預ける */
    var mine = Object.keys(meta).filter(function (id) {
      if (got[id]) return false;                  // いまもらったばかり。送り返さない
      if (!localById[id] || S.ph.big[id]) return false;
      return S.ph.up[id] !== phMark(localById[id]);
    });
    var uploaded = 0;
    for (var j = 0; j < mine.length; j++) {
      if (j >= PH_UP_PER_ROUND) { pending += mine.length - j; break; }
      var id3 = mine[j];
      var full = await api.get(id3);
      if (!full) continue;
      var blob3 = await seal({ v: 1, data: full.data });
      if (blob3.length > MAX_BLOB) {
        // 大きすぎる → もう一段小さくして、もう一度だけ試す
        if (await api.reshrink(id3)) {
          full = await api.get(id3);
          blob3 = full ? await seal({ v: 1, data: full.data }) : blob3;
        }
        if (!full || blob3.length > MAX_BLOB) { S.ph.big[id3] = 1; continue; }
        meta[id3] = { id: id3, siteId: full.siteId, kind: full.kind, memo: full.memo,
                      at: full.at, w: full.w, h: full.h, size: full.size };
        changed = true;                           // 画面の枚数表示を直すため
      }
      await docPut('p_' + id3, blob3, t);
      S.ph.up[id3] = phMark(full);      // いま預けた中身そのものの印を控える
      uploaded++;
    }

    /* 消した写真の本体を、クラウドからも片付ける。
       一覧から消えるだけでは置き場所（1GBまで）を食いつぶしてしまう。
       預けたことを覚えている端末が片付ける。すでに無ければ何も起きない。 */
    var swept = 0;
    var junk = Object.keys(tomb).filter(function (id) { return S.ph.up[id]; });
    for (var c = 0; c < junk.length && c < PH_UP_PER_ROUND; c++) {
      try { await docDel('p_' + junk[c]); } catch (e3) { /* 次の周でまた試す */ continue; }
      delete S.ph.up[junk[c]];
      swept++;
    }
    if (junk.length > swept) pending += junk.length - swept;

    /* ⑥ 一覧を書き戻す */
    if (touched || uploaded || drop.length || fix.length || !doc ||
        !sameMap(stamps, rStamp) || !sameMap(tomb, rTomb)) {
      await docPut('plist', await seal({ v: 1, meta: meta, stamps: stamps, tomb: tomb }), t);
    }

    /* 覚え書きを取り直す（もらった・消したぶんを織り込む） */
    var shadow = {};
    (await api.list()).forEach(function (p) { shadow[p.id] = strHash(JSON.stringify(p)); });
    S.ph.shadow = shadow;
    S.ph.stamps = stamps;
    S.ph.tomb   = tomb;
    prunePhTombs();

    S.ph.count = Object.keys(meta).length;
    S.ph.bytes = Object.keys(meta).reduce(function (a2, id) {
      return a2 + Number((meta[id] && meta[id].size) || 0);
    }, 0);

    if (changed && api.refresh) api.refresh();
    return pending > 0;
  }

  async function pushWork(t) {
    var payload = { v: 1, data: {}, stamps: {}, tomb: {} };
    LISTS.forEach(function (l) {
      payload.data[l.name]   = readList(l.name);
      payload.stamps[l.name] = S.stamps[l.name];
      payload.tomb[l.name]   = S.tomb[l.name];
    });
    await docPut('work', await seal(payload), t);
  }

  /** 1周ぶんの同期。取り込み → 送り出し */
  async function syncNow(opts) {
    opts = opts || {};
    if (!READY || !S || !S.on || busy) return false;
    if (!navigator.onLine) return false;
    busy = true;
    var changed = false;
    try {
      /* ---- 小さいデータ（現場・見積・請求書） ---- */
      var t = now();
      var localTouched = scanLocal(t);
      pruneTombs();

      var remoteDoc = await docGet('work');
      var remote = null;
      if (remoteDoc && remoteDoc.blob) remote = await unseal(remoteDoc.blob);

      var needPush = localTouched || !remoteDoc || opts.force;
      LISTS.forEach(function (l) {
        var m = mergeList(l.name, remote);
        var cur = readList(l.name);
        S.stamps[l.name] = m.stamps;
        S.tomb[l.name]   = m.tomb;
        if (!sameList(cur, m.items)) {
          lsSet(l.key, m.items);
          var sh = {};
          m.items.forEach(function (it) { sh[it.id] = strHash(JSON.stringify(it)); });
          S.shadow[l.name] = sh;
          changed = true;                       // 相手の変更が入った
        }
        if (!m.remoteSame) needPush = true;     // クラウド側に足りない分がある
      });
      if (needPush) await pushWork(t);

      /* ---- 大きいデータ（単価マスタ・機種データ） ---- */
      var mDoc = await docGet('master');
      if (mDoc && mDoc.at > S.remoteMasterAt && mDoc.at > S.masterAt) {
        var m2 = await unseal(mDoc.blob);       // 相手のほうが新しい → もらう
        if (m2.pricebook) lsSet(KEY_PB, m2.pricebook);
        if (m2.models) lsSet(KEY_MDL, m2.models); else localStorage.removeItem(KEY_MDL);
        S.remoteMasterAt = mDoc.at;
        S.masterAt = mDoc.at;
        changed = true;
      } else if (pushMaster || !mDoc || (opts.force && S.masterAt > mDoc.at)) {
        var at = Math.max(S.masterAt, (mDoc ? mDoc.at : 0) + 1);
        await docPut('master', await seal({
          v: 1, pricebook: lsGet(KEY_PB, null), models: lsGet(KEY_MDL, null)
        }), at);
        S.masterAt = at;
        S.remoteMasterAt = at;
        pushMaster = false;
      }

      /* ---- 現場写真（1枚ずつ） ----
         写真は数が多いので1周ぶんずつ動かす。まだ残っていたら、
         45秒待たずにすぐ次の周を回す。 */
      var phMore = false, phErr = '';
      try { phMore = await syncPhotos(t); }
      catch (e2) { phErr = String(e2 && e2.message || e2); }

      S.lastSync = now();
      lastErr = '';             // 現場・見積・単価マスタはここまでで通っている
      photoErr = phErr;         // 写真だけの不調は、写真の行に出す
      saveState();
      if (changed) onRemoteChange();
      render();
      if (phMore) schedule(PH_SOON_MS);
      return true;
    } catch (e) {
      lastErr = String(e && e.message || e);
      return false;
    } finally {
      /* 表示を直すのは必ず最後。busy を下ろす前に描くと
         「同期中…」のまま止まって見えてしまう */
      busy = false;
      render();
    }
  }

  /* ---- 相手の変更が入ったときの見せ方 ----
     画面が持っている情報と食い違うので、読み込み直すのがいちばん安全。
     入力の途中かもしれないので、編集画面にいるときは声をかけるだけにする。 */
  function onRemoteChange() {
    var editing = document.querySelector('#view-edit.is-active') ||
                  document.querySelector('#view-master.is-active');
    if (!editing) { location.reload(); return; }
    pendingReload = true;
    var bar = document.getElementById('sync-warn');
    if (bar) bar.style.display = '';
  }

  /* ======================================================================
     画面まわり
     ====================================================================== */
  function fmtTime(ms) {
    if (!ms) return 'まだ';
    var d = new Date(ms), p = function (n) { return ('0' + n).slice(-2); };
    var today = new Date();
    var same = d.toDateString() === today.toDateString();
    return (same ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function $(id) { return document.getElementById(id); }

  function render() {
    var st = $('sync-state'); if (!st) return;
    var on = !!(S && S.on);
    if (!READY) {
      st.textContent = '準備中（クラウドの設定がまだ）';
      st.className = 'sync-badge is-off';
    } else if (!on) {
      st.textContent = '連動していません';
      st.className = 'sync-badge is-off';
    } else if (lastErr) {
      st.textContent = 'つながりません';
      st.className = 'sync-badge is-err';
    } else {
      st.textContent = busy ? '同期中…' : '連動中';
      st.className = 'sync-badge is-on';
    }
    $('sync-last').textContent = S ? fmtTime(S.lastSync) : 'まだ';
    $('sync-err').textContent = lastErr ? ('（' + errText(lastErr) + '）') : '';

    /* 写真は預けられる量に上限（1GB）がある。近づいたら分かるように数を出す */
    var ph = $('sync-photos');
    if (ph) {
      if (!on) ph.textContent = '—';
      else if (photoErr) ph.textContent = '預けられません（' + errText(photoErr) + '）';
      else if (!S.ph || !S.ph.count) ph.textContent = '0枚';
      else {
        var mb = S.ph.bytes / 1048576;
        var size = mb < 1 ? Math.round(S.ph.bytes / 1024) + 'KB'
                 : (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + 'MB';
        ph.textContent = S.ph.count + '枚（' + size + ' / 1,000MBまで）';
      }
      ph.className = photoErr ? 'sync-err' : '';
    }
    $('sync-off-btns').style.display = on ? 'none' : '';
    $('sync-on-btns').style.display  = on ? '' : 'none';
    $('sync-code-view').textContent  = on ? fmtCode(S.code) : '';
  }
  function errText(e) {
    if (/too-big/.test(e))      return '単価マスタが大きすぎます。手動バックアップをお使いください';
    if (/^put:40[13]/.test(e))  return 'クラウド側の許可設定（ルール）を見直してください。写真を足したときは貼り直しが必要です';
    if (/^get:40[13]/.test(e)) return 'クラウド側の許可設定を見直してください';
    if (/login:/.test(e))       return 'ログインできません。設定を見直してください';
    if (/OperationError|decrypt/i.test(e)) return 'あいことばが違うようです';
    return e.slice(0, 60);
  }

  function toast(msg) {
    var t = $('toast');
    if (!t) { alert(msg); return; }
    t.textContent = msg;
    t.classList.add('is-show');
    setTimeout(function () { t.classList.remove('is-show'); }, 2600);
  }

  async function startNew() {
    if (!READY) { alert('クラウドの設定（firebase-config.js）がまだです。'); return; }
    var code = makeCode();
    S.code = code;
    S.vault = await vaultIdOf(code);
    S.on = true;
    S.masterAt = now();
    pushMaster = true;
    saveState();
    var okc = await syncNow({ force: true });
    if (!okc) { S.on = false; saveState(); render(); alert('つながりませんでした：\n' + errText(lastErr)); return; }
    render();
    showCode('この端末のデータをクラウドに預けました。\nもう一方の端末で「あいことばを入れる」を押して、下のあいことばを入力してください。');
  }

  function showCode(msg) {
    var box = $('sync-code-box');
    if (!box) return;
    $('sync-code-msg').textContent = msg || '';
    $('sync-code-big').textContent = fmtCode(S.code);
    box.style.display = '';
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function joinExisting() {
    if (!READY) { alert('クラウドの設定（firebase-config.js）がまだです。'); return; }
    var input = prompt('もう一方の端末に出ている「あいことば」を入力してください。\n（小文字・ハイフンなしでも大丈夫です）');
    if (!input) return;
    var code = normCode(input);
    if (code.length !== 20) { alert('あいことばは20文字です。もう一度確かめてください。'); return; }

    var hasLocal = LISTS.some(function (l) { return readList(l.name).length > 0; });
    if (hasLocal && !confirm('この端末にもデータがあります。\n\n' +
      '・現場／見積／請求書 … 両方を合体します（同じものは新しいほうが残ります）\n' +
      '・単価マスタ・機種データ … もう一方の端末のものになります\n\n' +
      '進めますか？')) return;

    return joinWith(code);
  }

  async function joinWith(input) {
    var code = normCode(input);
    S.code = code;
    S.vault = await vaultIdOf(code);
    keyCache = null;

    /* 打ち間違い対策：そのあいことばの置き場所が本当にあるか、先に確かめる。
       確かめずに始めると、誰ともつながらない“自分だけの置き場所”が
       静かにできてしまい、あとで「同期されない」と悩むことになる。 */
    var probe = null;
    try { probe = await docGet('work'); }
    catch (e) { lastErr = String(e.message || e); }
    if (!probe) {
      S.code = ''; S.vault = ''; S.on = false; saveState(); render();
      alert(lastErr ? ('つながりませんでした：\n' + errText(lastErr))
                    : 'そのあいことばの預け先が見つかりませんでした。\n打ち間違いがないか確かめてください。');
      lastErr = '';
      return false;
    }
    try { await unseal(probe.blob); }
    catch (e) {
      S.code = ''; S.vault = ''; S.on = false; keyCache = null; saveState(); render();
      alert('あいことばが違うようです。もう一度確かめてください。');
      return false;
    }

    /* 単価マスタは「すでに連動しているほう」を正とする。
       あとから入る端末の古いマスタで上書きしないため。 */
    S.masterAt = 0;
    S.remoteMasterAt = 0;

    S.on = true;
    saveState();
    scanLocal(now());          // 手持ちのデータを「今できたもの」として扱う
    saveState();
    var okj = await syncNow({ force: true });
    if (!okj) {
      S.on = false; S.code = ''; S.vault = ''; saveState(); render();
      alert('つながりませんでした：\n' + errText(lastErr));
      return false;
    }
    toast('連動しました');
    setTimeout(function () { location.reload(); }, 800);
    return true;
  }

  function stopSync() {
    if (!confirm('この端末の連動をやめます。\n\nこの端末のデータは残ります。クラウドに預けた分もそのまま残ります。\nよろしいですか？')) return;
    S.on = false;
    S.code = '';
    S.vault = '';
    keyCache = null;
    photoErr = '';
    saveState();
    localStorage.removeItem(K_AUTH);
    render();
    toast('連動をやめました');
  }

  /* ======================================================================
     組み立て
     ====================================================================== */
  function wire() {
    if (!$('sync-state')) return;
    $('btn-sync-start').addEventListener('click', function () { startNew(); });
    $('btn-sync-join').addEventListener('click', function () { joinExisting(); });
    $('btn-sync-now').addEventListener('click', function () {
      toast('同期しています…');
      syncNow({ force: true }).then(function (ok) { toast(ok ? '同期しました' : '同期できませんでした'); });
    });
    $('btn-sync-show').addEventListener('click', function () { showCode('このあいことばを、もう一方の端末で入力してください。'); });
    $('btn-sync-stop').addEventListener('click', function () { stopSync(); });
    $('btn-sync-copy').addEventListener('click', function () {
      navigator.clipboard.writeText(fmtCode(S.code)).then(function () { toast('コピーしました'); },
        function () { toast('コピーできませんでした'); });
    });
    var warnBtn = $('btn-sync-reload');
    if (warnBtn) warnBtn.addEventListener('click', function () { location.reload(); });

    if (!READY) {
      var note = $('sync-setup-note');
      if (note) note.style.display = '';
    }
    render();
  }

  function boot() {
    loadState();
    wire();
    if (!READY || !S.on) return;

    scanLocal(now());
    saveState();
    syncNow();
    setInterval(function () { if (!document.hidden) syncNow(); }, POLL_MS);
    window.addEventListener('focus', function () { syncNow(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) syncNow(); });
    window.addEventListener('online', function () { syncNow(); });
  }

  /* app.js から「保存したよ」と教えてもらう窓口 */
  window.AirtecSync = {
    changed: function (key) { markChanged(key); },
    isOn: function () { return !!(S && S.on); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
