/* ==========================================================================
   50Airtec 見積作成ツール（社内用）
   - 単価マスタ・保存した見積は、この端末のブラウザ（localStorage）に保存されます
   - 連動（sync.js）を設定した場合だけ、暗号にしてクラウドにも預けます
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 保存キー ---------- */
  /* この画面がいつの版か。index.html の ?v= と同じ数字にしておく。
     配るときは両方を一緒に上げること（片方だけだと、直したものが端末に届かない）。 */
  var APP_VERSION = '202609071430';

  var KEY_PB    = 'airtec_pricebook_v1';
  var KEY_EST   = 'airtec_estimates_v1';
  var KEY_DRAFT = 'airtec_draft_v1';
  var KEY_MDL   = 'airtec_models_v1';
  var KEY_OPT   = 'airtec_options_v1';    // 別売品（どの室内機に付くかの情報つき）
  var KEY_SITE  = 'airtec_sites_v1';
  var KEY_INV   = 'airtec_invoices_v1';
  var KEY_COST  = 'airtec_showcost_v1';   // 原価を画面に出すかどうか（端末ごと）

  /* ---------- 便利関数 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }

  /**
   * 製品ページのURLとして安全なものだけを通す。
   * CSVは外から持ってくるファイルなので、http/https 以外（javascript: など）は捨てる。
   */
  function safeUrl(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) return '';
    return s;
  }

  /**
   * 社判・ロゴの画像。見積書のHTMLに src= として差し込むので、
   * 画像そのものの形（data:image の base64）以外は受け付けない。
   * 外から持ってきたバックアップに細工した文字列が入っていても、ここで落とす。
   * SVGは中に命令を書けてしまうので通さない。
   */
  function safeImage(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    return /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(s) ? s : '';
  }

  /** 取り込んだ自社情報を整える。足りない項目は初期値で埋め、画像は上の判定を通す */
  function adoptCompany(src) {
    var c = Object.assign({}, DEFAULT_PRICEBOOK.company, src || {});
    c.sealImage = safeImage(c.sealImage);
    c.logoImage = safeImage(c.logoImage);
    return c;
  }

  /**
   * 単価表の項目につける文字色。
   * シリーズごとに色を変えて、単価表から選ぶときに見分けやすくするためのもの。
   * CSVは外から持ってくるファイルなので、決めた色の名前と #rrggbb 以外は受け付けない。
   */
  var ITEM_COLORS = {
    '青': '#1565c0', '緑': '#2e7d32', '橙': '#e65100', '赤': '#c62828',
    '紫': '#6a1b9a', '茶': '#5d4037', '水': '#0277bd', '桃': '#ad1457',
    '灰': '#546e7a', '黒': ''
  };
  /**
   * 品名から色を見当てる規則。上から順に見て、最初に当たったものを使う。
   * 手で打った項目にも効くよう、完全一致ではなく品名に含まれる言葉で判断する。
   * 順番が大事：「室外機 天吊り設置」は室外機の据付（紫）であって天吊形（赤）ではない。
   * 「室外機」で始まる行を先に拾っておかないと、あとの機種の形の規則に取られる。
   */
  var COLOR_RULES = [
    [/^室外機/, '紫'],
    [/金具|据付ブロック|防振|立ち下ろし|屋根置き|二段置き|高所|クレーン|ユニック|足場/, '紫'],
    [/取外し|撤去|処分|リサイクル|収集運搬|フロン/, '灰'],
    [/天吊|天井吊/, '赤'],
    [/天カセ|天井カセット|カセット/, '青'],
    [/床置/, '緑'],
    [/壁掛/, '橙'],
    [/ビルトイン|天井埋込|ダクト形/, '桃'],
    [/冷媒配管|ドレン|配管|化粧カバー/, '水'],
    [/電源|コンセント|電圧|ブレーカー/, '桃'],
    [/穴|貫通|開口|点検口|下地|補修/, '茶'],
    [/標準取付|入替|移設/, '緑']
  ];

  /** その品名なら何色か。当てはまらなければ空（色なし） */
  function autoColorFor(name) {
    var s = String(name || '');
    for (var i = 0; i < COLOR_RULES.length; i++) {
      if (COLOR_RULES[i][0].test(s)) return COLOR_RULES[i][1];
    }
    return '';
  }

  /**
   * まだ色のついていない項目に、規則で色をつける。
   * すでに色を決めてある項目には触らない。
   */
  function autoColorAll() {
    var n = 0;
    pb.categories.forEach(function (c) {
      c.items.forEach(function (it) {
        if (it.color) return;
        var col = autoColorFor(it.name);
        if (col) { it.color = col; n++; }
      });
    });
    return n;
  }

  function itemColor(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (ITEM_COLORS.hasOwnProperty(s)) return ITEM_COLORS[s];
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    return '';
  }

  /** 製品ページを新しいタブで開く小さなボタン。URLが無いときは null を返す */
  function refButton(url, label) {
    var u = safeUrl(url);
    if (!u) return null;
    var b = el('button', 'icon-btn icon-ref', '🔍');
    b.type = 'button';
    b.title = (label ? label + 'の' : '') + '製品ページを見る\n' + u;
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      window.open(u, '_blank', 'noopener,noreferrer');
    });
    return b;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function todayISO() {
    var d = new Date(), p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function jpDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    if (p.length !== 3) return iso;
    return p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日';
  }
  function addDays(iso, days) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return '';
    d.setDate(d.getDate() + Number(days || 0));
    var p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      syncTouch(key);
      return true;
    }
    catch (e) { toast('保存できませんでした（ブラウザの容量不足かもしれません）'); return false; }
  }
  /** 保存キーをまるごと消す（消したことも連動先に伝える） */
  function removeKey(key) {
    localStorage.removeItem(key);
    syncTouch(key);
  }
  /** 連動（sync.js）に「ここが変わった」と知らせる。連動していなければ何も起きない */
  function syncTouch(key) {
    if (key === KEY_DRAFT) return;                 // 下書きは端末ごとのものなので送らない
    if (window.AirtecSync) window.AirtecSync.changed(key);
  }
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-show'); }, 2200);
  }
  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ======================================================================
     単価マスタ
     ====================================================================== */
  var pb = load(KEY_PB, null) || clone(DEFAULT_PRICEBOOK);
  // 古い保存データに新しい項目が無い場合の補完
  pb.company  = adoptCompany(pb.company);
  pb.defaults = Object.assign({}, DEFAULT_PRICEBOOK.defaults, pb.defaults || {});
  if (!Array.isArray(pb.categories)) pb.categories = clone(DEFAULT_PRICEBOOK.categories);
  ensureCostRates();
  migratePB();

  /** 掛率の表は、初期値の配列をそのまま使うと、直したときに初期値まで書き換わる。必ず自分のものにする */
  function ensureCostRates() {
    pb.defaults.costRates = Array.isArray(pb.defaults.costRates) ? pb.defaults.costRates.slice() : [];
  }

  function savePB() { return save(KEY_PB, pb); }

  /**
   * 前に使っていた単価マスタを、いまのツールの決まりごとに合わせる。
   * 端末のブラウザに保存してある単価は消さず、足りない印と項目だけを足す。
   */
  function migratePB() {
    migrateTo8();
    migrateTo9();
    migrateTo10();
    migrateTo11();
    migrateTo12();
  }

  /** 分類に、その品名＋規格の項目が無ければ足す。すでにある行の金額には触らない */
  function addItemIfMissing(catId, item) {
    var cat = null;
    pb.categories.forEach(function (c) { if (c.id === catId) cat = c; });
    if (!cat || !Array.isArray(cat.items)) return false;
    var exists = false;
    cat.items.forEach(function (it) {
      if (it.name === item.name && (it.spec || '') === (item.spec || '')) exists = true;
    });
    if (exists) return false;
    cat.items.push(clone(item));
    return true;
  }

  /**
   * 2026-09-02 以降に足した項目を、すでに使っている単価マスタにも届ける。
   * 足りない行を入れるだけで、書き換えてある金額には一切触らない。
   */
  function migrateTo9() {
    if (num(pb.version) >= 9) return;
    var added = 0;
    if (addItemIfMissing('biz', {
      name: 'オートグリル 組み込み', spec: '',
      unit: '台', price: 20000, color: '青'
    })) added++;
    pb.version = 9;
    save(KEY_PB, pb);
    if (added) console.log('単価マスタに ' + added + ' 項目を足しました');
  }

  /**
   * 版9で入れた「オートグリル 組み込み」に規格を書いてしまっていたので、空に戻す。
   * 天カセだけでなく天吊形にも付くため、形を決め打ちにしない。
   * 自分で規格を書き足した行は、そのまま残す。
   */
  function migrateTo10() {
    if (num(pb.version) >= 10) return;
    pb.categories.forEach(function (c) {
      (c.items || []).forEach(function (it) {
        if (it.name === 'オートグリル 組み込み' && it.spec === '天カセ4方向 昇降パネル') it.spec = '';
      });
    });
    pb.version = 10;
    save(KEY_PB, pb);
  }

  /**
   * 単価マスタの並びを、現場の段取りの順にそろえる（2026-09-02）。
   * 初期値の並びを手本にして、同じ品名・規格の行をその順に置き直すだけ。
   * 金額も規格も色も触らない。自分で足した項目は、順番を保ったまま分類の最後に残す。
   */
  /**
   * 2026-09-06。2つのことをする。
   *
   * 1. 初期値のまま使っている行に「目安」の印をつける。
   *    空調王が最初から入れている金額を、自社の相場だと思い込ませないため。
   *    金額を直してある行にはつけない（＝もうその人の金額なので）。
   *
   * 2. 標準取付工事に入っていた 0.1人工 を外す。
   *    0.1人工＝1人が48分。標準取付が48分で終わるはずがなく、入れ間違い。
   *    金額はいまのまま残して、打てる状態にするだけにする。
   *    勝手に金額を上げると、出したばかりの見積と食い違う。
   */
  function migrateTo12() {
    if (num(pb.version) >= 12) return;

    var defBy = {};
    DEFAULT_PRICEBOOK.categories.forEach(function (dc) {
      (dc.items || []).forEach(function (di) {
        defBy[dc.id + '｜' + di.name + '｜' + (di.spec || '')] = di;
      });
    });

    pb.categories.forEach(function (c) {
      (c.items || []).forEach(function (it) {
        var di = defBy[c.id + '｜' + it.name + '｜' + (it.spec || '')];

        // 1. 金額が初期値のままなら「目安」
        if (di && di.est && num(it.price) === num(di.price)) it.est = 1;

        /* 2. 入れ間違いの人工を外す。金額はいまのまま残す。
              ただし、その金額は人工の掛け算で出ただけで、
              本人が決めた額ではない。だから「目安」の札は付ける */
        if (it.name === '標準取付工事' && num(it.manDay) && num(it.manDay) < 0.25) {
          delete it.manDay;
          it.est = 1;
        }
      });
    });

    pb.version = 12;
    savePB();
  }

  function migrateTo11() {
    if (num(pb.version) >= 11) return;

    DEFAULT_PRICEBOOK.categories.forEach(function (dc) {
      var cat = null;
      pb.categories.forEach(function (c) { if (c.id === dc.id) cat = c; });
      if (!cat || !Array.isArray(cat.items)) return;

      var key = function (it) { return it.name + '｜' + (it.spec || ''); };
      var rest = cat.items.slice();      // まだ置いていない行
      var sorted = [];

      // 手本の順に、同じ品名・規格の行を拾っていく
      (dc.items || []).forEach(function (di) {
        for (var i = 0; i < rest.length; i++) {
          if (key(rest[i]) === key(di)) { sorted.push(rest.splice(i, 1)[0]); return; }
        }
      });
      // 手本に無い行（自分で足したもの）は、元の順のまま後ろに付ける
      cat.items = sorted.concat(rest);
    });

    pb.version = 11;
    save(KEY_PB, pb);
  }

  function migrateTo8() {
    if (num(pb.version) >= 8) return;

    DEFAULT_PRICEBOOK.categories.forEach(function (dc) {
      pb.categories.forEach(function (c) {
        if (c.id !== dc.id) return;
        // どの分類を「作業費」として数えるかの印
        if (dc.work && !c.work) c.work = true;
        // 自動で単価が決まる項目（消耗品雑費・諸経費など）。
        // 同じ品名がすでにあればその行を自動計算に変え、無ければ足す。
        (dc.items || []).forEach(function (di) {
          if (!di.autoPercent) return;
          var found = null;
          c.items.forEach(function (it) { if (it.name === di.name) found = it; });
          if (found) {
            if (!found.autoPercent) {
              found.autoPercent = di.autoPercent;
              found.autoBase = di.autoBase;
              found.price = 0;
            }
          } else {
            c.items.push(clone(di));
          }
        });

        // 色分けの初期設定を配る。すでに色を付けてある行はそのまま残す。
        (dc.items || []).forEach(function (di) {
          if (!di.color) return;
          c.items.forEach(function (it) {
            if (it.color) return;
            if (it.name === di.name && (it.spec || '') === (di.spec || '')) it.color = di.color;
          });
        });
      });
    });

    // 手で足した項目にも色がつくよう、品名の規則でも配る
    autoColorAll();

    pb.version = 8;
    save(KEY_PB, pb);
  }

  /* ======================================================================
     見積データ（state）
     ====================================================================== */
  function newState() {
    return {
      id: 'e' + Date.now(),
      no: nextNo(),
      date: todayISO(),
      customer: '',
      honorific: '御中',
      subject: '',
      site: '',
      validDays: pb.defaults.validDays,
      delivery: pb.defaults.deliveryTerms,
      payment: pb.defaults.paymentTerms,
      overhead: pb.defaults.overheadPercent,
      unitRound: pb.defaults.unitRoundYen,
      manDayYen: pb.defaults.manDayYen,
      discount: 0,
      tax: pb.defaults.taxRatePercent,
      rounding: 'floor',
      note: pb.defaults.footerNote,
      lines: []
    };
  }

  function nextNo() {
    var d = todayISO().replace(/-/g, '');
    var list = load(KEY_EST, []);
    var n = 1;
    list.forEach(function (e) {
      var m = String(e.no || '').match(new RegExp('^' + d + '-(\\d+)$'));
      if (m) n = Math.max(n, Number(m[1]) + 1);
    });
    return d + '-' + ('0' + n).slice(-2);
  }

  var st = load(KEY_DRAFT, null) || newState();
  if (st.unitRound == null) st.unitRound = 0;   // この設定より前に作った見積
  if (st.manDayYen == null) st.manDayYen = num(pb.defaults.manDayYen);
  applyManDayToMaster();   // 1人工の金額を変えたあとに開き直したときのため

  /* ======================================================================
     計算
     ====================================================================== */
  function calc() { return calcOf(st); }

  /* ----------------------------------------------------------------------
     単価が自動で決まる行（消耗品雑費・諸経費）の計算。

     作業費＝家庭用・業務用・移設のように work: true をつけた分類から入れた行。
     機器本体・材料（因幡などのCSV）・その他値引きは作業費に数えない。

       作業費の合計         ×  5%  →  消耗品雑費
       作業費＋消耗品雑費   × 15%  →  諸経費

     という順番なので、'work' の行を先に計算してから 'work+auto' の行を計算する。
     ---------------------------------------------------------------------- */

  // 何の合計をもとにするか。画面に出す呼び名も一緒に持たせる
  var AUTO_BASES = {
    'work':      { name: '作業費', short: '作業費' },
    'work+auto': { name: '作業費＋消耗品雑費', short: '作業費＋雑費' }
  };

  /** その項目（または行）が、何の合計をもとにするか */
  function autoBaseOf(x) {
    return (x && AUTO_BASES[x.autoBase]) ? x.autoBase : 'work';
  }

  /** 「作業費の5%」のような、割合の呼び名 */
  function autoLabel(x) {
    return AUTO_BASES[autoBaseOf(x)].name + 'の' + num(x.autoPercent) + '%';
  }

  /**
   * 単価マスタから同じ品名の項目を探す。
   * 明細の「仕様」は［品番　規格］をつなげたものなので、同じ形にして見比べる。
   */
  function findMasterItem(name, spec) {
    var nm = String(name || '').trim();
    if (!nm) return null;
    var loose = null;
    for (var i = 0; i < pb.categories.length; i++) {
      var c = pb.categories[i];
      for (var j = 0; j < c.items.length; j++) {
        var it = c.items[j];
        if (String(it.name || '').trim() !== nm) continue;
        var full = [it.code || '', it.spec || ''].filter(Boolean).join('　');
        if (full === String(spec || '').trim()) return { cat: c, item: it };
        if (!loose) loose = { cat: c, item: it };   // 品名だけ合う候補は控えにしておく
      }
    }
    return loose;
  }

  /**
   * この機能をつける前に作った見積の行は、どの分類から入れたかを持っていない。
   * そのままだと作業費が0円になってしまうので、単価マスタと品名を突き合わせて補う。
   */
  function backfillLineCats(doc) {
    ((doc || {}).lines || []).forEach(function (l) {
      if (l.cat || num(l.autoPercent)) return;
      var hit = findMasterItem(l.name, l.spec);
      if (!hit) return;
      l.cat = hit.cat.id;
      // 単価0の「消耗品雑費」「諸経費」は、自動計算の行に切り替える
      if (num(l.price) === 0 && num(hit.item.autoPercent)) {
        l.autoPercent = num(hit.item.autoPercent);
        l.autoBase = hit.item.autoBase || 'work';
      }
    });
  }

  /**
   * その行が「作業費」かどうか。
   * ふだんは入れたときの分類で決まるが、行の「工」ボタンで手動で決めることもできる。
   */
  function isWorkLine(l) {
    if (!l || num(l.autoPercent)) return false;   // 自動計算の行どうしは数えない
    if (l.work === true) return true;             // 手で「数える」にした行
    if (l.work === false) return false;           // 手で「数えない」にした行
    var work = false;
    pb.categories.forEach(function (c) { if (c.id === l.cat && c.work) work = true; });
    return work;
  }

  /** 自動計算の行のもとになる合計（base ごと） */
  function autoBaseTotal(doc, base) {
    var lines = ((doc || {}).lines || []);
    var sum = 0;
    lines.forEach(function (l) {
      if (isWorkLine(l)) sum += lineAmount(l, (doc || {}).unitRound);
    });
    if (base === 'work+auto') {
      // 諸経費は、先に決まった消耗品雑費も含めた金額に掛ける
      lines.forEach(function (l) {
        if (num(l.autoPercent) && autoBaseOf(l) === 'work') sum += lineAmount(l, (doc || {}).unitRound);
      });
    }
    return sum;
  }

  // 自動計算の行の画面表示を書き換える関数（renderLines が行ごとに入れる）
  var autoRowUpdaters = [];

  /** 自動計算の行の単価を計算し直して、画面にも反映する */
  function refreshAutoLines() {
    backfillLineCats(st);
    ['work', 'work+auto'].forEach(function (base) {
      var total = autoBaseTotal(st, base);
      st.lines.forEach(function (l) {
        if (!num(l.autoPercent) || autoBaseOf(l) !== base) return;
        l.price = ceilYen(total * num(l.autoPercent) / 100, st.unitRound);
        l.base  = l.price;   // 掛率は使わない行なので、元値も同じにしておく
        l.rate  = 100;
      });
    });
    autoRowUpdaters.forEach(function (fn) { fn(); });
  }

  /**
   * 単価の端数を繰り上げる。step が 10 なら10円未満を、100 なら100円未満を切り上げる。
   * 6,205円 → 10円繰り上げで 6,210円 ／ 100円繰り上げで 6,300円。
   */
  function ceilYen(v, step) {
    var n = num(v);
    var st10 = num(step);
    if (st10 <= 1) return Math.round(n);
    return Math.ceil(n / st10) * st10;
  }

  /**
   * 人工（にんく）から単価を出す。
   * 公共工事の考え方で、作業ごとに「この工事は0.5人工」と決めておき、
   * 1人工の金額（配管工でおおむね3万〜4万）を掛けて単価にする。
   * 1人工の金額は変わっても作業人工は変わらないので、掛け算だけで済む。
   */
  function manDayPrice(md) {
    return Math.round(num(md) * num(st.manDayYen));
  }

  /**
   * 見積を切り替えたときに呼ぶ。見積ごとに1人工の金額が違うので、
   * そろえ直さないと選ぶ画面が前の見積の金額を出したままになる。
   */
  function syncManDayToQuote() {
    if (applyManDayToMaster()) renderPicker();
  }

  /** 単価マスタの人工つきの項目の単価を、いまの1人工の金額で出し直す */
  function applyManDayToMaster() {
    var changed = false;
    pb.categories.forEach(function (c) {
      c.items.forEach(function (it) {
        if (!num(it.manDay)) return;
        var v = manDayPrice(it.manDay);
        if (num(it.price) !== v) { it.price = v; changed = true; }
      });
    });
    if (changed) savePBQuiet();
    return changed;
  }

  /* ----------------------------------------------------------------------
     原価と粗利（社内用）。見積書には一切出さない。

     1単位あたりの原価の決め方は、上から順に見て最初に当たったもの。
       1. 項目・行に原価が入っていれば、その額
       2. 人工の作業なら　人工 × 原価の1人工
       3. 材料の仕入掛率が決めてあれば　定価 × 仕入掛率
       4. どれも無ければ「原価未入力」。粗利は多めに見えるので、その旨を画面に出す
     ---------------------------------------------------------------------- */

  /** 原価を画面に出すかどうか（端末ごとの見た目の設定。見積には保存しない） */
  var showCost = load(KEY_COST, false) === true;

  /**
   * その品名・仕様に当たる仕入掛率（%）を返す。当たらなければ 0。
   * メーカーだけの指定より、シリーズまで書いてある指定のほうを優先する。
   * （例：「日立 23%」と「日立の寒さ知らず 24%」があれば、寒冷地モデルには24%）
   */
  function costRateFor(text) {
    var list = pb.defaults.costRates || [];
    var best = 0, bestScore = -1;
    for (var i = 0; i < list.length; i++) {
      var maker  = String(list[i].maker  || '').trim();
      var series = String(list[i].series || '').trim();
      if (!maker && !series) continue;
      if (maker  && text.indexOf(maker)  < 0) continue;
      if (series && text.indexOf(series) < 0) continue;
      var score = (maker ? 1 : 0) + (series ? 2 : 0);
      if (score > bestScore) { bestScore = score; best = num(list[i].percent); }
    }
    return best;
  }

  /* ======================================================================
     仕入先の見積を読ませる
     ----------------------------------------------------------------------
     商社（西方商店など）の見積には［定価］と［仕切＝原価］が並んでいる。
     この2つがあれば掛率が出る。掛率が分かれば、見積に載っていない
     何千行の原価まで出せる。1本の見積が、単価マスタ全体を照らす。
     ====================================================================== */
  var COST_MAKERS = ['ダイキン', '三菱電機', '三菱', '日立', 'パナソニック', '東芝',
                     '日本キヤリア', 'キヤリア', '因幡電工', '因幡', 'オーケー器材',
                     'ユーシー産業', '日晴金属', 'キヤッチャー'];

  /** 品名・規格・カテゴリ名から、どのメーカーの品かを見当てる */
  function makerOf(text) {
    var t = String(text || '');
    for (var i = 0; i < COST_MAKERS.length; i++) {
      if (t.indexOf(COST_MAKERS[i]) >= 0) return COST_MAKERS[i];
    }
    return '';
  }

  /**
   * 読み取った行から掛率をまとめる。
   * 同じメーカーの中で掛率がそろっていれば「日立は23%」と言えるが、
   * ばらついていたら言えない（シリーズごとに違うため）。
   * だから黙って平均を出さず、そろっているものだけを提案する。
   */
  function summarizeRates(pairs) {
    var byMaker = {};
    pairs.forEach(function (p) {
      if (!(p.price > 0 && p.cost > 0)) return;
      var mk = makerOf(p.text) || '（メーカー不明）';
      (byMaker[mk] = byMaker[mk] || []).push(Math.round(p.cost / p.price * 1000) / 10);
    });
    var out = [];
    Object.keys(byMaker).forEach(function (mk) {
      var pcts = byMaker[mk];
      var lo = Math.min.apply(null, pcts), hi = Math.max.apply(null, pcts);
      out.push({
        maker: mk,
        count: pcts.length,
        steady: (hi - lo) <= 1,                 // 1ポイント以内なら「そろっている」
        pct: Math.round(((lo + hi) / 2) * 10) / 10,
        kinds: pcts.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; })
      });
    });
    return out.sort(function (a, b) { return b.count - a.count; });
  }

  /** 単価マスタの項目から、1単位あたりの原価を見積もる */
  function itemCost(item, cat) {
    if (!item) return 0;
    if (num(item.cost) > 0) return num(item.cost);
    if (num(item.manDay) > 0) return Math.round(num(item.manDay) * num(pb.defaults.manDayCostYen));
    /* 掛率は品名と規格で当てていたが、部材はカテゴリにしかメーカー名が無い
       （品名は「ペアコイル」だけで、「因幡電工」はカテゴリ名のほう）。
       カテゴリ名も見ないと、メーカーごとの掛率が当たらない */
    var pct = costRateFor((item.name || '') + ' ' + (item.spec || '') +
                          ' ' + ((cat && cat.name) || '')) ||
              num(pb.defaults.materialCostPercent);
    if (pct > 0 && (!cat || !cat.work)) return Math.round(num(item.price) * pct / 100);
    return 0;
  }

  /**
   * その行が入っているカテゴリの名前。
   * 行が覚えているのは id（c1787811020342324 のような文字）で、
   * メーカー名は名前のほう（「因幡電工｜配管化粧カバー」）にしかない。
   */
  function lineCatName(l) {
    var id = l && l.cat;
    if (!id) return '';
    var nm = '';
    pb.categories.forEach(function (c) { if (c.id === id) nm = c.name || ''; });
    return nm;
  }

  /**
   * 明細1行の原価（1単位あたり）を、いまの設定から出し直す。
   * 単価マスタに実額の原価（仕入見積から取り込んだ値など）が入っていれば、
   * それが最優先。ここを見落とすと、仕入掛率の推定値で本物の仕入値を潰してしまう。
   */
  function lineCostFromSettings(l) {
    if (num(l.autoPercent) > 0) return 0;      // 消耗品雑費・諸経費は原価を持たない

    var hit = findMasterItem(l.name, l.spec);
    if (hit && num(hit.item.cost) > 0) return num(hit.item.cost);

    if (num(l.manDay) > 0) return Math.round(num(l.manDay) * num(pb.defaults.manDayCostYen));

    /* 仕入掛率は材料の話。「工」ボタンで作業費に数えている行には当てない。
       カテゴリ名も見る。部材は品名が「ペアコイル」だけで、
       「因幡電工」はカテゴリ名にしか無いため（2026-09-06、３８８の見積で気づいた） */
    var pct = costRateFor((l.name || '') + ' ' + (l.spec || '') +
                          ' ' + lineCatName(l)) ||
              num(pb.defaults.materialCostPercent);
    if (pct > 0 && !isWorkLine(l)) return Math.round(num(l.base) * pct / 100);
    return 0;
  }

  /** その見積の原価と粗利 */
  function profitOf(doc) {
    var t = calcOf(doc);
    var cost = 0, blank = 0;
    (doc.lines || []).forEach(function (l) {
      var c = num(l.cost);
      cost += num(l.qty) * c;
      // 金額があるのに原価が入っていない行は、粗利を多く見せてしまう。
      // 消耗品雑費と諸経費はもともと原価を持たない行なので、数に入れない。
      if (c <= 0 && !num(l.autoPercent) && num(l.qty) * num(l.price) > 0) blank++;
    });
    var sales = t.taxable;                       // 税抜の受取額（諸経費・値引き込み）
    var gross = sales - cost;
    return {
      cost: cost,
      gross: gross,
      rate: sales > 0 ? (gross / sales) * 100 : 0,
      blank: blank
    };
  }

  /**
   * 機種1台ぶんの掛率（定価の何%で出すか）を、原価と「乗せる利益」の設定から出す。
   *     定価 × 仕入掛率 ＝ 原価　→　原価 ÷ modelSellDivisor ＝ 見積に出す金額
   * 会社によって乗せる利益が違うので、割る数は［自社情報］で決める。
   * 仕入掛率が未設定で原価が出せないときは 100%＝定価のまま（勝手に安くしない）。
   */
  function modelRateFor(l) {
    var list = num(l.listPrice), div = num(pb.defaults.modelSellDivisor);
    var cost = num(l.cost) || lineCostFromSettings(l);
    if (!list || !div || cost <= 0) return 100;
    return (cost / div) / list * 100;
  }

  /**
   * 機種の行の単価を、いまの設定で出し直す。
   * 掛率や単価を手で触った行（rateFixed）は動かさない。
   */
  function applyModelPrices() {
    st.lines.forEach(function (l) {
      if (!num(l.listPrice) || l.rateFixed) return;
      l.rate = modelRateFor(l);
      l.price = priceFromBase(l);
    });
  }

  /** 「原価 ÷ ○○」の下に、それが粗利率いくつになるかを言葉で出す */
  function showModelDivNote() {
    var note = $('#c-model-div-note');
    if (!note) return;
    var d = num($('#c-model-div').value);
    if (d > 0 && d < 1) {
      note.textContent = '粗利率 ' + Math.round((1 - d) * 1000) / 10 + '%。' +
        '例：原価10万円 → 見積に出す金額 ' + yen(100000 / d) + '。' +
        '仕入掛率を入れていない機種は、定価のまま出ます。';
    } else if (d >= 1) {
      note.textContent = '1以上だと利益が乗りません。0.65 なら粗利率35%です。';
    } else {
      note.textContent = '空か0のときは、機種は定価のまま出ます。';
    }
  }

  /** 掛率の表示。半端な数字になるので、小数第1位まで見せる */
  function fmtRate(r) { return (Math.round(num(r) * 10) / 10) + '%'; }

  /** 元値（定価）と掛率から、その行の単価を出す。端数の繰り上げもここでかける */
  function priceFromBase(l) {
    return ceilYen(num(l.base) * num(l.rate) / 100, st.unitRound);
  }

  /** 1人工の金額や端数の設定を変えたときに、すべての行の単価を計算し直す */
  function applyLinePrices() {
    st.lines.forEach(function (l) {
      if (num(l.autoPercent)) return;   // 自動計算の行は refreshAutoLines がやる
      if (l.base == null) l.base = num(l.price);
      if (l.rate == null) l.rate = 100;
      if (num(l.manDay)) l.base = manDayPrice(l.manDay);   // 人工の行は掛け算し直す
      l.price = priceFromBase(l);
    });
  }

  /**
   * まだ原価の入っていない行だけ、いまの設定から埋める。
   *
   * 原価は行を足した瞬間にしか出していなかったので、
   * あとから仕入掛率を入れても、すでに保存してある見積は「未入力」のままだった。
   * （2026-09-06、３８８の見積で分かった。掛率を入れても粗利が出てこない）
   *
   * 入っている原価には触らない。仕入見積から取り込んだ実額や、
   * 手で打った額を、あとからの推定値で潰さないため。
   */
  function fillMissingLineCosts() {
    var filled = 0;
    (st.lines || []).forEach(function (l) {
      if (num(l.cost) > 0) return;
      var c = lineCostFromSettings(l);
      if (c > 0) { l.cost = c; filled++; }
    });
    return filled;
  }

  /** 原価の設定を変えたときに、手で入れていない行の原価を出し直す */
  function applyLineCosts() {
    st.lines.forEach(function (l) {
      if (l.costFixed) return;            // 手で打った原価は動かさない
      l.cost = lineCostFromSettings(l);
    });
  }

  /**
   * その行の金額。ふつうは「数量 × 単価」だが、数量に小数がある行
   * （フロン破壊処理費 3.2kg など）は、それでも端数が残ってしまう。
   * そこで金額にも同じ繰り上げをかける。数量が整数の行では何も変わらない。
   */
  function lineAmount(l, step) {
    return ceilYen(num(l.qty) * num(l.price), step);
  }

  /** 見積でも請求書でも使えるように、対象の書類を受け取って計算する */
  function calcOf(st) {
    var subtotal = 0;
    (st.lines || []).forEach(function (l) { subtotal += lineAmount(l, st.unitRound); });

    var overhead = subtotal * num(st.overhead) / 100;
    var discount = num(st.discount);
    var taxable  = subtotal + overhead - discount;
    var taxRaw   = taxable * num(st.tax) / 100;

    var fn = st.rounding === 'ceil' ? Math.ceil : (st.rounding === 'round' ? Math.round : Math.floor);
    overhead = fn(overhead);
    var tax  = fn(taxRaw);
    taxable  = subtotal + overhead - discount;

    return {
      subtotal: subtotal,
      overhead: overhead,
      discount: discount,
      taxable: taxable,
      tax: tax,
      total: taxable + tax
    };
  }

  /* ======================================================================
     画面切り替え
     ====================================================================== */
  $$('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $$('.tab').forEach(function (b) { b.classList.remove('is-active'); });
      $$('.view').forEach(function (v) { v.classList.remove('is-active'); });
      btn.classList.add('is-active');
      $('#view-' + btn.dataset.view).classList.add('is-active');
      if (btn.dataset.view === 'list')     renderList();
      if (btn.dataset.view === 'master')   { renderCsvTargets(); renderMaster(); }
      if (btn.dataset.view === 'settings') fillCompany();
      window.scrollTo(0, 0);
    });
  });

  /* ======================================================================
     基本情報フォーム
     ====================================================================== */
  var metaMap = {
    '#m-no': 'no', '#m-date': 'date', '#m-customer': 'customer', '#m-honorific': 'honorific',
    '#m-subject': 'subject', '#m-site': 'site', '#m-valid': 'validDays',
    '#m-delivery': 'delivery', '#m-payment': 'payment', '#m-overhead': 'overhead',
    '#m-discount': 'discount', '#m-tax': 'tax', '#m-rounding': 'rounding', '#m-note': 'note',
    '#m-unit-round': 'unitRound', '#m-manday': 'manDayYen'
  };
  var numericFields = { validDays: 1, overhead: 1, discount: 1, tax: 1, unitRound: 1, manDayYen: 1 };

  function fillMeta() {
    Object.keys(metaMap).forEach(function (sel) {
      var node = $(sel);
      if (node) node.value = st[metaMap[sel]];
    });
  }

  Object.keys(metaMap).forEach(function (sel) {
    var node = $(sel);
    if (!node) return;
    node.addEventListener('input', function () {
      var key = metaMap[sel];
      st[key] = numericFields[key] ? num(node.value) : node.value;
      if (key === 'unitRound' || key === 'manDayYen') {
        if (key === 'manDayYen') { applyManDayToMaster(); renderPicker(); }
        applyLinePrices();
        renderLines();
      }
      else if (key === 'overhead' || key === 'discount' || key === 'tax' || key === 'rounding') renderTotals();
      persistDraft();
    });
    node.addEventListener('change', function () {
      var key = metaMap[sel];
      st[key] = numericFields[key] ? num(node.value) : node.value;
      if (key === 'unitRound' || key === 'manDayYen') {
        if (key === 'manDayYen') { applyManDayToMaster(); renderPicker(); }
        applyLinePrices();
        renderLines();
      }
      else renderTotals();
      persistDraft();
    });
  });

  var draftTimer;
  function persistDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () { save(KEY_DRAFT, st); }, 400);
  }

  /* ======================================================================
     単価ピッカー
     ====================================================================== */
  var activeCat = pb.categories.length ? pb.categories[0].id : null;

  var FREQ = '__freq__';       // 「よく使う」は本物のカテゴリではなく、使用回数から作る仮のまとまり
  var FREQ_MAX = 40;

  function frequentItems() {
    var out = [];
    pb.categories.forEach(function (c) {
      c.items.forEach(function (it) { if (it.used) out.push({ cat: c, item: it }); });
    });
    out.sort(function (a, b) { return (b.item.used || 0) - (a.item.used || 0); });
    return out.slice(0, FREQ_MAX);
  }

  function renderPicker() {
    var cats = $('#picker-cats');
    cats.innerHTML = '';

    var freq = frequentItems();
    if (freq.length) {
      var fb = el('button', 'cat-btn cat-freq' + (activeCat === FREQ ? ' is-active' : ''), '★ よく使う');
      fb.type = 'button';
      fb.addEventListener('click', function () {
        activeCat = FREQ;
        $('#picker-search').value = '';
        renderPicker();
      });
      cats.appendChild(fb);
    } else if (activeCat === FREQ) {
      activeCat = pb.categories.length ? pb.categories[0].id : null;
    }

    pb.categories.forEach(function (c) {
      var b = el('button', 'cat-btn' + (c.id === activeCat ? ' is-active' : ''), c.name);
      b.type = 'button';
      b.addEventListener('click', function () {
        activeCat = c.id;
        $('#picker-search').value = '';
        renderPicker();
      });
      cats.appendChild(b);
    });
    renderPickerItems();
  }

  function renderPickerItems() {
    var box = $('#picker-items');
    var q = $('#picker-search').value.trim().toLowerCase();
    box.innerHTML = '';

    var results = [];
    if (!q && activeCat === FREQ) {
      results = frequentItems();
    } else {
      pb.categories.forEach(function (c) {
        if (!q && c.id !== activeCat) return;
        c.items.forEach(function (it) {
          // 品番でも探せるようにする（例：「LD-70」と打てば出る）
          var hay = ((it.code || '') + ' ' + it.name + ' ' + (it.spec || '') + ' ' + c.name).toLowerCase();
          if (!q || hay.indexOf(q) >= 0) results.push({ cat: c, item: it });
        });
      });
    }

    if (!results.length) {
      box.appendChild(el('p', 'picker-empty', '該当する項目がありません。'));
      return;
    }

    // 検索時は件数が多くなりうるので上限をつける
    var LIMIT = 300;
    var shown = results.slice(0, LIMIT);

    shown.forEach(function (r) {
      var b = el('button', 'item-btn');
      b.type = 'button';
      var col = itemColor(r.item.color);
      if (col) b.style.color = col;      // シリーズごとの色分け
      if (r.item.code) b.appendChild(el('i', 'item-code', r.item.code));
      b.appendChild(el('b', null, r.item.name));
      if (r.item.spec) b.appendChild(el('em', null, r.item.spec));
      b.appendChild(el('span', null, num(r.item.autoPercent)
        ? autoLabel(r.item)
        : (num(r.item.manDay) ? r.item.manDay + '人工　' : '') + yen(r.item.price) + ' / ' + r.item.unit));
      b.addEventListener('click', function () {
        // 自動計算の項目（消耗品雑費・諸経費）は、2回入れると二重に乗ってしまう。
        // 家庭用と業務用の両方に消耗品雑費を置いてあるので、うっかり両方押せてしまう
        if (num(r.item.autoPercent)) {
          var already = false;
          st.lines.forEach(function (l) {
            if (num(l.autoPercent) && l.name === r.item.name) already = true;
          });
          if (already) { toast('「' + r.item.name + '」はもう明細に入っています'); return; }
        }
        addLine({
          name: r.item.name,
          // 仕様欄はそのまま見積書に印刷される。単価マスタの規格には
          // 「20m巻（1巻 ¥124,100）」のような仕入れの都合が入っているので、
          // 品番のある材料は品番だけにする。
          // 品番の無い工事（「3馬力」など）は規格がそのまま意味を持つので残す。
          spec: r.item.code ? String(r.item.code).trim() : (r.item.spec || ''),
          qty: 1,
          unit: r.item.unit,
          price: r.item.price,
          // どの分類から入れたか。作業費の合計（消耗品雑費の計算のもと）に使う
          cat: r.cat.id,
          // 単価が自動で決まる項目は、割合と「何の合計をもとにするか」も持たせる
          autoPercent: num(r.item.autoPercent) || 0,
          autoBase: r.item.autoBase || '',
          // 人工つきの作業は、1人工の金額を変えたときに計算し直せるよう覚えておく
          manDay: num(r.item.manDay) || 0,
          // 原価（社内用）。見積書には出ない
          cost: itemCost(r.item, r.cat),
          // 見積を作りながら「これどんな材料だっけ」を確かめられるよう、製品ページも持たせる
          url: r.item.url || ''
        });
        // 選んだ回数を覚えておき、「★よく使う」に出す。
        // ここで画面を作り直すとボタンの位置が動いて押しにくいので、保存だけする。
        r.item.used = (r.item.used || 0) + 1;
        savePBQuiet();
        toast('「' + r.item.name + '」を追加しました');
      });

      // 選ぶ前に「これどんな材料だっけ」を確かめられるように、
      // ボタンの右上に製品ページへのリンクを重ねておく。
      // button の中に button は置けないので、外側の箱で包む。
      var cell = el('div', 'item-cell');
      cell.appendChild(b);
      var pref = refButton(r.item.url, r.item.name);
      if (pref) { pref.classList.add('item-ref'); b.classList.add('has-ref'); cell.appendChild(pref); }
      box.appendChild(cell);
    });

    if (results.length > LIMIT) {
      box.appendChild(el('p', 'picker-empty',
        results.length + '件見つかりました。' + LIMIT + '件まで表示しています。品番や品名でもう少し絞り込んでください。'));
    }
  }

  $('#picker-search').addEventListener('input', renderPickerItems);

  /* ======================================================================
     明細
     ====================================================================== */
  function addLine(line) {
    var l = Object.assign({ name: '', spec: '', qty: 1, unit: '式', price: 0, url: '', cat: '', autoPercent: 0, autoBase: '', manDay: 0, cost: 0, listPrice: 0 }, line || {});
    // base は掛率をかける前の元値（単価マスタの定価）。rate は「定価の何%で出すか」
    if (l.base == null) l.base = num(l.price);
    if (l.rate == null) l.rate = 100;
    if (num(l.manDay)) l.base = manDayPrice(l.manDay);
    l.price = priceFromBase(l);   // 端数の設定にしたがって繰り上げる
    if (!num(l.cost)) l.cost = lineCostFromSettings(l);
    st.lines.push(l);
    renderLines();
    persistDraft();
  }

  /* 明細行の「掛率」プルダウンの選択肢（定価の何%で出すか） */
  var RATES = [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50];

  /* ------------------------------------------------------------------
     明細行を「つかんで動かす」並び替え。
     マウスでも指でも同じように動くよう pointer イベントで扱う。
     動かしている間は見た目（DOM）だけ入れ替え、指を離したときに
     はじめてデータの順番を入れ替えて、行を作り直す。
     ------------------------------------------------------------------ */
  var drag = null;

  function startDrag(ev, tr, from) {
    if (ev.button != null && ev.button !== 0) return;   // 左ボタンと指だけ
    ev.preventDefault();
    var handle = ev.currentTarget, tb = $('#lines-body');
    drag = { tb: tb, tr: tr, from: from, handle: handle, pid: ev.pointerId };
    tr.classList.add('is-dragging');
    tb.classList.add('is-reordering');
    // 監視は書類全体に付ける。
    // つまみは動かす行の中にあるので、行を入れ替えた瞬間につまみも
    // いったん外れてしまい、つまみに付けた監視では「指を離した」を
    // 取り逃す。書類全体で見ていればそれが起きない。
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
    window.addEventListener('blur', endDrag);
  }

  function onDragMove(ev) {
    if (!drag) return;
    ev.preventDefault();
    var rows = Array.prototype.slice.call(drag.tb.children);
    var cur = rows.indexOf(drag.tr);
    if (cur < 0 || !rows.length) return;

    var y = ev.clientY, target = null;
    for (var k = 0; k < rows.length; k++) {
      var r = rows[k].getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) { target = k; break; }
    }
    if (target === null) {
      // 表からはみ出したら、いちばん上／いちばん下に寄せる
      if (y < rows[0].getBoundingClientRect().top) target = 0;
      else if (y > rows[rows.length - 1].getBoundingClientRect().bottom) target = rows.length - 1;
      else return;
    }
    if (target === cur) return;

    var ref = rows[target];
    if (target < cur) drag.tb.insertBefore(drag.tr, ref);
    else drag.tb.insertBefore(drag.tr, ref.nextSibling);
  }

  function endDrag() {
    if (!drag) return;
    var d = drag; drag = null;

    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    window.removeEventListener('blur', endDrag);
    d.tr.classList.remove('is-dragging');
    d.tb.classList.remove('is-reordering');

    var to = Array.prototype.indexOf.call(d.tb.children, d.tr);
    if (to >= 0 && to !== d.from) {
      st.lines.splice(to, 0, st.lines.splice(d.from, 1)[0]);
      persistDraft();
    }
    // 各行が覚えている「自分は何行目か」がずれるので、必ず作り直す
    renderLines();
  }

  function renderLines() {
    // 古い見積の行に分類の印を補う。行を組み立てる前にやらないと、
    // 自動計算の行なのに「ふつうの行」として描いてしまう
    backfillLineCats(st);

    var tb = $('#lines-body');
    tb.innerHTML = '';
    autoRowUpdaters = [];
    $('#lines-empty').style.display = st.lines.length ? 'none' : 'block';
    $('#lines-table').style.display = st.lines.length ? 'table' : 'none';

    st.lines.forEach(function (l, i) {
      var tr = el('tr');
      // 消耗品雑費のように「作業費の◯%」で単価が決まる行
      var isAuto = !!num(l.autoPercent);
      if (isAuto) tr.classList.add('line-auto');

      // 並び替え：つまみをつかんで動かす。矢印でも1つずつ動かせる
      var tdMove = el('td', 'c-move');
      var mvWrap = el('div', 'move-wrap');

      var grip = el('div', 'row-grip', '⠿');
      grip.title = 'つかんで上下に動かすと、行の順番を入れ替えられます';
      grip.tabIndex = 0;
      grip.setAttribute('role', 'button');
      grip.setAttribute('aria-label', (i + 1) + '行目をつかんで並び替える');
      grip.addEventListener('pointerdown', function (ev) { startDrag(ev, tr, i); });
      grip.addEventListener('keydown', function (ev) {
        // マウスが使いにくいときのために、上下キーでも動かせるようにしておく
        if (ev.key === 'ArrowUp') { ev.preventDefault(); moveLine(i, -1, true); }
        else if (ev.key === 'ArrowDown') { ev.preventDefault(); moveLine(i, 1, true); }
      });
      mvWrap.appendChild(grip);

      var mv = el('div', 'move-btns');
      var up = el('button', 'icon-btn', '▲'); up.type = 'button'; up.title = '上へ';
      var dn = el('button', 'icon-btn', '▼'); dn.type = 'button'; dn.title = '下へ';
      up.addEventListener('click', function () { moveLine(i, -1); });
      dn.addEventListener('click', function () { moveLine(i, 1); });
      mv.appendChild(up); mv.appendChild(dn);
      mvWrap.appendChild(mv);
      tdMove.appendChild(mvWrap);
      tr.appendChild(tdMove);

      // 品名・仕様
      var tdName = el('td', 'c-name');
      var wrap = el('div', 'line-name');
      var iName = el('input'); iName.type = 'text'; iName.value = l.name; iName.placeholder = '品名';
      var iSpec = el('input', 'spec'); iSpec.type = 'text'; iSpec.value = l.spec || ''; iSpec.placeholder = '仕様・型番など（任意）';
      iName.addEventListener('input', function () { l.name = iName.value; persistDraft(); });
      iSpec.addEventListener('input', function () { l.spec = iSpec.value; persistDraft(); });
      wrap.appendChild(iName); wrap.appendChild(iSpec);
      tdName.appendChild(wrap);
      // 見積書に出る「定価 → 売値」を、画面でも見えるようにしておく
      var listHint = el('div', 'line-list-hint');
      tdName.appendChild(listHint);
      tr.appendChild(tdName);

      // 数量
      var tdQty = el('td', 'c-qty');
      var iQty = el('input'); iQty.type = 'number'; iQty.step = '0.1'; iQty.value = l.qty;
      tdQty.appendChild(iQty);
      tr.appendChild(tdQty);

      // 単位
      var tdUnit = el('td', 'c-unit');
      var iUnit = el('input'); iUnit.type = 'text'; iUnit.value = l.unit;
      iUnit.addEventListener('input', function () { l.unit = iUnit.value; persistDraft(); });
      tdUnit.appendChild(iUnit);
      tr.appendChild(tdUnit);

      // 掛率（定価の何%で出すか）
      // 古い見積を開いたときは base / rate が無いので、ここで今の単価を元値とみなす
      if (l.base == null) l.base = num(l.price);
      if (l.rate == null) l.rate = 100;

      var tdRate = el('td', 'c-rate');
      var sRate = el('select', 'rate-sel');
      RATES.forEach(function (r) {
        var o = el('option', null, r + '%');
        o.value = r;
        if (num(l.rate) === r) o.selected = true;
        sRate.appendChild(o);
      });
      // 選択肢に無い掛率（手入力の結果など）も残せるようにしておく
      if (RATES.indexOf(num(l.rate)) < 0) {
        var oX = el('option', null, fmtRate(l.rate));
        oX.value = l.rate; oX.selected = true;
        sRate.insertBefore(oX, sRate.firstChild);
      }
      if (isAuto) {
        sRate.disabled = true;
        sRate.title = 'この行の単価は自動で決まるので、掛率は使いません';
      }
      tdRate.appendChild(sRate);
      tr.appendChild(tdRate);

      // 単価
      var tdPrice = el('td', 'c-price');
      var iPrice = el('input'); iPrice.type = 'number'; iPrice.step = '1'; iPrice.value = l.price;
      if (isAuto) iPrice.readOnly = true;
      tdPrice.appendChild(iPrice);
      /* この行の単価が人工から出ていることを、画面に出す。
         打ち替えは前からできたが、なぜその金額なのかが見えなかった */
      var mdNote = el('small', 'line-mdnote');
      function showMdNote() {
        mdNote.textContent = num(l.manDay)
          ? num(l.manDay) + '人工 × ' + yen(num(st.manDayYen))
          : '';
      }
      showMdNote();
      tdPrice.appendChild(mdNote);
      tr.appendChild(tdPrice);

      function showBaseHint() {
        // 掛率が100%でないときだけ、元の定価が分かるようにしておく
        iPrice.title = num(l.rate) === 100 ? '' : '定価 ' + yen(num(l.base)) + ' の ' + l.rate + '%';
        tdRate.classList.toggle('is-off', num(l.rate) !== 100);
        var lp = num(l.listPrice);
        if (lp && num(l.price) && lp > num(l.price)) {
          listHint.textContent = '見積書に出ます　定価 ' + yen(lp) + ' → ' + yen(num(l.price));
          listHint.classList.remove('is-warn');
        } else if (lp && num(l.cost) <= 0) {
          // 原価が出せないと利益の乗せようがない。黙って定価のままにせず、理由を出す
          listHint.textContent = '仕入掛率が未設定なので、定価のまま出ます（［自社情報］で設定できます）';
          listHint.classList.add('is-warn');
        } else {
          listHint.textContent = '';
          listHint.classList.remove('is-warn');
        }
      }
      showBaseHint();

      sRate.addEventListener('change', function () {
        l.rate = num(sRate.value);
        l.rateFixed = true;          // 手で選んだ掛率は、設定を変えても動かさない
        l.price = priceFromBase(l);
        iPrice.value = l.price;
        showBaseHint();
        recalc();
      });

      // 金額
      var tdAmt = el('td', 'c-amount', yen(lineAmount(l, st.unitRound)));
      tr.appendChild(tdAmt);

      // 自動計算の行は、ほかの行をいじるたびに単価と金額を書き直す
      if (isAuto) {
        autoRowUpdaters.push(function () {
          var bs = autoBaseOf(l);
          iPrice.value = l.price;
          iPrice.title = AUTO_BASES[bs].name + 'の合計 ' + yen(autoBaseTotal(st, bs)) +
                         ' の ' + num(l.autoPercent) + '%';
          tdAmt.textContent = yen(lineAmount(l, st.unitRound));
          showMargin();
        });
      }

      function recalc() {
        l.qty = num(iQty.value);
        if (!isAuto) l.price = num(iPrice.value);
        tdAmt.textContent = yen(lineAmount(l, st.unitRound));
        showMargin();
        refreshAutoLines();
        renderTotals();
        persistDraft();
      }
      iQty.addEventListener('input', recalc);
      iPrice.addEventListener('input', function () {
        if (isAuto) return;   // 作業費から自動で決まる行は書き換えさせない
        // 単価を手で書き換えたら、その金額が新しい元値。掛率は100%に戻す
        l.base = num(iPrice.value);
        l.rate = 100;
        l.rateFixed = true;          // 手で入れた単価は、設定を変えても動かさない
        sRate.value = '100';
        /* この見積のこの行だけ、人工から外す。単価マスタには触らない。
           次に作る見積では、また人工から出た金額で入ってくる */
        if (num(l.manDay)) { l.manDay = 0; showMdNote(); }
        showBaseHint();
        recalc();
      });

      // 打っている途中で数字が飛ぶと打ちにくいので、
      // 端数の繰り上げは入力を終えたとき（欄から離れたとき）にかける
      iPrice.addEventListener('change', function () {
        if (isAuto) return;
        var rounded = priceFromBase(l);
        if (rounded === num(iPrice.value)) return;
        iPrice.value = rounded;
        recalc();
      });

      // 原価と粗利率（社内用）。見積書には出ない
      var tdCost = el('td', 'c-cost');
      var tdMargin = el('td', 'c-margin');
      var iCost = el('input'); iCost.type = 'number'; iCost.step = '1'; iCost.value = num(l.cost) || '';
      iCost.placeholder = '—';
      iCost.title = '1' + (l.unit || '個') + 'あたりの原価。空のままだと粗利を多めに見せてしまいます';
      tdCost.appendChild(iCost);
      tr.appendChild(tdCost);
      tr.appendChild(tdMargin);

      function showMargin() {
        var amt = lineAmount(l, st.unitRound);
        var cst = num(l.qty) * num(l.cost);
        if (!amt || !num(l.cost)) {
          tdMargin.textContent = num(l.cost) ? '—' : '未入力';
          tdMargin.classList.remove('is-thin');
          return;
        }
        var r = ((amt - cst) / amt) * 100;
        tdMargin.textContent = r.toFixed(1) + '%';
        tdMargin.classList.toggle('is-thin', r < 15);
      }

      iCost.addEventListener('input', function () {
        l.cost = num(iCost.value);
        l.costFixed = num(iCost.value) > 0;   // 手で入れた原価は設定変更で上書きしない
        showMargin();
        renderTotals();
        persistDraft();
      });

      // 製品ページ ＋ 単価表に登録 ＋ 削除
      var tdDel = el('td', 'c-del');

      var ref = refButton(l.url, l.name);
      if (ref) tdDel.appendChild(ref);

      if (!isAuto) {
        // この行を作業費（消耗品雑費・諸経費のもと）に数えるかどうか
        var wk = el('button', 'icon-btn icon-work', '工'); wk.type = 'button';
        if (isWorkLine(l)) wk.classList.add('is-on');
        wk.title = isWorkLine(l)
          ? 'この行は作業費に数えています（押すと数えなくなります）'
          : 'この行は作業費に数えていません（押すと数えます）';
        wk.addEventListener('click', function () {
          l.work = !isWorkLine(l);
          renderLines();
          persistDraft();
        });
        tdDel.appendChild(wk);

        var reg = el('button', 'icon-btn icon-reg', '＋表'); reg.type = 'button';
        reg.title = 'この行を単価表に登録して、次から選べるようにする';
        reg.addEventListener('click', function () {
          registerLineToMaster(l);
        });
        tdDel.appendChild(reg);
      }

      var del = el('button', 'icon-btn', '✕'); del.type = 'button'; del.title = 'この行を削除';
      del.addEventListener('click', function () {
        st.lines.splice(i, 1);
        renderLines();
        persistDraft();
      });
      tdDel.appendChild(del);
      tr.appendChild(tdDel);

      showMargin();
      tb.appendChild(tr);
    });

    applyCostVisibility();
    refreshAutoLines();
    renderTotals();
  }

  /**
   * 見積の1行を、そのまま単価表に登録する。
   * 現場で「この材料、まだ単価表に入れてなかった」となったときに、
   * 画面を行き来せず登録できるようにするためのもの。
   */
  function registerLineToMaster(line) {
    if (!(line.name || '').trim()) { toast('品名を入れてから登録してください'); return; }

    var cat = null;
    pb.categories.forEach(function (c) { if (c.id === activeCat) cat = c; });
    if (!cat) cat = pb.categories[0];
    if (!cat) { toast('先に単価マスタでカテゴリを作ってください'); return; }

    // 「LD-70　ダクト70」のように品番と規格をまとめてある場合は、先頭を品番として切り出す
    var spec = (line.spec || '').trim();
    var code = '';
    var m = spec.match(/^([0-9A-Za-z][0-9A-Za-z\-_/.]{1,23})(?:[　\s]+(.*))?$/);
    if (m) { code = m[1]; spec = (m[2] || '').trim(); }

    var dup = null;
    cat.items.forEach(function (it) {
      if (it.name === line.name && (it.code || '') === code && (it.spec || '') === spec) dup = it;
    });

    if (dup) {
      if (dup.price === num(line.price)) { toast('「' + cat.name + '」にすでに同じ内容で登録されています'); return; }
      if (!confirm('「' + cat.name + '」に同じ項目があります。単価を ' +
        yen(dup.price) + ' → ' + yen(num(line.price)) + ' に更新しますか？')) return;
      dup.price = num(line.price);
      dup.unit = line.unit || dup.unit;
      if (num(line.cost)) dup.cost = num(line.cost);
    } else {
      if (!confirm('この内容で「' + cat.name + '」に登録します。よろしいですか？\n\n' +
        '　品番：' + (code || '（なし）') + '\n' +
        '　品名：' + line.name + '\n' +
        '　規格：' + (spec || '（なし）') + '\n' +
        '　単位：' + (line.unit || '個') + '\n' +
        '　単価：' + yen(num(line.price)))) return;
      var reg = {
        code: code, name: line.name, spec: spec,
        unit: line.unit || '個', price: num(line.price),
        url: safeUrl(line.url)
      };
      // 行が持っている原価・人工・色も一緒に持っていく。
      // ここで落とすと、次に選んだとき原価が空のまま出てくる。
      if (num(line.cost)) reg.cost = num(line.cost);
      if (num(line.manDay)) reg.manDay = num(line.manDay);
      if (line.color) reg.color = line.color;
      cat.items.push(reg);
    }

    if (savePB() === false) return;
    renderPicker();
    toast('「' + cat.name + '」に登録しました');
  }

  /** 仕様欄が「品番　つづき」の形になっているか */
  var CODE_HEAD_RE = /^([0-9A-Za-z][0-9A-Za-z\-_\/.]{1,23})[　\s]+\S/;

  /**
   * 明細の1行の「仕様」を、品番だけに詰める。
   * 「PC-3520-10H　20m巻（1巻 ¥124,100）」→「PC-3520-10H」
   * 品番で始まっていない行（工事の「3馬力」など）は触らない。
   */
  function stripSpecToCode(l) {
    var spec = String(l.spec || '').trim();
    if (!spec) return false;

    // まず単価マスタで品番を調べる。見つからないときは先頭のかたまりを品番とみなす
    var hit = findMasterItem(l.name, l.spec);
    var code = (hit && hit.item.code) ? String(hit.item.code).trim() : '';
    if (!code) {
      var m = spec.match(CODE_HEAD_RE);
      code = m ? m[1] : '';
    }
    if (!code || spec === code) return false;
    if (spec.indexOf(code) !== 0) return false;   // 品番で始まっていない行は触らない

    l.spec = code;
    return true;
  }

  /** 詰めたらどうなるかを、実際には書き換えずに調べる */
  function strippedSpec(l) {
    var probe = { name: l.name, spec: l.spec };
    return stripSpecToCode(probe) ? probe.spec : null;
  }

  function moveLine(i, dir, keepFocus) {
    var j = i + dir;
    if (j < 0 || j >= st.lines.length) return;
    var tmp = st.lines[i];
    st.lines[i] = st.lines[j];
    st.lines[j] = tmp;
    renderLines();
    persistDraft();
    // 上下キーで動かしたときは、動いた行のつまみに焦点を戻して続けて押せるようにする
    if (keepFocus) {
      var row = $('#lines-body').children[j];
      var g = row && row.querySelector('.row-grip');
      if (g) g.focus();
    }
  }

  /**
   * 原価の列を出す／隠す。
   * body にクラスを付けてCSSに任せる。そうしないと、あとから作られる
   * 単価マスタの行や、足したばかりの明細の行に効かない。
   */
  function applyCostVisibility() {
    document.body.classList.toggle('show-cost', showCost);
    // 見積作成と単価マスタ、両方のチェックをそろえる
    ['#chk-cost', '#chk-cost-m'].forEach(function (sel) {
      var chk = $(sel);
      if (chk) chk.checked = showCost;
    });
  }

  ['#chk-cost', '#chk-cost-m'].forEach(function (sel) {
    var chk = $(sel);
    if (!chk) return;
    chk.addEventListener('change', function () {
      showCost = chk.checked;
      save(KEY_COST, showCost);
      applyCostVisibility();
      renderTotals();
    });
  });

  function renderTotals() {
    var t = calc();
    var box = $('#totals');
    var rows = [];

    // 消耗品雑費・諸経費を使っているときは、そのもとになる作業費も見えるようにしておく。
    // これは画面だけの表示で、見積書には印刷されない。
    var hasAuto = false;
    st.lines.forEach(function (l) { if (num(l.autoPercent)) hasAuto = true; });
    if (hasAuto) rows.push(['作業費（画面のみ）', yen(autoBaseTotal(st, 'work'))]);

    rows.push(['小計', yen(t.subtotal)]);
    if (t.overhead) rows.push(['諸経費（' + st.overhead + '%）', yen(t.overhead)]);
    if (t.discount) rows.push(['値引き', '-' + yen(t.discount)]);
    rows.push(['課税対象額', yen(t.taxable)]);
    rows.push(['消費税（' + st.tax + '%）', yen(t.tax)]);

    var html = '<dl>';
    rows.forEach(function (r) { html += '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; });
    html += '<dt class="row-total">御見積金額（税込）</dt><dd class="row-total">' + esc(yen(t.total)) + '</dd>';

    // 原価と粗利（社内用）。画面だけで、見積書には印刷されない
    if (showCost) {
      var pf = profitOf(st);
      html += '<dt class="row-cost">原価（画面のみ）</dt><dd class="row-cost">' + esc(yen(pf.cost)) + '</dd>';
      html += '<dt class="row-cost">粗利（税抜）</dt><dd class="row-cost">' + esc(yen(pf.gross)) + '</dd>';
      html += '<dt class="row-cost">粗利率</dt><dd class="row-cost">' + esc(pf.rate.toFixed(1) + '%') + '</dd>';
      if (pf.blank) {
        html += '<dt class="row-cost">原価未入力</dt><dd class="row-cost">' + pf.blank +
                '行（粗利は多めに出ています）</dd>';
      }
    }
    html += '</dl>';
    box.innerHTML = html;
  }

  $('#btn-strip-spec').addEventListener('click', function () {
    var targets = st.lines.filter(function (l) { return strippedSpec(l) !== null; });
    if (!targets.length) { toast('品番だけに詰められる行はありませんでした'); return; }

    var sample = targets.slice(0, 5).map(function (l) {
      return '　' + l.spec + '\n　　→ ' + strippedSpec(l);
    }).join('\n');

    if (!confirm(targets.length + '行の「仕様」を品番だけにします。よろしいですか？\n' +
      '（見積書に梱包数や仕入れ値が出ないようにするためのものです）\n\n' + sample +
      (targets.length > 5 ? '\n　…ほか ' + (targets.length - 5) + '行' : ''))) return;

    var n = 0;
    st.lines.forEach(function (l) { if (stripSpecToCode(l)) n++; });
    renderLines();
    persistDraft();
    toast(n + '行の仕様を品番だけにしました');
  });

  $('#btn-add-blank').addEventListener('click', function () { addLine(); });
  $('#btn-clear-lines').addEventListener('click', function () {
    if (!st.lines.length) return;
    if (!confirm('明細をすべて消します。よろしいですか？')) return;
    st.lines = [];
    renderLines();
    persistDraft();
  });

  /* ======================================================================
     新規 / 保存
     ====================================================================== */
  $('#btn-new').addEventListener('click', function () {
    if (!confirm('新しい見積を作ります。今の内容は（保存していなければ）消えます。よろしいですか？')) return;
    st = newState();
    syncManDayToQuote();
    fillMeta();
    renderLines();
    save(KEY_DRAFT, st);
    toast('新規作成しました');
  });

  $('#btn-save').addEventListener('click', function () {
    var list = load(KEY_EST, []);
    var t = calc();

    // どの現場のものか決まっていなければ、件名と宛名から現場を作る
    if (!st.siteId) {
      var nm = (st.subject || '').trim() || (st.site || '').trim() || (st.customer || '').trim();
      if (!nm) { toast('先に件名かお客様名を入れてください（現場の名前になります）'); return; }
      var sites = loadSites();
      var found = null;
      sites.forEach(function (x) {
        if (x.name === nm && (x.customer || '') === (st.customer || '').trim()) found = x;
      });
      if (!found) {
        found = {
          id: 's' + Date.now() + Math.floor(Math.random() * 1000),
          name: nm,
          customer: (st.customer || '').trim(),
          honorific: st.honorific || '御中',
          address: st.site || '',
          tel: '',
          memo: '',
          createdAt: new Date().toISOString()
        };
        sites.push(found);
        if (saveSites(sites) === false) return;
      }
      st.siteId = found.id;
    }

    var rec = clone(st);
    rec.total = t.total;
    rec.savedAt = new Date().toISOString();
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].id === rec.id) { idx = i; break; } }
    if (idx >= 0) list[idx] = rec; else list.unshift(rec);
    save(KEY_EST, list);
    save(KEY_DRAFT, st);
    toast('保存しました（' + rec.no + '）');
  });

  /* ======================================================================
     保存済み一覧
     ====================================================================== */
  /* ======================================================================
     現場（案件）
     ----------------------------------------------------------------------
     1つの現場に、見積・請求書・現調シートがぶら下がる構造。
     見積は siteId で現場に結びつく。
     ====================================================================== */
  var openSiteId = null;      // いま開いている現場（null なら一覧を表示）

  function loadSites() { return load(KEY_SITE, []); }
  function saveSites(v) { return save(KEY_SITE, v); }
  function findSite(id) {
    var hit = null;
    loadSites().forEach(function (s) { if (s.id === id) hit = s; });
    return hit;
  }
  function estimatesOf(siteId) {
    return load(KEY_EST, []).filter(function (e) { return e.siteId === siteId; });
  }

  /**
   * 現場という考え方が無かった頃に保存した見積を、現場にふり分ける。
   * 宛名＋件名が同じものは1つの現場にまとめる。中身は書き換えず siteId を足すだけ。
   */
  function migrateEstimatesToSites() {
    var list = load(KEY_EST, []);
    var orphans = list.filter(function (e) { return !e.siteId; });
    if (!orphans.length) return 0;

    var sites = loadSites();
    var byKey = {};
    sites.forEach(function (s) { byKey[(s.customer || '') + ' :: ' + (s.name || '')] = s; });

    orphans.forEach(function (e) {
      var name = (e.subject || '').trim() || (e.site || '').trim() || '（件名なし）';
      var cust = (e.customer || '').trim();
      var key = cust + ' :: ' + name;
      var s = byKey[key];
      if (!s) {
        s = {
          id: 's' + Date.now() + Math.floor(Math.random() * 1000),
          name: name,
          customer: cust,
          honorific: e.honorific || '御中',
          address: e.site || '',
          tel: '',
          memo: '',
          createdAt: e.savedAt || new Date().toISOString()
        };
        sites.push(s);
        byKey[key] = s;
      }
      e.siteId = s.id;
    });
    saveSites(sites);
    save(KEY_EST, list);
    return orphans.length;
  }

  function siteDialog(site) {
    var isNew = !site;
    var s = site || { name: '', customer: '', honorific: '御中', address: '', tel: '', memo: '' };
    var name = prompt(isNew ? '現場名（件名）を入れてください\n例：〇〇商店 事務所エアコン更新' : '現場名（件名）', s.name);
    if (name === null) return null;
    name = name.trim();
    if (!name) { toast('現場名を入れてください'); return null; }
    var cust = prompt('お客様名', s.customer);
    if (cust === null) return null;
    var addr = prompt('工事場所（住所）', s.address);
    if (addr === null) return null;
    var tel = prompt('連絡先（任意）', s.tel);
    if (tel === null) return null;
    s.name = name; s.customer = cust.trim(); s.address = addr.trim(); s.tel = tel.trim();
    return s;
  }

  $('#btn-new-site').addEventListener('click', function () {
    var s = siteDialog(null);
    if (!s) return;
    s.id = 's' + Date.now() + Math.floor(Math.random() * 1000);
    s.createdAt = new Date().toISOString();
    var sites = loadSites();
    sites.push(s);
    if (saveSites(sites) === false) return;
    openSiteId = s.id;
    renderList();
    toast('現場を作りました');
  });

  $('#btn-site-back').addEventListener('click', function () { openSiteId = null; renderList(); });

  $('#btn-site-edit').addEventListener('click', function () {
    var sites = loadSites();
    var s = null;
    sites.forEach(function (x) { if (x.id === openSiteId) s = x; });
    if (!s) return;
    if (!siteDialog(s)) return;
    saveSites(sites);
    renderList();
    toast('現場情報を更新しました');
  });

  $('#btn-site-del').addEventListener('click', function () {
    var s = findSite(openSiteId);
    if (!s) return;
    var n = estimatesOf(s.id).length;
    // 写真は別の入れ物にあるので、数えるのも消すのもあとから（待たせないため先に数だけ聞く）
    photosOf(s.id).then(function (photos) { askDeleteSite(s, n, photos || []); },
                        function () { askDeleteSite(s, n, []); });
  });

  function askDeleteSite(s, n, photos) {
    if (!confirm('現場「' + s.name + '」を削除します。\n' +
      (n ? 'この現場の見積 ' + n + '件も一緒に消えます。\n' : '') +
      (photos.length ? 'この現場の写真 ' + photos.length + '枚も一緒に消えます。\n' : '') +
      'よろしいですか？')) return;
    saveSites(loadSites().filter(function (x) { return x.id !== s.id; }));
    save(KEY_EST, load(KEY_EST, []).filter(function (e) { return e.siteId !== s.id; }));
    // 現場が消えたあとに写真だけ残ると、二度と出せないゴミになる
    photos.forEach(function (p) { photoDel(p.id); });
    if (photos.length) photosChanged();          // もう一方の端末からも消す
    openSiteId = null;
    renderList();
    toast('削除しました');
  }

  $('#site-search').addEventListener('input', function () { renderSiteList(); });

  function renderList() {
    migrateEstimatesToSites();
    freePhotoUrls();                 // 前に出していた写真の一時アドレスを返す
    var showDetail = !!(openSiteId && findSite(openSiteId));
    $('#site-list-card').style.display = showDetail ? 'none' : '';
    $('#site-detail-card').style.display = showDetail ? '' : 'none';
    if (showDetail) renderSiteDetail(); else renderSiteList();
  }

  function renderSiteList() {
    var box = $('#site-list');
    box.innerHTML = '';
    var q = ($('#site-search').value || '').trim().toLowerCase();
    var sites = loadSites();
    var ests = load(KEY_EST, []);

    if (!sites.length) {
      box.appendChild(el('p', 'empty-note',
        'まだ現場がありません。「＋ 現場を追加」で作るか、見積を保存すると自動で作られます。'));
      return;
    }
    var shown = sites.filter(function (s) {
      if (!q) return true;
      return ((s.name || '') + ' ' + (s.customer || '') + ' ' + (s.address || '')).toLowerCase().indexOf(q) >= 0;
    });
    if (!shown.length) { box.appendChild(el('p', 'empty-note', '見つかりませんでした。')); return; }

    // 更新が新しい現場を上に
    var lastOf = {};
    ests.forEach(function (e) {
      if (!e.siteId) return;
      if (!lastOf[e.siteId] || String(e.savedAt) > lastOf[e.siteId]) lastOf[e.siteId] = String(e.savedAt);
    });
    shown.sort(function (a, b) {
      return String(lastOf[b.id] || b.createdAt || '').localeCompare(String(lastOf[a.id] || a.createdAt || ''));
    });

    shown.forEach(function (s) {
      var mine = ests.filter(function (e) { return e.siteId === s.id; });
      var sum = mine.reduce(function (a, e) { return a + num(e.total); }, 0);
      var row = el('button', 'site-row'); row.type = 'button';
      var main = el('div', 'est-main');
      main.appendChild(el('b', null, s.name));
      main.appendChild(el('small', null,
        (s.customer || '（お客様名なし）') + (s.address ? '　/　' + s.address : '')));
      row.appendChild(main);
      var right = el('div', 'site-right');
      right.appendChild(el('div', 'est-amount', mine.length ? yen(sum) : '—'));
      right.appendChild(el('small', null, '見積 ' + mine.length + '件'));
      row.appendChild(right);
      row.addEventListener('click', function () { openSiteId = s.id; renderList(); });
      box.appendChild(row);
    });
  }

  function renderSiteDetail() {
    var s = findSite(openSiteId);
    var box = $('#site-detail');
    box.innerHTML = '';

    var head = el('div', 'site-head');
    head.appendChild(el('h2', 'card-title', s.name));
    var sub = [s.customer, s.address, s.tel].filter(Boolean).join('　/　');
    if (sub) head.appendChild(el('p', 'hint', sub));
    box.appendChild(head);

    var acts = el('div', 'card-actions site-acts');
    var mk = el('button', 'btn btn-primary', '＋ この現場で見積を作る'); mk.type = 'button';
    mk.addEventListener('click', function () { newEstimateForSite(s); });
    acts.appendChild(mk);
    box.appendChild(acts);

    box.appendChild(renderSurveyBlock(s));
    box.appendChild(renderPhotoBlock(s));

    var mine = estimatesOf(s.id).sort(function (a, b) {
      return String(b.savedAt).localeCompare(String(a.savedAt));
    });
    box.appendChild(el('div', 'site-sec-label', '見積（' + mine.length + '件）'));
    if (!mine.length) {
      box.appendChild(el('p', 'empty-note', 'まだ見積がありません。'));
      return;
    }
    mine.forEach(function (e) {
      var row = el('div', 'est-row');
      var main = el('div', 'est-main');
      main.appendChild(el('b', null, e.no + '　' + (e.subject || s.name)));
      main.appendChild(el('small', null, jpDate(e.date) + '　/　' + (e.customer || '')));
      row.appendChild(main);
      row.appendChild(el('div', 'est-amount', yen(e.total || 0)));

      var open = el('button', 'btn btn-ghost', '開く'); open.type = 'button';
      open.addEventListener('click', function () { openEstimate(e); });

      var dup = el('button', 'btn btn-ghost', '複製'); dup.type = 'button';
      dup.addEventListener('click', function () {
        var c = clone(e);
        delete c.total; delete c.savedAt;
        c.id = 'e' + Date.now();
        c.no = nextNo();
        c.date = todayISO();
        openEstimate(c, '複製しました');
      });

      var del = el('button', 'btn btn-ghost btn-danger', '削除'); del.type = 'button';
      del.addEventListener('click', function () {
        if (!confirm('この見積を削除します。よろしいですか？\n' + e.no + '　' + (e.customer || ''))) return;
        save(KEY_EST, load(KEY_EST, []).filter(function (x) { return x.id !== e.id; }));
        renderList();
        toast('削除しました');
      });

      var bill = el('button', 'btn btn-ghost', '請求書'); bill.type = 'button';
      bill.title = 'この見積の金額で請求書を作ります';
      bill.addEventListener('click', function () { makeInvoice(e, s); });

      row.appendChild(open); row.appendChild(dup); row.appendChild(bill); row.appendChild(del);
      box.appendChild(row);
    });

    box.appendChild(renderInvoiceBlock(s));
  }

  /* ======================================================================
     請求書
     ----------------------------------------------------------------------
     見積の金額をそのまま引き継いで作る。見積は書き換えないので、
     あとから見積を直しても、出した請求書はそのまま残る。
     ====================================================================== */
  function loadInvoices() { return load(KEY_INV, []); }
  function invoicesOf(siteId) {
    return loadInvoices().filter(function (v) { return v.siteId === siteId; });
  }

  function nextInvoiceNo() {
    var d = todayISO().replace(/-/g, '');
    var n = 1;
    loadInvoices().forEach(function (v) {
      var m = String(v.no || '').match(new RegExp('^' + d + '-(\\d+)$'));
      if (m) n = Math.max(n, Number(m[1]) + 1);
    });
    return d + '-' + ('0' + n).slice(-2);
  }

  function makeInvoice(est, site) {
    if (!(pb.company.name || '').trim()) {
      toast('先に［自社情報］で会社名を登録してください');
      $('.tab[data-view="settings"]').click();
      return;
    }
    var days = prompt('お支払期限を、今日から何日後にしますか？\n（空欄なら期限なし）', '30');
    if (days === null) return;

    var v = clone(est);
    delete v.savedAt;
    v.id = 'v' + Date.now();
    v.no = nextInvoiceNo();
    v.date = todayISO();
    v.doneDate = todayISO();
    v.dueDate = String(days).trim() ? addDays(todayISO(), num(days)) : '';
    v.estimateId = est.id;
    v.estimateNo = est.no;
    // 見積の「※本見積は…」という但し書きは請求書には合わないので引き継がない。
    // 振込先は自社情報から自動で入るので、備考は空でよい。
    v.note = '';
    v.siteId = site.id;
    v.total = calcOf(v).total;
    v.savedAt = new Date().toISOString();

    var list = loadInvoices();
    list.push(v);
    if (save(KEY_INV, list) === false) return;
    renderList();
    toast('請求書 ' + v.no + ' を作りました');
  }

  function renderInvoiceBlock(site) {
    var wrap = el('div', 'inv-block');
    var mine = invoicesOf(site.id).sort(function (a, b) {
      return String(b.savedAt).localeCompare(String(a.savedAt));
    });
    wrap.appendChild(el('div', 'site-sec-label', '請求書（' + mine.length + '件）'));
    if (!mine.length) {
      wrap.appendChild(el('p', 'empty-note', 'まだ請求書はありません。上の見積の［請求書］から作れます。'));
      return wrap;
    }
    mine.forEach(function (v) {
      var row = el('div', 'est-row');
      var main = el('div', 'est-main');
      main.appendChild(el('b', null, v.no + '　' + (v.subject || site.name)));
      main.appendChild(el('small', null,
        '請求日 ' + jpDate(v.date) +
        (v.dueDate ? '　/　支払期限 ' + jpDate(v.dueDate) : '') +
        (v.estimateNo ? '　/　見積 ' + v.estimateNo + ' より' : '')));
      row.appendChild(main);
      row.appendChild(el('div', 'est-amount', yen(v.total || 0)));

      var pr = el('button', 'btn btn-primary', '印刷 / PDF'); pr.type = 'button';
      pr.addEventListener('click', function () { printInvoice(v); });

      var ed = el('button', 'btn btn-ghost', '日付を直す'); ed.type = 'button';
      ed.addEventListener('click', function () { editInvoiceDates(v); });

      var del = el('button', 'btn btn-ghost btn-danger', '削除'); del.type = 'button';
      del.addEventListener('click', function () {
        if (!confirm('請求書 ' + v.no + ' を削除します。よろしいですか？')) return;
        save(KEY_INV, loadInvoices().filter(function (x) { return x.id !== v.id; }));
        renderList();
        toast('削除しました');
      });

      row.appendChild(pr); row.appendChild(ed); row.appendChild(del);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function editInvoiceDates(v) {
    var d1 = prompt('請求日（YYYY-MM-DD）', v.date);
    if (d1 === null) return;
    var d2 = prompt('工事完了日（YYYY-MM-DD／空欄可）', v.doneDate || '');
    if (d2 === null) return;
    var d3 = prompt('お支払期限（YYYY-MM-DD／空欄可）', v.dueDate || '');
    if (d3 === null) return;
    var list = loadInvoices();
    list.forEach(function (x) {
      if (x.id !== v.id) return;
      x.date = d1.trim(); x.doneDate = d2.trim(); x.dueDate = d3.trim();
    });
    save(KEY_INV, list);
    renderList();
    toast('日付を直しました');
  }

  /* ======================================================================
     全データのバックアップ（端末を移すとき用）
     ====================================================================== */
  /**
   * バックアップの中の機種／別売品を数える（読み込む前の確認画面用）。
   * どちらもメーカーごとの束だが、中身を入れている名前が違う。
   *   機種   … packs[].rows   （読み込んだ生のまま）
   *   別売品 … stores[].items
   * 片方だけ見ていると、本物の5,681機種を「0件」と出して人を驚かせる。
   * 2026-09-06、実際にそう出た。どちらの名前も見る。
   */
  function countPackItems(list, legacy) {
    if (Array.isArray(list)) {
      return list.reduce(function (a, p) {
        if (!p) return a;
        if (Array.isArray(p.rows))  return a + p.rows.length;
        if (Array.isArray(p.items)) return a + p.items.length;
        return a;
      }, 0);
    }
    if (legacy && Array.isArray(legacy.rows)) return legacy.rows.length;
    return 0;
  }

  function buildAllData() {
    return {
      type: 'airtec-all',
      version: 1,
      exportedAt: new Date().toISOString(),
      pricebook: pb,
      models: load(KEY_MDL, null),
      /* 別売品は機種データとは別の引き出し（KEY_OPT）に入っている。
         ここに入れ忘れると、書き出して読み込み直したときだけ
         5社1,565品目が黙って消える。2026-09-06 に気づいて足した */
      options: load(KEY_OPT, null),
      sites: loadSites(),
      estimates: load(KEY_EST, []),
      invoices: loadInvoices()
    };
  }

  $('#btn-export-all').addEventListener('click', function () {
    download('空調王-全データ-' + todayISO() + '.json', JSON.stringify(buildAllData()));
    markBackedUp('（ダウンロード）');
    toast('書き出しました');
  });

  /* ---------- かんたんバックアップ ----------
     保存先のファイルを1回決めておくと、次からは上書き保存できる。
     OneDrive の中に置けば、そのままクラウドにも残る。
     （この機能はパソコンのChrome/Edge向け。スマホでは通常のダウンロードになる） */
  var KEY_BK = 'airtec_backup_meta_v1';
  /* 何日空いたら知らせるか。
     iPhoneのSafariは「7日そのサイトを開かないと保存した中身を消す」ので、
     14日待っていては手遅れになる。7日に合わせる。 */
  var BK_DAYS = 7;
  var canPickFile = (typeof window.showSaveFilePicker === 'function');
  var bkHandle = null;

  /* ---------- 端末の側で内容が消える道と、その塞ぎ方 ----------
     1. ブラウザの閲覧データ削除
     2. iPhoneのSafariが7日で消す（Appleの決まり。ホーム画面のアプリは対象外）
     3. 端末の故障・紛失・買い替え
     連動を入れておけばクラウドに写しが残るので、1と3は塞げる。
     2だけはホーム画面に追加してもらうしかない。 */
  var KEY_A2HS = 'airtec_a2hs_hidden_v1';   // 案内を「あとで」した日

  /** ホーム画面から開いているか（Safariのアプリ扱いか） */
  function isStandalone() {
    if (window.navigator.standalone === true) return true;               // iOS
    try { return window.matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; }
  }
  function isIOS() {
    var ua = navigator.userAgent || '';
    // iPadOSはMacintoshと名乗るので、指で触れるかどうかで見分ける
    return /iP(hone|od|ad)/.test(ua) ||
           (/Macintosh/.test(ua) && typeof document.ontouchend !== 'undefined');
  }
  /** 連動が入っているか（入っていればクラウドに写しがある） */
  function syncOn() {
    return !!(window.AirtecSync && window.AirtecSync.isOn && window.AirtecSync.isOn());
  }

  var A2HS_STEPS =
    'iPhone・iPadでの追加のしかた\n\n' +
    '１. Safariの下（または上）にある「共有」ボタンを押す\n' +
    '　　　□ に ↑ の矢印が刺さった絵のボタンです\n' +
    '２. 出てきた一覧を下にたどって「ホーム画面に追加」を押す\n' +
    '３. 右上の「追加」を押す\n\n' +
    'ホーム画面に空調王のアイコンができます。\n' +
    '次からは、そのアイコンから開いてください。\n\n' +
    '※ 大事なこと\n' +
    'ホーム画面のアプリは、Safariとは別の入れ物になることがあります。\n' +
    '空だったときは、先にSafariのほうで［自社情報］→ 連動を始め、\n' +
    'ホーム画面のほうで同じあいことばを入れてください。中身が流れ込みます。';

  function showA2HS() { alert(A2HS_STEPS); }

  function renderA2HS() {
    var bar = $('#a2hs-warn');
    if (!bar) return;
    var hide = load(KEY_A2HS, 0);
    var shownRecently = hide && (Date.now() - hide) < 30 * 86400000;   // 「あとで」は30日黙る
    // iPhoneで、Safariから開いていて、まだ言われていない人にだけ出す
    bar.style.display = (isIOS() && !isStandalone() && !shownRecently) ? '' : 'none';
  }

  /* --------------------------------------------------------------------
     IndexedDB（この端末の中の、大きいものを置ける入れ物）

     localStorage には文字しか入らず、容量も5MBほどしかない。
     そこに入らないものを、ここに置く。棚は2つ。
       kv     … 保存先のファイルハンドル
       photos … 現場写真（写真そのもの＝Blob）
     -------------------------------------------------------------------- */
  var IDB_VER = 2;                 // 棚を増やしたら1つ上げる（増えた棚だけ作られる）
  var idbConn = null;              // 開いた入れ物は使い回す（写真を何十枚も入れるときのため）
  function idbOpen() {
    if (idbConn) return idbConn;
    idbConn = new Promise(function (res, rej) {
      var q = indexedDB.open('airtec', IDB_VER);
      q.onupgradeneeded = function () {
        // すでにある棚は作り直さない（作ろうとするとその場で止まる）
        var db = q.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('photos')) {
          db.createObjectStore('photos', { keyPath: 'id' })
            .createIndex('siteId', 'siteId', { unique: false });
        }
      };
      q.onerror   = function () { rej(q.error); };
      q.onblocked = function () { rej(new Error('別のタブが開いています')); };
      q.onsuccess = function () {
        var db = q.result;
        // 別のタブが棚を増やそうとしたら、こちらは手を離す（次に使うとき開き直す）
        db.onversionchange = function () { db.close(); idbConn = null; };
        db.onclose = function () { idbConn = null; };
        res(db);
      };
    });
    idbConn.catch(function () { idbConn = null; });   // 開けなかったら、次でやり直せるようにする
    return idbConn;
  }
  /** 棚を1つ開いて、その中で1回だけ操作する */
  function idb(store, mode, fn) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        // put() などはその場でエラーを投げることがある。
        // ここで受け止めないと、待っている側が永久に止まってしまう。
        try {
          var tx = db.transaction(store, mode);
          var r = fn(tx.objectStore(store));
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
          tx.onabort = function () { rej(tx.error); };
        } catch (e) { rej(e); }
      });
    });
  }
  function idbSet(k, v) { return idb('kv', 'readwrite', function (s) { return s.put(v, k); }); }
  function idbGet(k) { return idb('kv', 'readonly', function (s) { return s.get(k); }); }

  function bkMeta() { return load(KEY_BK, { lastAt: '', name: '' }); }
  function markBackedUp(name) {
    var m = bkMeta();
    m.lastAt = new Date().toISOString();
    if (name) m.name = name;
    save(KEY_BK, m);
    renderBackupState();
  }
  function daysSinceBackup() {
    var m = bkMeta();
    if (!m.lastAt) return Infinity;
    return (Date.now() - new Date(m.lastAt).getTime()) / 86400000;
  }

  function renderBackupState() {
    var m = bkMeta();
    var t = $('#bk-target'), l = $('#bk-last');
    if (!t) return;
    t.textContent = bkHandle ? (bkHandle.name || m.name || '設定済み')
      : (canPickFile ? 'まだ決めていません' : 'この端末ではダウンロード保存になります');
    l.textContent = m.lastAt
      ? jpDate(m.lastAt.slice(0, 10)) + '（' + Math.floor(daysSinceBackup()) + '日前）' + (m.name ? '　' + m.name : '')
      : 'まだ';
    $('#btn-bk-pick').style.display = canPickFile ? '' : 'none';

    var d = daysSinceBackup();
    var warn = $('#bk-warn');

    /* 連動が入っていれば、書いたそばからクラウドに写しが残る。
       それでも急かすと「またこれか」で読まれなくなるので、黙る。
       守りが1つも無いときだけ、はっきり言う。 */
    if (syncOn()) { warn.style.display = 'none'; renderA2HS(); return; }

    if (d === Infinity || d >= BK_DAYS) {
      $('#bk-warn-text').textContent = (d === Infinity)
        ? 'まだ一度もバックアップしていません。連動も入っていません。' +
          'いまブラウザの閲覧データを消すと、入れた単価も見積もすべて消えます。'
        : Math.floor(d) + '日バックアップしていません（連動も入っていません）。';
      warn.style.display = '';
    } else warn.style.display = 'none';

    renderA2HS();
  }

  async function pickBackupFile() {
    var h;
    try {
      h = await window.showSaveFilePicker({
        suggestedName: '空調王-全データ.json',
        types: [{ description: '空調王のバックアップ', accept: { 'application/json': ['.json'] } }]
      });
    } catch (e) { return; }          // 選ぶのをやめた場合。何もしない
    if (!h) return;

    bkHandle = h;
    var m = bkMeta(); m.name = h.name; save(KEY_BK, m);
    // 保存先の記憶に失敗しても、今回の保存は続ける（次回また選んでもらえばよい）
    var remembered = true;
    try { await idbSet('backupHandle', h); } catch (e) { remembered = false; }
    renderBackupState();
    if (await writeBackup(true)) {
      toast(remembered
        ? '保存先を決めました。次からは「いますぐ保存」だけでOKです'
        : '保存しました（保存先を覚えられなかったので、次回もう一度選んでください）');
    }
  }

  async function writeBackup(silent) {
    if (!bkHandle) {
      // 保存先が無いときは、いつものダウンロードで保存する
      download('空調王-全データ-' + todayISO() + '.json', JSON.stringify(buildAllData()));
      markBackedUp('（ダウンロード）');
      if (!silent) toast('書き出しました');
      return true;
    }
    try {
      var p = await bkHandle.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted') p = await bkHandle.requestPermission({ mode: 'readwrite' });
      if (p !== 'granted') { toast('保存先への書き込みが許可されませんでした'); return false; }
      var w = await bkHandle.createWritable();
      await w.write(JSON.stringify(buildAllData()));
      await w.close();
      markBackedUp(bkHandle.name);
      if (!silent) toast('保存しました（' + bkHandle.name + '）');
      return true;
    } catch (e) {
      toast('保存できませんでした。「保存先を決める」からやり直してください');
      return false;
    }
  }

  /* 連動（sync.js）は app.js のあとに読み込まれる。
     先に警告を描いてしまうと「連動していない」と誤って判断したまま残るので、
     全部そろったところで一度描き直す。 */
  window.addEventListener('load', function () { renderBackupState(); });

  $('#btn-a2hs-how').addEventListener('click', showA2HS);
  $('#btn-a2hs-how2').addEventListener('click', showA2HS);
  $('#btn-a2hs-hide').addEventListener('click', function () {
    save(KEY_A2HS, Date.now());
    $('#a2hs-warn').style.display = 'none';
  });

  $('#btn-bk-pick').addEventListener('click', function () { pickBackupFile(); });
  $('#btn-bk-save').addEventListener('click', function () { writeBackup(false); });
  $('#btn-bk-warn-save').addEventListener('click', function () { writeBackup(false); });
  $('#btn-bk-warn-hide').addEventListener('click', function () { $('#bk-warn').style.display = 'none'; });

  /* --------------------------------------------------------------------
     新しい版が出ていないか、見に行く。

     版番号は app.js?v=… のように「中のファイル」にしか付いていない。
     だから入口の index.html が端末に残っていると、その端末はいつまでも
     古い番号のファイルを取りに行く。スマホでこれが起きると、
     直したものが永久に届かない。気づく手立てが無いのがいちばん困る。

     そこで version.txt（毎回サーバーから取り直す）と見比べて、ちがっていたら
     知らせる。押すとURLに新しい番号を付けて開き直すので、入口ごと新しくなる。
     入れた内容はURLではなくドメインごとに置いてあるので、消えない。
     -------------------------------------------------------------------- */
  var newVersion = '';

  if (location.protocol !== 'file:') {
    fetch('version.txt?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) {
        var v = String(t || '').trim();
        if (!v || v === APP_VERSION) return;
        newVersion = v;
        $('#new-warn').style.display = '';
      })
      .catch(function () { /* 圏外などで取れなくても、いまの画面はそのまま使える */ });
  }

  $('#btn-new-reload').addEventListener('click', function () {
    location.replace(location.pathname + '?v=' + encodeURIComponent(newVersion || Date.now()));
  });

  /* 起動時：保存先が生きていて、しばらく保存していなければ静かに保存しておく */
  async function initBackup() {
    if (canPickFile) {
      try {
        var h = await idbGet('backupHandle');
        if (h) {
          bkHandle = h;
          var p = await h.queryPermission({ mode: 'readwrite' });
          if (p === 'granted' && daysSinceBackup() >= 1) {
            if (await writeBackup(true)) toast('バックアップを保存しました');
          }
        }
      } catch (e) { /* 使えなければ手動保存にまかせる */ }
    }
    renderBackupState();
  }

  $('#file-import-all').addEventListener('change', function (ev) {
    readJSON(ev.target, function (data) {
      if (!data || data.type !== 'airtec-all' || !data.pricebook) {
        toast('「全部まとめて書き出す」で作ったファイルを選んでください');
        return;
      }
      var n = {
        単価: (data.pricebook.categories || []).reduce(function (a, c) { return a + (c.items || []).length; }, 0),
        機種: countPackItems(data.models && data.models.packs, data.models),
        別売品: countPackItems(data.options && data.options.stores, null),
        現場: (data.sites || []).length,
        見積: (data.estimates || []).length,
        請求書: (data.invoices || []).length
      };
      if (!confirm('この端末の内容を、読み込んだファイルで置き換えます。\n\n' +
        '　単価　：' + n.単価 + '件\n' +
        '　機種　：' + n.機種 + '件\n' +
        '　別売品：' + n.別売品 + '件\n' +
        '　現場　：' + n.現場 + '件\n' +
        '　見積　：' + n.見積 + '件\n' +
        '　請求書：' + n.請求書 + '件\n\n' +
        'いまの内容は消えます。よろしいですか？')) return;

      pb = data.pricebook;
      pb.company  = adoptCompany(pb.company);
      pb.defaults = Object.assign({}, DEFAULT_PRICEBOOK.defaults, pb.defaults || {});
      if (!Array.isArray(pb.categories)) pb.categories = [];
      activeCat = pb.categories.length ? pb.categories[0].id : null;
      if (savePB() === false) return;

      if (data.models) save(KEY_MDL, data.models); else removeKey(KEY_MDL);
      /* 別売品を入れ忘れていた頃のバックアップには options が無い。
         そのときは端末に入っている別売品をそのまま残す。
         「無いから消す」にすると、古いファイルを読んだ人の別売品が巻き添えで消える */
      if (data.options) save(KEY_OPT, data.options);
      saveSites(data.sites || []);
      save(KEY_EST, data.estimates || []);
      save(KEY_INV, data.invoices || []);

      openSiteId = null;
      chooserSel = {};
      loadModels();
      renderMaster(); renderPicker(); fillCompany(); renderList();
      renderBackupState();
      toast('読み込みました');
    });
  });

  function printInvoice(v) {
    buildSheet('invoice', v);
    document.title = '請求書_' + (v.customer || '無題') + '_' + v.no;
    setTimeout(function () { window.print(); }, 60);
  }

  /* ======================================================================
     現地調査チェックシート
     ----------------------------------------------------------------------
     項目の中身は survey.js の SURVEY / SURVEY_HEAD。
     入力した内容は、その現場の中（site.survey）に保存する。
     ====================================================================== */

  /* ----------------------------------------------------------------------
     現調シートの記入から、機種選定の条件を読み取る
     ----------------------------------------------------------------------
     現場で書いた紙の内容がそのまま選定に効くようにする。
     ・用途 …… 店舗→一般商店、事務所→一般事務所、飲食は発熱負荷の「厨房」で見る
     ・対象面積・天井高 …… 「120㎡ / 天井高2.7m」のような自由記入から数字を拾う
     ・構造 …… 木造/軽量鉄骨は断熱が弱いほう、RCは強いほうに寄せる
     ・発熱負荷・外気日射 …… チェックをそのまま上乗せに使う
     読み取れなかったものは、選定の画面で人が直せる。
     ---------------------------------------------------------------------- */
  function szFromSurvey(data) {
    data = data || {};
    var arr = function (k) { var v = data[k]; return Array.isArray(v) ? v : (v ? [v] : []); };
    var txt = function (k) { return String(data[k] || ''); };

    // 用途
    var uses = arr('用途').join(' ') + ' ' + txt('建物用途');
    var heat = arr('発熱負荷').join(' ');
    var use = 0;
    if (/厨房|窯/.test(heat) || /飲食|レストラン|食堂/.test(uses)) use = 3;
    else if (/理美容|美容|サロン|喫茶|カフェ/.test(uses)) use = 2;
    else if (/店舗|店/.test(uses)) use = 1;
    else use = 0;

    // 面積と天井高（「120㎡ / 天井高2.7m」など）
    var at = txt('対象面積・天井高');
    var area = szAreaFromText(at);
    var height = 0;
    var mh = at.match(/(?:天井高|天高|高さ)\s*([\d.]+)/);
    if (!mh && !SZ_X.test(at)) mh = at.match(/([\d.]+)\s*m(?!\s*[²2])/i);
    if (mh) height = Number(mh[1]);

    // 構造から断熱を推し量る（あくまで初期値。現場を見て直す）
    var st = arr('構造').join(' ');
    var insul = 0;
    if (/RC|鉄筋/.test(st)) insul = 1;          // 標準的な断熱ありに寄せる
    else if (/木造|軽量鉄骨/.test(st)) insul = 0;
    var age = txt('階数・築年数');
    if (/新築|築\s*[0-9]\s*年|築\s*1[0-4]\s*年/.test(age)) insul = Math.max(insul, 1);

    // 上乗せ
    var sun = arr('外気・日射').join(' ');
    var adds = [];
    if (/西日/.test(sun)) adds.push('west');
    if (/吹抜|吹き抜/.test(sun)) adds.push('glass');
    if (/厨房|窯/.test(heat)) adds.push('kitchen');
    if (/換気量多い|出入口多い/.test(sun)) adds.push('air');
    var people = txt('使用人数').match(/(\d+)/g);
    if (people && area && Math.max.apply(null, people.map(Number)) / area > 0.15) adds.push('people');

    return { use: use, area: area, height: height || 2.7, insul: insul, adds: adds };
  }

  /** 現場に保存されている調査内容を取り出す（無ければ空） */
  function surveyOf(site) { return site.survey || {}; }

  /** 調査内容を書き戻して保存する */
  function saveSurvey(siteId, data) {
    var sites = loadSites();
    var hit = null;
    sites.forEach(function (s) { if (s.id === siteId) hit = s; });
    if (!hit) return;
    hit.survey = data;
    hit.surveyAt = new Date().toISOString();
    saveSites(sites);
  }

  /** 入力済みの項目数を数える（進み具合の表示用） */
  function surveyFilled(data) {
    var n = 0;
    Object.keys(data || {}).forEach(function (k) {
      var v = data[k];
      if (Array.isArray(v)) { if (v.length) n++; }
      else if (String(v || '').trim()) n++;
    });
    return n;
  }

  function surveyTotalFields() {
    var n = SURVEY_HEAD.length;
    SURVEY.forEach(function (s) { s.pairs.forEach(function (p) { n += p.length; }); });
    return n;
  }

  function renderSurveyBlock(site) {
    var wrap = el('div', 'survey-block');
    var data = surveyOf(site);

    // 現場に入っている情報は、調査シートにも先に入れておく（数える前にやる）
    var pre = { '案件名': site.name, 'お客様名': site.customer, '現場住所': site.address, '連絡先': site.tel };
    var filledFromSite = false;
    Object.keys(pre).forEach(function (k) {
      if (!String(data[k] || '').trim() && String(pre[k] || '').trim()) { data[k] = pre[k]; filledFromSite = true; }
    });
    if (filledFromSite) saveSurvey(site.id, data);

    var head = el('div', 'survey-head');
    head.appendChild(el('span', 'site-sec-label', '現地調査チェックシート'));
    var cnt = el('span', 'survey-count', surveyFilled(data) + ' / ' + surveyTotalFields() + ' 項目');
    head.appendChild(cnt);

    var cp = el('button', 'btn btn-ghost btn-sm', 'コピー'); cp.type = 'button';
    cp.title = '現場で入力した内容を文字にします。LINEなどで事務所に送ってください';
    cp.addEventListener('click', function () { copySurvey(site); });
    var ps = el('button', 'btn btn-ghost btn-sm', '貼り付け'); ps.type = 'button';
    ps.title = '送られてきた文字を貼り付けて、このシートに取り込みます';
    ps.addEventListener('click', function () { pasteSurvey(site); });
    head.appendChild(cp); head.appendChild(ps);

    var pr = el('button', 'btn btn-ghost btn-sm', '印刷 / PDF'); pr.type = 'button';
    pr.addEventListener('click', function () { printSurvey(site, false); });
    var bl = el('button', 'btn btn-ghost btn-sm', '白紙で印刷'); bl.type = 'button';
    bl.title = '現場に持っていく用。何も記入されていない状態で印刷します';
    bl.addEventListener('click', function () { printSurvey(site, true); });
    head.appendChild(pr); head.appendChild(bl);
    wrap.appendChild(head);

    function touch() {
      saveSurvey(site.id, data);
      cnt.textContent = surveyFilled(data) + ' / ' + surveyTotalFields() + ' 項目';
    }

    var hd = el('details', 'survey-sec');
    var hs = el('summary', null, '基本情報');
    hd.appendChild(hs);
    var hgrid = el('div', 'survey-grid');
    SURVEY_HEAD.forEach(function (f) {
      hgrid.appendChild(surveyField(f, data, touch));
    });
    hd.appendChild(hgrid);
    wrap.appendChild(hd);

    SURVEY.forEach(function (sec) {
      var d = el('details', 'survey-sec');
      d.appendChild(el('summary', null, sec.sec));
      var grid = el('div', 'survey-grid');
      sec.pairs.forEach(function (pair) {
        pair.forEach(function (f) { grid.appendChild(surveyField(f, data, touch)); });
      });
      d.appendChild(grid);
      wrap.appendChild(d);
    });

    // 現調シートの記入から、必要な能力を出す
    wrap.appendChild(renderSurveySizer(site, data));
    return wrap;
  }

  /* ----------------------------------------------------------------------
     現調シートの中の「必要な能力を出す」
     ----------------------------------------------------------------------
     現場でシートを埋めると、そのまま馬力の目安が出る。
     読み取った値は人が直せる。直したものは現場に覚えておく（site.sizing）。
     出した馬力は［見積を作る］から見積作成へ持っていける。
     ---------------------------------------------------------------------- */
  function renderSurveySizer(site, data) {
    var box = el('details', 'survey-sec sz-sec');
    box.open = true;
    box.appendChild(el('summary', null, '必要な能力を出す（機種選定）'));

    var body = el('div', 'sz-body');
    box.appendChild(body);

    var p = site.sizing || szFromSurvey(data);

    function save() {
      var sites = loadSites();
      sites.forEach(function (s) { if (s.id === site.id) { s.sizing = p; site.sizing = p; } });
      saveSites(sites);
    }

    function draw() {
      body.innerHTML = '';

      var form = el('div', 'sizer-form');
      // 用途
      var fu = el('label', 'f'); fu.appendChild(el('span', null, '用途'));
      var su = document.createElement('select');
      SZ_USES.forEach(function (u, i) {
        var o = document.createElement('option');
        o.value = String(i); o.textContent = u.name + '（' + u.lo + '〜' + u.hi + ' W/m²）';
        su.appendChild(o);
      });
      su.value = String(p.use || 0);
      su.addEventListener('change', function () { p.use = Number(su.value); save(); draw(); });
      fu.appendChild(su); form.appendChild(fu);

      // 広さ
      var fa = el('label', 'f'); fa.appendChild(el('span', null, '広さ（m²）'));
      var ia = document.createElement('input');
      ia.type = 'number'; ia.min = '0'; ia.step = '0.1'; ia.placeholder = '例 120';
      ia.value = p.area ? String(Math.round(p.area * 10) / 10) : '';
      ia.addEventListener('input', function () { p.area = num(ia.value); save(); drawResult(); });
      fa.appendChild(ia); form.appendChild(fa);

      // 天井高
      var fh = el('label', 'f'); fh.appendChild(el('span', null, '天井の高さ（m）'));
      var ih = document.createElement('input');
      ih.type = 'number'; ih.min = '1.8'; ih.max = '8'; ih.step = '0.1';
      ih.value = String(p.height || 2.7);
      ih.addEventListener('input', function () { p.height = num(ih.value); save(); drawResult(); });
      fh.appendChild(ih); form.appendChild(fh);

      // 断熱
      var fi = el('label', 'f'); fi.appendChild(el('span', null, '建物・断熱'));
      var si = document.createElement('select');
      SZ_INSUL.forEach(function (v, i) {
        var o = document.createElement('option');
        o.value = String(i); o.textContent = v.name;
        si.appendChild(o);
      });
      si.value = String(p.insul || 0);
      si.addEventListener('change', function () { p.insul = Number(si.value); save(); drawResult(); });
      fi.appendChild(si); form.appendChild(fi);
      body.appendChild(form);

      /* 寸法から広さを出す
         現場ではメジャーで測るだけ。横と縦を入れれば掛け算も足し算もここでやる。
         L字の部屋は「大きい四角 ＋ 出っ張り」か「大きい四角 － 欠け」で入れる。 */
      if (!Array.isArray(p.rooms)) p.rooms = [];
      if (!p.rooms.length) p.rooms.push({ n: '', w: 0, d: 0, minus: false });
      if (p.unit !== 'cm') p.unit = 'm';

      var meas = el('div', 'sz-meas');
      var mhd = el('div', 'sz-meas-head');
      mhd.appendChild(el('b', null, '寸法から広さを出す'));
      mhd.appendChild(el('span', 'sz-note', '測った横と縦を入れるだけ。掛け算も足し算もこちらでやります'));
      var sunit = document.createElement('select');
      sunit.className = 'sz-unit';
      [['m', 'メートルで入れる'], ['cm', 'センチで入れる']].forEach(function (u) {
        var o = document.createElement('option');
        o.value = u[0]; o.textContent = u[1];
        sunit.appendChild(o);
      });
      sunit.value = p.unit;
      sunit.addEventListener('change', function () {
        // 入れ直さなくていいように、いま入っている数字も単位に合わせて直す
        var k = (p.unit === 'm' && sunit.value === 'cm') ? 100
              : (p.unit === 'cm' && sunit.value === 'm') ? 0.01 : 1;
        if (k !== 1) {
          p.rooms.forEach(function (r) {
            if (num(r.w)) r.w = Math.round(num(r.w) * k * 100) / 100;
            if (num(r.d)) r.d = Math.round(num(r.d) * k * 100) / 100;
          });
        }
        p.unit = sunit.value; save(); drawRows(); syncArea();
      });
      mhd.appendChild(sunit);
      meas.appendChild(mhd);

      var rowsBox = el('div', 'sz-rows');
      meas.appendChild(rowsBox);

      var mfoot = el('div', 'sz-meas-foot');
      var addBtn = el('button', 'btn btn-ghost btn-sm', '＋ 場所を足す');
      addBtn.type = 'button';
      addBtn.title = '部屋がいくつかあるとき、L字の部屋のときに足してください';
      addBtn.addEventListener('click', function () {
        p.rooms.push({ n: '', w: 0, d: 0, minus: false });
        save(); drawRows(); syncArea();
        var last = rowsBox.querySelector('.sz-row:last-child .sz-d');
        if (last) last.focus();
      });
      mfoot.appendChild(addBtn);
      var tot = el('div', 'sz-meas-total');
      mfoot.appendChild(tot);
      var wr = el('button', 'btn btn-ghost btn-sm', 'この広さをシートに書く');
      wr.type = 'button';
      wr.title = '上の「対象面積・天井高」の欄に書き込みます';
      wr.addEventListener('click', function () {
        if (!p.area) return;
        var line = szFmt(p.area) + '㎡ / 天井高' + (p.height || 2.7) + 'm';
        data['対象面積・天井高'] = line;
        saveSurvey(site.id, data);
        var host = box.parentNode || document;
        var inp = host.querySelector('.survey-f[data-k="対象面積・天井高"] input');
        if (inp) inp.value = line;
        wr.textContent = 'シートに書きました';
        setTimeout(function () { wr.textContent = 'この広さをシートに書く'; }, 1600);
      });
      mfoot.appendChild(wr);
      meas.appendChild(mfoot);
      body.appendChild(meas);

      /** 1行ぶんの数字の入れ物。打っている間に作り直すと文字が消えるので、
          入力中は行の中の答えと合計だけを書き換える */
      function measInput(r, key, eq) {
        var i = document.createElement('input');
        i.type = 'number'; i.min = '0'; i.step = '0.01';
        i.className = 'sz-d'; i.inputMode = 'decimal';
        i.placeholder = (p.unit === 'cm') ? '例 820' : '例 8.2';
        i.value = r[key] ? String(r[key]) : '';
        i.addEventListener('input', function () {
          r[key] = num(i.value);
          eq.textContent = '＝ ' + szFmt(szRoomArea(r, p.unit)) + ' m²';
          syncArea();
        });
        return i;
      }

      function drawRows() {
        rowsBox.innerHTML = '';
        p.rooms.forEach(function (r, idx) {
          var row = el('div', 'sz-row' + (r.minus ? ' sz-row-minus' : ''));

          var nm = document.createElement('input');
          nm.type = 'text'; nm.className = 'sz-nm';
          nm.placeholder = '場所（例 事務所）';
          nm.value = r.n || '';
          nm.addEventListener('input', function () { r.n = nm.value; save(); });
          row.appendChild(nm);

          var eq = el('span', 'sz-eq', '＝ ' + szFmt(szRoomArea(r, p.unit)) + ' m²');
          row.appendChild(el('span', 'sz-lab', '横'));
          row.appendChild(measInput(r, 'w', eq));
          row.appendChild(el('span', 'sz-x', '×'));
          row.appendChild(el('span', 'sz-lab', '縦'));
          row.appendChild(measInput(r, 'd', eq));
          row.appendChild(eq);

          var pm = el('button', 'btn btn-ghost btn-sm sz-pm', r.minus ? 'ひく' : 'たす');
          pm.type = 'button';
          pm.title = '出っ張りは「たす」、欠けている所は「ひく」にしてください';
          pm.addEventListener('click', function () {
            r.minus = !r.minus; save(); drawRows(); syncArea();
          });
          row.appendChild(pm);

          if (p.rooms.length > 1) {
            var del = el('button', 'btn btn-ghost btn-sm sz-del', '✕');
            del.type = 'button'; del.title = 'この行を消す';
            del.setAttribute('aria-label', (idx + 1) + '行目を消す');
            del.addEventListener('click', function () {
              p.rooms.splice(idx, 1); save(); drawRows(); syncArea();
            });
            row.appendChild(del);
          }
          rowsBox.appendChild(row);
        });
      }

      /** 行の合計を「広さ」の欄に流し込む。1行でも数字が入っていれば、そちらが正。
          quiet は最初に見た目をそろえるだけのとき（まだ結果の欄を作っていない） */
      function syncArea(quiet) {
        var any = p.rooms.some(function (r) { return num(r.w) > 0 && num(r.d) > 0; });
        var sum = any ? szRoomsArea(p.rooms, p.unit) : 0;
        if (any && sum > 0) {
          p.area = sum;
          ia.value = szFmt(sum);
          tot.textContent = '合計 ' + szFmt(sum) + ' m²（約 ' + szTsubo(sum) + ' 坪）';
          tot.classList.remove('sz-warn');
        } else if (any) {
          tot.textContent = 'ひく方が大きくなっています。「たす／ひく」を見直してください';
          tot.classList.add('sz-warn');
        } else {
          tot.textContent = '';
          tot.classList.remove('sz-warn');
        }
        wr.style.display = (any && sum > 0) ? '' : 'none';
        if (!quiet) { save(); drawResult(); }
      }

      drawRows();
      syncArea(true);

      // 上乗せ
      var checks = el('div', 'sizer-checks');
      SZ_ADDS.forEach(function (a) {
        var lab = el('label', 'sz-check');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = (p.adds || []).indexOf(a.key) >= 0;
        cb.addEventListener('change', function () {
          p.adds = (p.adds || []).filter(function (k) { return k !== a.key; });
          if (cb.checked) p.adds.push(a.key);
          save(); drawResult();
        });
        lab.appendChild(cb);
        lab.appendChild(el('span', null, a.name));
        checks.appendChild(lab);
      });
      body.appendChild(checks);

      var re = el('button', 'btn btn-ghost btn-sm', 'シートから読み直す');
      re.type = 'button';
      re.title = '上のチェックシートの記入内容から、もう一度読み取ります';
      re.addEventListener('click', function () { p = szFromSurvey(data); save(); draw(); });
      body.appendChild(re);

      var res = el('div', 'sizer-result');
      body.appendChild(res);

      function drawResult() {
        res.innerHTML = '';
        var r = szCalc(p);
        if (!r.ok) {
          res.appendChild(el('div', 'sz-empty', '広さを入れると、必要な能力の目安が出ます。'));
          return;
        }
        var head = el('div', 'sz-head');
        head.appendChild(el('b', null, '必要な能力の目安　' + r.mid.toFixed(1) + ' kW'));
        head.appendChild(el('span', 'sz-range', '（' + r.lo.toFixed(1) + '〜' + r.hi.toFixed(1) + ' kW の幅）'));
        res.appendChild(head);

        var rec = el('div', 'sz-pick');
        rec.appendChild(el('b', null, 'P' + r.form[0] + '形（' + r.form[1] + '馬力・' + (r.form[0] / 10).toFixed(1) + 'kW）'));
        if (r.formHi[0] !== r.form[0]) {
          rec.appendChild(el('span', null, '　※負荷が重いほうに振れるなら P' + r.formHi[0] + '形（' + r.formHi[1] + '馬力）'));
        }
        res.appendChild(rec);

        var why = el('div', 'sz-why');
        why.appendChild(el('span', null, '広さ ' + r.area.toFixed(1) + ' m² × ' + r.use.lo + '〜' + r.use.hi + ' W/m²'));
        if (r.insul.k !== 1) why.appendChild(el('span', null, '／断熱 ×' + r.insul.k.toFixed(2)));
        if (r.hk > 1) why.appendChild(el('span', null, '／天井 ' + r.height + 'm ×' + r.hk.toFixed(2)));
        if (r.addNames.length) why.appendChild(el('span', null, '／' + r.addNames.join('・') + ' ×' + r.addK.toFixed(2)));
        res.appendChild(why);

        var found = szFindModels(r.form);
        if (found) {
          if (found.moved) {
            res.appendChild(el('div', 'sz-why', 'P' + r.form[0] + '形は入っている機種データに無いので、1つ上の P' + found.form[0] + '形（' + found.form[1] + '馬力）で探します。'));
          }
          var go = el('button', 'btn btn-primary btn-sm', 'この馬力（' + found.form[1] + '馬力）で見積を作る　' + found.count + '件');
          go.type = 'button';
          go.addEventListener('click', function () {
            // この現場の情報を引き継いで見積を始め、その馬力で機器を選べる状態にする
            newEstimateForSite(site);
            chooserSel = { hp: found.form[1] };
            renderChooser();
            var c = $('#chooser');
            if (c) setTimeout(function () { c.scrollIntoView({ block: 'start' }); }, 150);
            toast(found.form[1] + '馬力で機器を選べます');
          });
          res.appendChild(go);
        } else if (models) {
          res.appendChild(el('div', 'sz-why', 'この馬力に合う機種が、入っている機種データにありません。'));
        }

        var note = el('div', 'sz-note');
        note.appendChild(el('span', null,
          '用途の負荷と断熱の倍率はカタログの数字です。天井の高さと上のチェックは、' +
          'カタログに数字が無いので設計の考え方から置いた目安です。最後は現場を見て決めてください。'));
        res.appendChild(note);
      }

      drawResult();
    }

    draw();
    return box;
  }

  /** 1項目分の入力欄を作る */
  function surveyField(f, data, touch) {
    var box = el('div', 'survey-f' + (f.t === 'memo' ? ' survey-f-wide' : ''));
    box.setAttribute('data-k', f.k);   // 下の機種選定から書き戻すときの目印
    box.appendChild(el('span', 'survey-k', f.k));

    if (f.t === 'check' || f.t === 'checktext') {
      if (!Array.isArray(data[f.k])) data[f.k] = [];
      var opts = el('div', 'survey-opts');
      f.o.forEach(function (o) {
        var lab = el('label', 'survey-chk');
        var cb = el('input'); cb.type = 'checkbox';
        cb.checked = data[f.k].indexOf(o) >= 0;
        cb.addEventListener('change', function () {
          var i = data[f.k].indexOf(o);
          if (cb.checked && i < 0) data[f.k].push(o);
          if (!cb.checked && i >= 0) data[f.k].splice(i, 1);
          touch();
        });
        lab.appendChild(cb);
        lab.appendChild(el('span', null, o));
        opts.appendChild(lab);
      });
      box.appendChild(opts);
      if (f.t === 'checktext') {
        var k2 = f.k + '_memo';
        var ti = el('input', 'survey-sub'); ti.type = 'text';
        ti.placeholder = f.ph || ''; ti.value = data[k2] || '';
        ti.addEventListener('input', function () { data[k2] = ti.value; touch(); });
        box.appendChild(ti);
      }
      return box;
    }

    if (f.t === 'memo') {
      var ta = el('textarea'); ta.rows = 2; ta.value = data[f.k] || '';
      ta.addEventListener('input', function () { data[f.k] = ta.value; touch(); });
      box.appendChild(ta);
      return box;
    }

    var inp = el('input'); inp.type = (f.t === 'date' ? 'date' : 'text');
    inp.placeholder = f.ph || ''; inp.value = data[f.k] || '';
    inp.addEventListener('input', function () { data[f.k] = inp.value; touch(); });
    box.appendChild(inp);
    return box;
  }

  /* ---------- 現調シートの受け渡し（現場のスマホ → 事務所のPC） ----------
     LINEなどに貼れるよう、読んで分かる文字にする。
     同じ形式をそのまま読み戻せるので、ファイルのやりとりが要らない。 */

  /** 項目名から定義を引けるようにした一覧を作る */
  function surveyFieldMap() {
    var map = {};
    SURVEY_HEAD.forEach(function (f) { map[f.k] = f; });
    SURVEY.forEach(function (s) {
      s.pairs.forEach(function (p) { p.forEach(function (f) { map[f.k] = f; }); });
    });
    return map;
  }

  var SURVEY_MARK = '【空調王】現調シート';

  function surveyToText(site) {
    var live = findSite(site.id) || site;
    var data = surveyOf(live);
    var out = [SURVEY_MARK, '現場: ' + (live.name || ''), ''];

    function push(f) {
      var v = data[f.k];
      if (f.t === 'check' || f.t === 'checktext') {
        if (Array.isArray(v) && v.length) out.push(f.k + ': ' + v.join(', '));
        var m = data[f.k + '_memo'];
        if (String(m || '').trim()) out.push(f.k + '(記入): ' + m);
      } else if (String(v || '').trim()) {
        out.push(f.k + ': ' + v);
      }
    }
    out.push('■ 基本情報');
    SURVEY_HEAD.forEach(push);
    SURVEY.forEach(function (s) {
      var before = out.length;
      out.push('', '■ ' + s.sec);
      s.pairs.forEach(function (p) { p.forEach(push); });
      if (out.length === before + 2) out.length = before;   // 何も無いセクションは出さない
    });
    return out.join('\n');
  }

  function textToSurvey(text) {
    if (String(text).indexOf(SURVEY_MARK) < 0) return null;
    var map = surveyFieldMap();
    var data = {};
    var lastKey = null;
    String(text).split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^([^:：]+)[:：][ 　]?(.*)$/);
      var key = m ? m[1].trim() : null;
      var memo = key && /\(記入\)$/.test(key);
      var base = memo ? key.replace(/\(記入\)$/, '') : key;

      if (key && map[base]) {
        var f = map[base];
        if (memo) { data[base + '_memo'] = m[2]; lastKey = base + '_memo'; }
        else if (f.t === 'check' || f.t === 'checktext') {
          data[base] = m[2].split(/[,、]/).map(function (x) { return x.trim(); })
            .filter(function (x) { return f.o.indexOf(x) >= 0; });
          lastKey = null;
        } else { data[base] = m[2]; lastKey = base; }
        return;
      }
      // 「見出し: 値」の形でない行は、直前の自由記入の続きとみなす（複数行メモ用）
      if (lastKey && line.trim() && !/^■/.test(line) && !/^現場: /.test(line) && line !== SURVEY_MARK) {
        data[lastKey] = (data[lastKey] || '') + '\n' + line;
      }
    });
    return data;
  }

  function copySurvey(site) {
    var txt = surveyToText(site);
    function done() { toast('コピーしました。LINEなどに貼り付けて送ってください'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt, done); });
    } else fallbackCopy(txt, done);
  }

  function fallbackCopy(txt, done) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { prompt('この文字をコピーして送ってください', txt); }
    document.body.removeChild(ta);
  }

  /* 現場一覧から貼り付けたとき。文字の中の「現場: ○○」を見て、
     同じ名前の現場が無ければ作ってから取り込む（スマホで作った現場をPCに持ってくる用） */
  $('#btn-paste-survey').addEventListener('click', function () {
    var txt = prompt('現場から送られてきた文字を貼り付けて OK を押してください。\n' +
      '同じ名前の現場が無ければ、新しく作ります。');
    if (txt === null) return;
    var data = textToSurvey(txt);
    if (!data) { toast('現調シートの文字ではないようです'); return; }
    var n = surveyFilled(data);
    if (!n) { toast('中身が読み取れませんでした'); return; }

    var m = String(txt).match(/^現場:[ 　]?(.+)$/m);
    var name = (m ? m[1] : '').trim() || String(data['案件名'] || '').trim();
    if (!name) { toast('現場名が読み取れませんでした'); return; }

    var sites = loadSites();
    var hit = null;
    sites.forEach(function (s) { if (s.name === name) hit = s; });

    if (!confirm(hit
      ? '現場「' + name + '」の現調シートを、' + n + '項目の内容で置き換えます。よろしいですか？'
      : '現場「' + name + '」を新しく作って、' + n + '項目の現調シートを入れます。よろしいですか？')) return;

    if (!hit) {
      hit = {
        id: 's' + Date.now() + Math.floor(Math.random() * 1000),
        name: name,
        customer: String(data['お客様名'] || '').trim(),
        honorific: '御中',
        address: String(data['現場住所'] || '').trim(),
        tel: String(data['連絡先'] || '').trim(),
        memo: '',
        createdAt: new Date().toISOString()
      };
      sites.push(hit);
      if (saveSites(sites) === false) return;
    }
    saveSurvey(hit.id, data);
    openSiteId = hit.id;
    renderList();
    toast(n + '項目を取り込みました（' + name + '）');
  });

  function pasteSurvey(site) {
    var txt = prompt('送られてきた文字を貼り付けて OK を押してください。\n' +
      '（このシートの内容は置き換わります）');
    if (txt === null) return;
    var data = textToSurvey(txt);
    if (!data) { toast('現調シートの文字ではないようです'); return; }
    var n = surveyFilled(data);
    if (!n) { toast('中身が読み取れませんでした'); return; }
    if (!confirm(n + '項目を読み取りました。\nこの現場の現調シートを置き換えます。よろしいですか？')) return;
    saveSurvey(site.id, data);
    renderList();
    toast(n + '項目を取り込みました');
  }

  /* ======================================================================
     現場写真
     ----------------------------------------------------------------------
     撮った写真を、その現場にぶら下げて残す。

     写真は1枚が数MBある。localStorage（5MB）にも、連動の1MBにも入らない。
     そこで写真そのものは IndexedDB（この端末の中）に置き、
     「何を撮ったか」の印だけを現調シートの［写真］の欄に書き戻す。
     印は現場の中身なので、連動しているもう一方の端末にも届く。

     撮った写真はそのままでは大きすぎるので、長いほうの辺を1600pxに縮めて
     JPEGにし直してから入れる。紙に印刷するにはこれで十分足りる。
     ====================================================================== */
  var PHOTO_KINDS = ['全景', '銘板', '配管', '電源', '搬入経路', 'その他'];
  var PHOTO_MAX = 1600;      // 長いほうの辺（これより大きい写真は縮める）
  var PHOTO_Q   = 0.72;      // JPEGの画質
  /* 1枚の大きさの上限。連動は1件あたり約1MBまでしか預けられず、
     暗号にすると3割ほど太る。420KBに収めておけば必ず入る。 */
  var PHOTO_BYTES = 420000;
  /* 上限に入らなかったときに、順にゆるめていく組み合わせ */
  var PHOTO_STEPS = [
    { max: PHOTO_MAX, q: PHOTO_Q },
    { max: PHOTO_MAX, q: 0.60 },
    { max: 1280,      q: 0.60 },
    { max: 1024,      q: 0.55 }
  ];

  function photoPut(rec)   { return idb('photos', 'readwrite', function (s) { return s.put(rec); }); }
  function photoDel(id)    { return idb('photos', 'readwrite', function (s) { return s.delete(id); }); }
  function photoAll()      { return idb('photos', 'readonly',  function (s) { return s.getAll(); }); }
  function photoGet(id)    { return idb('photos', 'readonly',  function (s) { return s.get(id); }); }

  /**
   * 「この端末で写真をいじった」と連動に知らせる。
   * 連動から届いた写真を入れるときは呼ばない（呼ぶと送り返してしまう）。
   */
  function photosChanged() {
    if (window.AirtecSync) window.AirtecSync.changed('photos');
  }
  function photosOf(siteId) {
    return idb('photos', 'readonly', function (s) { return s.index('siteId').getAll(siteId); })
      .then(function (list) {
        return (list || []).sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
      });
  }

  /**
   * 写真を読み込む。
   * iPhoneで撮った写真は「横向きのまま記録して、正しい向きは別に書いてある」ことがある。
   * from-image と伝えないと、canvas に描いたとたん横倒しになる。
   */
  function loadBitmap(src) {
    if (window.createImageBitmap) {
      return createImageBitmap(src, { imageOrientation: 'from-image' })
        .catch(function () { return createImageBitmap(src); })
        .catch(function () { return loadViaImg(src); });
    }
    return loadViaImg(src);
  }
  function loadViaImg(src) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(src);
      var im = new Image();
      im.onload  = function () { URL.revokeObjectURL(url); res(im); };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('画像として読めません')); };
      im.src = url;
    });
  }

  /** 決めた寸法・画質で1枚のJPEGを作る。turn を渡すとその角度だけ回してから描く */
  function encodeAt(img, turn, maxSide, q) {
    var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    var dw = Math.round(img.width * scale), dh = Math.round(img.height * scale);
    turn = ((turn || 0) % 360 + 360) % 360;
    var sideways = (turn === 90 || turn === 270);
    var cv = document.createElement('canvas');
    cv.width  = sideways ? dh : dw;
    cv.height = sideways ? dw : dh;
    var cx = cv.getContext('2d');
    cx.translate(cv.width / 2, cv.height / 2);
    if (turn) cx.rotate(turn * Math.PI / 180);
    cx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    return new Promise(function (res, rej) {
      cv.toBlob(function (b) {
        if (b) res({ blob: b, w: cv.width, h: cv.height });
        else rej(new Error('画像を作れませんでした'));
      }, 'image/jpeg', q);
    });
  }

  /**
   * 写真を縮めてJPEGにする。turn を渡すとその角度だけ回してから作り直す。
   * 上限（PHOTO_BYTES）に入るまで、画質→寸法の順にゆるめる。
   * ここで必ず収めておかないと、連動に乗せられない1枚ができてしまう。
   */
  function shrinkImage(src, turn, steps) {
    steps = steps || PHOTO_STEPS;
    return loadBitmap(src).then(function (img) {
      function attempt(i) {
        return encodeAt(img, turn, steps[i].max, steps[i].q).then(function (r) {
          if (r.blob.size <= PHOTO_BYTES || i >= steps.length - 1) return r;
          return attempt(i + 1);
        });
      }
      return attempt(0).then(function (r) {
        if (img.close) img.close();
        return r;
      }, function (e) {
        if (img.close) img.close();
        throw e;
      });
    });
  }

  function photoSizeText(list) {
    var mb = list.reduce(function (a, p) { return a + num(p.size); }, 0) / 1048576;
    return mb < 0.1 ? '' : mb.toFixed(1) + 'MB';
  }

  /* 画面に出している写真の一時アドレス。作り直すたびに古いものを返しておく */
  var photoUrls = [];
  function freePhotoUrls() {
    photoUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    photoUrls = [];
  }
  function photoUrl(blob) {
    var u = URL.createObjectURL(blob);
    photoUrls.push(u);
    return u;
  }

  /** 選んだ（撮った）写真を、この現場に入れる */
  function addPhotos(site, kind, files, after) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    toast(list.length + '枚を取り込んでいます…');

    var ok = 0, ng = 0, full = false;
    var chain = Promise.resolve();
    list.forEach(function (f) {
      chain = chain.then(function () {
        if (!/^image\//.test(f.type)) { ng++; return; }
        return shrinkImage(f, 0).then(function (r) {
          return photoPut({
            id: 'ph' + Date.now() + Math.floor(Math.random() * 100000),
            siteId: site.id,
            kind: kind,
            memo: '',
            at: new Date().toISOString(),
            w: r.w, h: r.h, size: r.blob.size,
            blob: r.blob
          });
        }).then(function () { ok++; }, function (e) {
          ng++;
          if (e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message || '')))) full = true;
        });
      });
    });

    chain.then(function () {
      photosChanged();
      if (after) after();
      if (full) toast('端末の空きが足りません。いらない写真を消してからやり直してください');
      else if (ng) toast(ok + '枚を入れました（' + ng + '枚は取り込めませんでした）');
      else toast(ok + '枚を入れました');
    });
  }

  /**
   * 撮った種類を、現調シートの［写真］の欄に印として書き戻す。
   * 写真そのものは端末に残るが、何を撮ったかは連動でもう一方の端末にも届く。
   * 1枚も入れていないうちは触らない（紙だけで使っている人の印を消さないため）。
   */
  function syncPhotoCheck(siteId, list) {
    if (!list || !list.length) return;
    var live = findSite(siteId);
    if (!live) return;
    var f = surveyFieldMap()['写真'];
    var allow = (f && f.o) ? f.o : [];
    var has = {};
    list.forEach(function (p) { has[p.kind] = true; });
    var kinds = allow.filter(function (k) { return has[k]; });
    var data = surveyOf(live);
    var cur = Array.isArray(data['写真']) ? data['写真'] : [];
    if (cur.join('|') === kinds.join('|')) return;      // 変わっていなければ保存しない
    data['写真'] = kinds;
    saveSurvey(live.id, data);
  }

  function renderPhotoBlock(site) {
    var wrap = el('div', 'photo-block');

    var head = el('div', 'survey-head');
    head.appendChild(el('span', 'site-sec-label', '現場写真'));
    var cnt = el('span', 'survey-count', '');
    head.appendChild(cnt);
    wrap.appendChild(head);

    /* --------------------------------------------------------------------
       2026-09-06、実機で確かめた。
       iPhoneのSafariで［写真を撮る］を選んで撮った写真は、
       iPhoneの写真アプリには残らない。空調王の中の1枚きりになる。
       いつものカメラで撮ってから［フォトライブラリ］で選べば、両方に残る。
       押す場所のすぐそばで知らせないと、気づくのは無くしたあとになる。
       -------------------------------------------------------------------- */
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      wrap.appendChild(el('p', 'photo-warn',
        'その場で［写真を撮る］と、その写真はスマホの写真アプリには残りません（空調王の中だけになります）。' +
        'あとで見返したい写真は、先にいつものカメラで撮ってから［フォトライブラリ］を選んでください。'));
    }

    var pick = el('div', 'photo-pick');
    PHOTO_KINDS.forEach(function (k) {
      var lab = el('label', 'btn btn-ghost btn-sm file-btn', '＋ ' + k);
      lab.title = k + 'の写真を撮るか、写真から選びます';
      var inp = el('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
      inp.addEventListener('change', function () {
        // 先に写しを取る。inp.value を空にすると inp.files も同時に空になるので、
        // 参照のまま渡すと1枚も入らない
        var files = Array.prototype.slice.call(inp.files || []);
        inp.value = '';                    // 同じ写真をもう一度選べるようにする
        addPhotos(site, k, files, function () { drawPhotos(site, grid, cnt); });
      });
      lab.appendChild(inp);
      pick.appendChild(lab);
    });
    wrap.appendChild(pick);

    var grid = el('div', 'photo-grid');
    wrap.appendChild(grid);

    wrap.appendChild(el('p', 'hint photo-note',
      '写真はこの端末の中だけに残ります（見積の連動には乗りません）。' +
      '端末を替えるときは［設定］の「写真を書き出す」で持ち出してください。' +
      '［印刷 / PDF］を押すと、現調シートのうしろに写真のページが付きます。'));

    drawPhotos(site, grid, cnt);
    return wrap;
  }

  function drawPhotos(site, grid, cnt) {
    photosOf(site.id).then(function (list) {
      freePhotoUrls();
      grid.innerHTML = '';
      var sz = photoSizeText(list);
      cnt.textContent = list.length + '枚' + (sz ? '　' + sz : '');
      syncPhotoCheck(site.id, list);

      if (!list.length) {
        grid.appendChild(el('p', 'empty-note',
          'まだ写真がありません。上のボタンを押すと、その場で撮るか、写真から選べます。'));
        return;
      }

      list.forEach(function (p, i) {
        var cell = el('div', 'photo-cell');

        var im = el('img');
        im.src = photoUrl(p.blob);
        im.alt = p.kind || '写真';
        // loading="lazy" は付けない。写真は端末の中にあるので待つ必要がなく、
        // 「画面に入るまで読まない」ぶん、かえって白いままになることがある
        im.addEventListener('click', function () { openPhotoView(list, i); });
        cell.appendChild(im);

        var bar = el('div', 'photo-bar');
        var sel = el('select', 'photo-kind');
        PHOTO_KINDS.forEach(function (k) {
          var o = el('option', null, k);
          o.value = k;
          if (k === p.kind) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
          p.kind = sel.value;
          photoPut(p).then(function () { photosChanged(); drawPhotos(site, grid, cnt); });
        });
        bar.appendChild(sel);

        var rot = el('button', 'btn btn-ghost btn-sm', '回転'); rot.type = 'button';
        rot.title = '横向きに写っているときに押してください';
        rot.addEventListener('click', function () {
          rot.disabled = true;
          shrinkImage(p.blob, 90).then(function (r) {
            p.blob = r.blob; p.w = r.w; p.h = r.h; p.size = r.blob.size;
            return photoPut(p);
          }).then(function () { photosChanged(); drawPhotos(site, grid, cnt); },
                  function () { rot.disabled = false; toast('回転できませんでした'); });
        });
        bar.appendChild(rot);

        var del = el('button', 'btn btn-ghost btn-sm btn-danger', '削除'); del.type = 'button';
        del.addEventListener('click', function () {
          if (!confirm('この写真を削除します。よろしいですか？')) return;
          photoDel(p.id).then(function () {
            photosChanged();
            drawPhotos(site, grid, cnt);
            toast('削除しました');
          });
        });
        bar.appendChild(del);
        cell.appendChild(bar);

        var memo = el('input', 'photo-memo');
        memo.type = 'text';
        memo.value = p.memo || '';
        memo.placeholder = '覚え書き';
        memo.title = '写真の説明。印刷したときに写真の下に出ます（例：室外機の裏、サビあり）';
        memo.addEventListener('change', function () {
          p.memo = memo.value;
          photoPut(p).then(photosChanged);
        });
        cell.appendChild(memo);

        grid.appendChild(cell);
      });
    }, function () {
      grid.innerHTML = '';
      grid.appendChild(el('p', 'empty-note', '写真を読み出せませんでした。'));
    });
  }

  /** 写真を大きく見る */
  function openPhotoView(list, idx) {
    var box = el('div', 'photo-view');
    var im = el('img');
    var cap = el('div', 'photo-view-cap');
    var url = '';

    function show(i) {
      idx = (i + list.length) % list.length;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(list[idx].blob);
      im.src = url;
      var p = list[idx];
      cap.textContent = (idx + 1) + ' / ' + list.length + '　' +
        (p.kind || '') + (p.memo ? '　' + p.memo : '');
    }
    function close() {
      if (url) URL.revokeObjectURL(url);
      document.removeEventListener('keydown', onKey);
      if (box.parentNode) box.parentNode.removeChild(box);
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') show(idx + 1);
      else if (e.key === 'ArrowLeft')  show(idx - 1);
    }

    var prev = el('button', 'photo-nav photo-prev', '‹'); prev.type = 'button';
    var next = el('button', 'photo-nav photo-next', '›'); next.type = 'button';
    var shut = el('button', 'photo-close', '閉じる');     shut.type = 'button';
    prev.addEventListener('click', function (e) { e.stopPropagation(); show(idx - 1); });
    next.addEventListener('click', function (e) { e.stopPropagation(); show(idx + 1); });
    shut.addEventListener('click', close);
    box.addEventListener('click', function (e) { if (e.target === box || e.target === im) close(); });
    document.addEventListener('keydown', onKey);

    box.appendChild(im); box.appendChild(cap);
    if (list.length > 1) { box.appendChild(prev); box.appendChild(next); }
    box.appendChild(shut);
    document.body.appendChild(box);
    show(idx);
  }

  /* ---------- 写真の持ち出し・持ち込み ----------
     写真は全データのバックアップには入れない（毎日の上書き保存が重くなるため）。
     端末を替えるときだけ、この専用のファイルで運ぶ。 */
  function blobToDataUrl(b) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload  = function () { res(String(r.result)); };
      r.onerror = function () { rej(r.error); };
      r.readAsDataURL(b);
    });
  }
  function dataUrlToBlob(d) {
    var m = String(d || '').match(/^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/i);
    if (!m) return null;
    var bin = atob(m[2]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] });
  }

  $('#btn-export-photos').addEventListener('click', function () {
    photoAll().then(function (list) {
      list = list || [];
      if (!list.length) { toast('写真がまだありません'); return; }
      var names = {};
      loadSites().forEach(function (s) { names[s.id] = s.name; });
      return Promise.all(list.map(function (p) {
        return blobToDataUrl(p.blob).then(function (d) {
          return {
            id: p.id, siteId: p.siteId, siteName: names[p.siteId] || '',
            kind: p.kind, memo: p.memo, at: p.at, w: p.w, h: p.h, data: d
          };
        });
      })).then(function (rows) {
        download('空調王-現場写真-' + todayISO() + '.json', JSON.stringify({
          type: 'airtec-photos', version: 1,
          exportedAt: new Date().toISOString(),
          photos: rows
        }));
        toast(rows.length + '枚を書き出しました');
      });
    }).catch(function () { toast('書き出せませんでした'); });
  });

  $('#file-import-photos').addEventListener('change', function (ev) {
    readJSON(ev.target, function (data) {
      if (!data || data.type !== 'airtec-photos' || !Array.isArray(data.photos)) {
        toast('「写真を書き出す」で作ったファイルを選んでください');
        return;
      }
      var sites = loadSites();
      var byId = {}, byName = {};
      sites.forEach(function (s) { byId[s.id] = s; byName[s.name] = s; });

      var rows = [], lost = 0;
      data.photos.forEach(function (p) {
        var site = byId[p.siteId] || byName[p.siteName];      // 現場が作り直されていても名前で拾う
        var blob = dataUrlToBlob(p.data);
        if (!site || !blob) { lost++; return; }
        rows.push({
          id: p.id, siteId: site.id, kind: p.kind || 'その他', memo: p.memo || '',
          at: p.at || new Date().toISOString(), w: p.w, h: p.h, size: blob.size, blob: blob
        });
      });
      if (!rows.length) { toast('入れられる写真がありませんでした（先に現場を読み込んでください）'); return; }
      if (!confirm(rows.length + '枚をこの端末に入れます。\n' +
        (lost ? '（' + lost + '枚は、行き先の現場が無いので入れません）\n' : '') +
        '同じ写真がすでにあれば上書きします。よろしいですか？')) return;

      var chain = Promise.resolve(), ok = 0, ng = 0;
      rows.forEach(function (r) {
        chain = chain.then(function () {
          return photoPut(r).then(function () { ok++; }, function () { ng++; });
        });
      });
      chain.then(function () {
        photosChanged();
        renderList();
        toast(ok + '枚を入れました' + (ng ? '（' + ng + '枚は入りませんでした）' : ''));
      });
    });
  });

  /* ----------------------------------------------------------------------
     連動（sync.js）から写真を出し入れするための窓口
     ----------------------------------------------------------------------
     写真は IndexedDB の中にあって sync.js からは触れない。
     暗号のカギは sync.js の中にあって app.js からは触れない。
     そこで「写真そのもの」だけをここでやり取りする。
     持ち運ぶ形は data:image/jpeg;base64,… の文字列（JSONに入れられる形）。

     大事なきまり：ここから入れた写真では photosChanged() を呼ばない。
     呼ぶと「この端末で撮った」ことになって、もらった写真を送り返してしまう。
     ---------------------------------------------------------------------- */
  function photoMeta(p) {
    return {
      id: p.id, siteId: p.siteId, kind: p.kind, memo: p.memo || '',
      at: p.at, w: p.w, h: p.h, size: p.size
    };
  }

  window.AirtecPhotos = {
    /** 写真そのものは付けずに、一覧だけ返す */
    list: function () {
      return photoAll().then(function (rows) { return (rows || []).map(photoMeta); });
    },

    /** 1枚を、持ち運べる形にして返す */
    get: function (id) {
      return photoGet(id).then(function (p) {
        if (!p) return null;
        return blobToDataUrl(p.blob).then(function (d) {
          var m = photoMeta(p);
          m.data = d;
          return m;
        });
      });
    },

    /** もらった1枚を入れる（同じidがあれば上書き） */
    put: function (rec) {
      var blob = dataUrlToBlob(rec && rec.data);
      if (!blob) return Promise.reject(new Error('画像として読めません'));
      return photoPut({
        id: rec.id,
        siteId: rec.siteId,
        kind: PHOTO_KINDS.indexOf(rec.kind) >= 0 ? rec.kind : 'その他',
        memo: String(rec.memo || ''),
        at: rec.at || new Date().toISOString(),
        w: rec.w, h: rec.h, size: blob.size,
        blob: blob
      });
    },

    /** 相手の端末で直された種類・覚え書きを、こちらにも反映する */
    setMeta: function (id, m) {
      return photoGet(id).then(function (p) {
        if (!p) return false;
        if (PHOTO_KINDS.indexOf(m.kind) >= 0) p.kind = m.kind;
        p.memo = String(m.memo || '');
        if (m.siteId) p.siteId = m.siteId;
        return photoPut(p).then(function () { return true; });
      });
    },

    del: function (id) { return photoDel(id); },

    /** 預けるには大きすぎた1枚を、もう一段小さくして入れ直す */
    reshrink: function (id) {
      return photoGet(id).then(function (p) {
        if (!p) return false;
        return shrinkImage(p.blob, 0, [{ max: 1024, q: 0.5 }]).then(function (r) {
          p.blob = r.blob; p.w = r.w; p.h = r.h; p.size = r.blob.size;
          return photoPut(p).then(function () { return true; });
        }, function () { return false; });
      });
    },

    /** 連動で写真が入れ替わったら、開いている現場を描き直す */
    refresh: function () { if (openSiteId) renderList(); }
  };

  /** 調査シートを紙と同じ形で印刷する。blank=true なら何も記入しない状態で出す */
  function printSurvey(site, blank) {
    // 画面が持っている現場は入力前の写しのことがあるので、保存済みを読み直す
    var live = findSite(site.id) || site;
    var data = blank ? {} : surveyOf(live);
    site = live;
    var esc2 = function (v) { return esc(String(v == null ? '' : v)); };

    function cell(f) {
      if (!f) return '<th class="sv-k"></th><td class="sv-v"></td>';
      var v = '';
      if (f.t === 'check' || f.t === 'checktext') {
        var picked = Array.isArray(data[f.k]) ? data[f.k] : [];
        v = f.o.map(function (o) {
          return '<span class="sv-o">' + (picked.indexOf(o) >= 0 ? '☑' : '☐') + esc2(o) + '</span>';
        }).join('');
        if (f.t === 'checktext') v += '<span class="sv-sub">' + esc2(data[f.k + '_memo'] || (blank ? f.ph : '')) + '</span>';
      } else {
        var raw = data[f.k];
        v = raw ? esc2(raw).replace(/\n/g, '<br>') : (blank && f.ph ? '<span class="sv-ph">' + esc2(f.ph) + '</span>' : '');
      }
      return '<th class="sv-k">' + esc2(f.k) + '</th><td class="sv-v">' + v + '</td>';
    }

    var html = '<div class="sheet-page sv-page">';
    html += '<div class="sv-title">店舗・事務所・工場用　空調設備現場調査確認表</div>';

    html += '<table class="sv-tbl sv-head">';
    for (var i = 0; i < SURVEY_HEAD.length; i += 2) {
      html += '<tr>' + cell(SURVEY_HEAD[i]) + cell(SURVEY_HEAD[i + 1]) + '</tr>';
    }
    html += '</table>';

    SURVEY.forEach(function (sec) {
      html += '<div class="sv-sec">' + esc2(sec.sec) + '</div>';
      html += '<table class="sv-tbl">';
      sec.pairs.forEach(function (p) {
        html += '<tr>' + cell(p[0]) + cell(p[1]) + '</tr>';
      });
      html += '</table>';
    });
    html += '</div>';

    document.title = '現場調査確認表_' + (site.name || '');
    freePrintUrls();
    if (blank) { showSheetAndPrint(html); return; }

    // 記入済みで出すときは、うしろに写真のページを足す
    photosOf(site.id).then(function (list) {
      showSheetAndPrint(html + photoPagesHtml(list, site));
    }, function () { showSheetAndPrint(html); });
  }

  /* 印刷に出している写真の一時アドレス。次に印刷するときに返す */
  var printUrls = [];
  function freePrintUrls() {
    printUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    printUrls = [];
  }

  /** 写真のページを組み立てる（1枚の紙に6枚） */
  function photoPagesHtml(list, site) {
    if (!list || !list.length) return '';
    var out = '', per = 6;
    for (var i = 0; i < list.length; i += per) {
      out += '<div class="sheet-page sv-page ph-page">';
      out += '<div class="sv-title">現場写真　' + esc(site.name || '') + '</div>';
      out += '<div class="ph-grid">';
      list.slice(i, i + per).forEach(function (p, j) {
        var u = URL.createObjectURL(p.blob);
        printUrls.push(u);
        out += '<figure class="ph-cell"><img src="' + esc(u) + '" alt="">' +
          '<figcaption>' + (i + j + 1) + '. ' + esc(p.kind || '') +
          (p.memo ? '　' + esc(p.memo) : '') + '</figcaption></figure>';
      });
      out += '</div></div>';
    }
    return out;
  }

  /**
   * 紙面を画面に組んでから印刷する。
   * 写真は読み込みが終わる前に印刷を始めると、白いままの紙が出てしまう。
   * だから全部の画像が出そろうのを待ってから window.print() を呼ぶ。
   */
  function showSheetAndPrint(html) {
    $('#sheet').innerHTML = html;
    var imgs = $$('#sheet img');
    var waits = imgs.map(function (im) {
      if (im.complete) return Promise.resolve();
      return new Promise(function (res) { im.onload = im.onerror = res; });
    });
    Promise.all(waits).then(function () {
      setTimeout(function () { window.print(); }, 60);
    });
  }

  function openEstimate(e, msg) {
    st = clone(e);
    delete st.total; delete st.savedAt;
    if (st.unitRound == null) st.unitRound = 0;   // この設定より前に保存した見積
    if (st.manDayYen == null) st.manDayYen = num(pb.defaults.manDayYen);
    syncManDayToQuote();
    fillMissingLineCosts();      // 保存したあとに入れた仕入掛率を、この見積にも効かせる
    fillMeta(); renderLines(); save(KEY_DRAFT, st);
    $('.tab[data-view="edit"]').click();
    toast(msg || '読み込みました');
  }

  /** その現場の情報を引き継いで、新しい見積を始める */
  function newEstimateForSite(s) {
    st = newState();
    syncManDayToQuote();
    st.siteId = s.id;
    st.customer = s.customer;
    st.honorific = s.honorific || '御中';
    st.subject = s.name;
    st.site = s.address;
    fillMeta(); renderLines(); save(KEY_DRAFT, st);
    $('.tab[data-view="edit"]').click();
    toast('「' + s.name + '」の見積を作ります');
  }

  $('#btn-export-estimates').addEventListener('click', function () {
    // 現場と見積はセットでないと意味がないので、1つのファイルにまとめて出す
    var bundle = { type: 'airtec-sites', sites: loadSites(), estimates: load(KEY_EST, []), invoices: loadInvoices() };
    download('50airtec-現場データ-' + todayISO() + '.json', JSON.stringify(bundle, null, 2));
  });
  $('#file-import-estimates').addEventListener('change', function (ev) {
    readJSON(ev.target, function (data) {
      // 昔のバックアップは見積だけの配列。どちらでも読めるようにしておく
      var sites = null, ests = null, invs = null;
      if (Array.isArray(data)) { ests = data; }
      else if (data && Array.isArray(data.estimates)) { ests = data.estimates; sites = data.sites || []; invs = data.invoices || []; }
      if (!ests) { toast('見積データの形式が違います'); return; }

      if (!confirm('保存済みの現場と見積を、読み込んだファイルの内容で置き換えます。よろしいですか？\n\n' +
        '　現場：' + (sites ? sites.length + '件' : '（入っていません。件名から作り直します）') + '\n' +
        '　見積：' + ests.length + '件\n' +
        '　請求書：' + (invs ? invs.length + '件' : '（入っていません）'))) return;

      save(KEY_EST, ests);
      if (sites) saveSites(sites);
      if (invs) save(KEY_INV, invs);
      openSiteId = null;
      renderList();              // 現場が無い古いデータは、ここで自動的にふり分けられる
      toast('読み込みました');
    });
  });

  function readJSON(input, cb) {
    var f = input.files && input.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try { cb(JSON.parse(r.result)); }
      catch (e) { toast('ファイルを読めませんでした'); }
      input.value = '';
    };
    r.readAsText(f, 'utf-8');
  }

  /* ======================================================================
     単価マスタ編集
     ====================================================================== */
  var MASTER_PAGE = 200;   // 一度に描く行数の上限（多いと画面が重くなるため）

  function renderMaster() {
    renderCsvTargets();
    var box = $('#master-editor');
    box.innerHTML = '';

    pb.categories.forEach(function (cat, ci) {
      var d = el('details', 'cat-block');
      var sm = el('summary');
      var count = el('span', 'cat-count');
      sm.appendChild(document.createTextNode(cat.name));
      sm.appendChild(count);
      d.appendChild(sm);

      var body = el('div', 'cat-body');
      d.appendChild(body);

      var refresh = function () { count.textContent = '（' + cat.items.length + '項目）'; };
      refresh();

      // 開いたときに初めて中身を作る（閉じたままの分類は描かない）
      var built = false;
      var build = function () { built = true; buildCatBody(cat, ci, body, refresh); };
      d.addEventListener('toggle', function () { if (d.open && !built) build(); });
      if (ci === 0) { d.open = true; build(); }

      box.appendChild(d);
    });
  }

  /** ひとつの分類の中身（検索欄・行・操作ボタン）を組み立てる */
  function buildCatBody(cat, ci, body, refreshCount) {
    body.innerHTML = '';

    var rowsBox = el('div', 'cat-rows');
    var filter = '';
    var onAddBlank = null;   // 「＋項目を追加」と同じ動きを行から呼べるようにする

    // 項目が多い分類には、その中を探すための検索欄を出す
    if (cat.items.length > 30) {
      var fwrap = el('div', 'cat-filter');
      var fi = el('input');
      fi.type = 'search';
      fi.placeholder = 'この分類の中を品番・品名で探す';
      fi.addEventListener('input', function () { filter = fi.value; drawRows(); });
      fwrap.appendChild(fi);
      body.appendChild(fwrap);
    }

    var head = el('div', 'mrow mrow-head');
    // 末尾の2つは「製品ページ」ボタンと「削除」ボタンの列（見出しは無し）
    ['品番', '品名', '規格・仕様', '単位', '人工', '原価', '単価', '色', '', ''].forEach(function (h, i) {
      head.appendChild(el('div', i === 5 ? 'mcol-cost' : null, h));
    });
    body.appendChild(head);
    body.appendChild(rowsBox);

    function drawRows() {
      rowsBox.innerHTML = '';
      var q = filter.trim().toLowerCase();
      var matched = [];
      cat.items.forEach(function (item, ii) {
        if (!q) { matched.push([item, ii]); return; }
        var hay = ((item.code || '') + ' ' + item.name + ' ' + (item.spec || '')).toLowerCase();
        if (hay.indexOf(q) >= 0) matched.push([item, ii]);
      });

      matched.slice(0, MASTER_PAGE).forEach(function (m) {
        rowsBox.appendChild(masterRow(cat, m[0], m[1], function () {
          if (refreshCount) refreshCount();
          drawRows();
        }, function () { if (onAddBlank) onAddBlank(); }));
      });

      if (!matched.length) {
        rowsBox.appendChild(el('p', 'picker-empty', '該当する項目がありません。'));
      } else if (matched.length > MASTER_PAGE) {
        rowsBox.appendChild(el('p', 'picker-empty',
          matched.length + '件のうち ' + MASTER_PAGE + '件を表示しています。上の検索でしぼり込んでください。'));
      }
    }
    drawRows();

    var actions = el('div', 'card-actions');
    actions.style.marginTop = '10px';
    actions.style.marginLeft = '0';

    var addItem = el('button', 'btn btn-ghost', '＋ 項目を追加'); addItem.type = 'button';
    addItem.addEventListener('click', function () { addBlankItem(); });

    // 空の行を足して、すぐ品番から打ち始められるようにする
    function addBlankItem() {
      cat.items.push({ code: '', name: '', spec: '', unit: '', manDay: 0, price: 0 });
      savePB(); renderPicker();
      if (refreshCount) refreshCount();
      filter = '';
      var f = body.querySelector('.cat-filter input');
      if (f) f.value = '';
      drawRows();
      var rows = rowsBox.querySelectorAll('.mrow');
      var last = rows[rows.length - 1];
      if (last) {
        last.scrollIntoView({ block: 'center' });
        var first = last.querySelector('input');
        if (first) first.focus();
      }
    }
    onAddBlank = addBlankItem;

    var renCat = el('button', 'btn btn-ghost', 'カテゴリ名を変更'); renCat.type = 'button';
    renCat.addEventListener('click', function () {
      var v = prompt('カテゴリ名', cat.name);
      if (v == null) return;
      cat.name = v.trim() || cat.name;
      savePB(); renderMaster(); renderPicker();
    });

    var delCat = el('button', 'btn btn-ghost btn-danger', 'カテゴリを削除'); delCat.type = 'button';
    delCat.addEventListener('click', function () {
      if (!confirm('カテゴリ「' + cat.name + '」を中の項目ごと削除します。よろしいですか？')) return;
      pb.categories.splice(ci, 1);
      if (activeCat === cat.id) activeCat = pb.categories.length ? pb.categories[0].id : null;
      savePB(); renderMaster(); renderPicker();
    });

    actions.appendChild(addItem);
    actions.appendChild(renCat);
    actions.appendChild(delCat);
    body.appendChild(actions);
  }

  function masterRow(cat, item, ii, onDelete, onEnterAtEnd) {
    var row = el('div', 'mrow');

    function inp(val, cls, type, onchange, placeholder) {
      var i = el('input', cls);
      i.type = type || 'text';
      i.value = val;
      if (placeholder) i.placeholder = placeholder;
      i.addEventListener('input', function () { onchange(i.value); savePBDebounced(); });
      return i;
    }

    row.appendChild(inp(item.code || '', 'm-code', 'text', function (v) { item.code = v; }, '品番'));
    row.appendChild(inp(item.name, null, 'text', function (v) { item.name = v; }, '品名'));
    row.appendChild(inp(item.spec || '', null, 'text', function (v) { item.spec = v; }, '規格・仕様'));
    row.appendChild(inp(item.unit, null, 'text', function (v) { item.unit = v; }, '個'));

    // 消耗品雑費のような「作業費の◯%」の項目は、金額ではなく割合を入れてもらう
    var isAuto = !!num(item.autoPercent);

    // 人工（にんく）。0.1きざみで入れると、単価は［人工 × 1人工の金額］で決まる
    var mdCell = el('span', 'm-manday');
    var mdInput = null;
    if (isAuto) {
      mdCell.appendChild(el('i', null, '—'));
    } else {
      mdInput = inp(num(item.manDay) || '', 'm-md', 'number', function (v) {
        item.manDay = num(v);
        if (!item.manDay) delete item.manDay;
        syncPrice();
      }, '0.0');
      mdInput.step = '0.1';
      mdInput.min = '0';
      mdInput.title = 'この作業が何人工かを0.1きざみで入れます。空ならふつうの単価として扱います';
      mdCell.appendChild(mdInput);
    }
    row.appendChild(mdCell);
    // 「0.1人工 × ¥30,000」を画面に出す札（マウスを乗せなくても読める）
    var mdNote = el('small', 'm-mdnote');

    /* 空調王が最初から持っている金額は「目安」。
       買った人が自社の金額だと思い込まないよう、直すまで札を出しておく。
       単価を打った時点で外れる（＝その人の金額になった） */
    var estNote = el('small', 'm-estnote', item.est ? '目安' : '');
    if (item.est) estNote.title = '空調王が最初から入れている目安の金額です。自社の金額に直してください';

    // 原価（社内用）。空なら人工や仕入掛率から見当をつける
    var costCell = el('span', 'm-manday mcol-cost');
    var costInput = inp(num(item.cost) || '', 'm-cost', 'number', function (v) {
      item.cost = num(v);
      if (!item.cost) delete item.cost;
    }, String(itemCost(item, cat) || '—'));
    costInput.title = '仕入れ値・原価。空なら人工や仕入掛率から見当をつけます';
    costCell.appendChild(costInput);
    row.appendChild(costCell);
    var priceInput = isAuto
      ? inp(item.autoPercent, 'm-price', 'number', function (v) { item.autoPercent = num(v); })
      : inp(item.price, 'm-price', 'number', function (v) {
          item.price = num(v);
          // 手で打った金額が、次に1人工の金額を変えたときに上書きされないよう、
          // ここで人工を外す。人工で出したいなら人工の欄に入れ直せばよい
          if (num(item.manDay)) {
            delete item.manDay;
            if (mdInput) mdInput.value = '';
            mdNote.textContent = '';
          }
          delete item.est;          // 目安の札を外す（自分の金額になったので）
          if (estNote) estNote.textContent = '';
        });
    // 単価まで打ったら Enter で次の行へ。続けて打ち込めるようにする
    priceInput.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      savePB();
      if (onEnterAtEnd) onEnterAtEnd();
    });
    /**
     * 人工が入っている項目の単価は［人工 × 1人工の金額］で決まる。
     * ただし打てなくはしない。前は readOnly にしていたが、
     * スマホでは「なぜ打てないのか」を出す方法（マウスを乗せる）が無く、
     * 理由の分からない数字がそこにあるだけになっていた。
     * いまは打てる。打った時点で、その項目は人工から離れる。
     */
    function syncPrice() {
      if (isAuto) return;
      var md = num(item.manDay);
      if (md > 0) {
        item.price = manDayPrice(md);
        priceInput.value = item.price;
      }
      priceInput.title = md > 0
        ? md + '人工 × ' + yen(num(st.manDayYen)) + ' ＝ ' + yen(item.price) + '（単価を打つと人工から外れます）'
        : '';
      // マウスの無い端末でも分かるように、画面にも出す
      mdNote.textContent = md > 0
        ? md + '人工 × ' + yen(num(st.manDayYen))
        : '';
      // 原価の見当（うすい文字）も、人工に合わせて出し直す
      costInput.placeholder = String(itemCost(item, cat) || '—');
    }

    if (isAuto) {
      priceInput.title = autoBaseOf(item) === 'work'
        ? '作業費（家庭用・業務用・移設から入れた行）の合計にかける割合です'
        : '作業費と消耗品雑費を足した金額にかける割合です';
      var pcell = el('span', 'm-auto');
      pcell.appendChild(priceInput);
      pcell.appendChild(el('i', null, '% ' + AUTO_BASES[autoBaseOf(item)].short));
      row.appendChild(pcell);
    } else {
      var pcell2 = el('span', 'm-pricecell');
      pcell2.appendChild(priceInput);
      pcell2.appendChild(mdNote);
      pcell2.appendChild(estNote);
      row.appendChild(pcell2);
      syncPrice();
    }

    // 色分け。取付の形など、ぱっと見分けたいものに使う
    var colSel = el('select', 'm-color');
    colSel.title = 'この項目の文字色。取付の形などを見分けるのに使います';
    var COLOR_ORDER = ['', '青', '水', '緑', '橙', '赤', '桃', '紫', '茶', '灰'];
    COLOR_ORDER.forEach(function (name) {
      var op = el('option', null, name || '—');
      op.value = name;
      var c = itemColor(name);
      if (c) op.style.color = c;
      if ((item.color || '') === name) op.selected = true;
      colSel.appendChild(op);
    });
    // 選択肢に無い色（CSVで色コードを入れた場合など）も残す
    if (item.color && COLOR_ORDER.indexOf(item.color) < 0) {
      var opX = el('option', null, item.color);
      opX.value = item.color; opX.selected = true;
      colSel.insertBefore(opX, colSel.firstChild);
    }
    function paintRow() {
      var c = itemColor(item.color);
      row.style.color = c || '';
      colSel.style.color = c || '';
    }
    colSel.addEventListener('change', function () {
      item.color = colSel.value;
      if (!item.color) delete item.color;
      paintRow();
      savePBDebounced();
    });
    paintRow();
    row.appendChild(colSel);

    // URLが無い行でも列がずれないよう、入れ物は必ず置く
    var refCell = el('span', 'm-ref');
    var ref = refButton(item.url, item.name);
    if (ref) refCell.appendChild(ref);
    row.appendChild(refCell);

    var del = el('button', 'icon-btn', '✕'); del.type = 'button'; del.title = 'この項目を削除';
    del.addEventListener('click', function () {
      cat.items.splice(ii, 1);
      savePB(); renderPicker();
      if (onDelete) onDelete();
    });
    row.appendChild(del);
    return row;
  }
  /* ======================================================================
     CSV取り込み（メーカーの価格表・自作の単価表をまとめて読み込む）
     ====================================================================== */

  /** 日本のExcelが書き出すCSVは Shift_JIS のことが多いので、文字化けしたら読み直す */
  function decodeCSV(buffer) {
    var bytes = new Uint8Array(buffer);
    // BOM付きUTF-8
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    var utf8 = new TextDecoder('utf-8').decode(bytes);
    if (utf8.indexOf('�') < 0) return utf8;      // 文字化けなし＝UTF-8
    try { return new TextDecoder('shift_jis').decode(bytes); }
    catch (e) { return utf8; }
  }

  /** カンマ区切りを1行ずつ配列に。ダブルクォートで囲まれたカンマ・改行にも対応 */
  function parseCSV(text) {
    var rows = [], row = [], cur = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ',' || ch === '\t') {
        row.push(cur); cur = '';
      } else if (ch === '\n') {
        row.push(cur); rows.push(row); row = []; cur = '';
      } else if (ch !== '\r') {
        cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    // 空行を落とす
    return rows.filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ''; });
    });
  }

  // 見出しの言い方はバラバラなので、よくある呼び方をまとめて受け取る
  var CSV_ALIASES = {
    category: ['カテゴリ', 'カテゴリー', '分類', '大分類', 'category'],
    code:     ['品番', '型番', '品番／型番', '品番/型番', '商品コード', 'コード', 'code', '品目コード'],
    name:     ['品名', '名称', '商品名', '製品名', '品名・仕様', 'name'],
    spec:     ['規格', '仕様', 'サイズ', '規格・仕様', 'spec'],
    url:      ['URL', 'ＵＲＬ', 'リンク', '製品ページ', '参考URL', 'ページ', 'url', 'link'],
    color:    ['色', '色分け', '文字色', 'カラー', 'color'],
    unit:     ['単位', 'unit'],
    price:    ['定価', '単価', '価格', '金額', '希望小売価格', '標準価格', 'price'],
    manDay:   ['人工', '人工数', '作業人工', '歩掛', '歩掛り', 'manday'],
    cost:     ['原価', '仕入', '仕入値', '仕入単価', '仕入価格', '仕切', '仕切価格', 'cost']
  };

  function normalizeHeader(s) {
    return String(s || '').trim().replace(/\s+/g, '').replace(/[（(].*?[）)]/g, '').toLowerCase();
  }

  /** 1行目が見出しなら列の位置を返す。見出しでなければ null */
  function detectColumns(headerRow) {
    var map = {}, hit = 0;
    headerRow.forEach(function (cell, idx) {
      var h = normalizeHeader(cell);
      Object.keys(CSV_ALIASES).forEach(function (key) {
        if (map[key] != null) return;
        if (CSV_ALIASES[key].some(function (a) { return normalizeHeader(a) === h; })) {
          map[key] = idx; hit++;
        }
      });
    });
    // 品名か品番、どちらかと価格が見つかれば見出し行とみなす
    if (hit >= 2 && (map.name != null || map.code != null)) return map;
    return null;
  }

  function toPrice(v) {
    // 「¥1,200」「1,200円」なども数値にする
    var s = String(v == null ? '' : v).replace(/[¥￥,，\s円]/g, '');
    s = s.replace(/[０-９．－]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function findOrCreateCategory(name) {
    var target = null;
    pb.categories.forEach(function (c) { if (c.name === name) target = c; });
    if (!target) {
      target = { id: 'c' + Date.now() + Math.floor(Math.random() * 1000), name: name, items: [] };
      pb.categories.push(target);
    }
    return target;
  }

  function importCSV(text) {
    var rows = parseCSV(text);
    if (!rows.length) { toast('CSVが空でした'); return; }

    var cols = detectColumns(rows[0]);
    var body;
    if (cols) {
      body = rows.slice(1);
    } else {
      // 見出しが無いときは、列の数から並びを推測する
      var n = 0;
      rows.forEach(function (r) { n = Math.max(n, r.length); });
      if (n <= 2)      cols = { name: 0, price: 1 };
      else if (n === 3) cols = { name: 0, unit: 1, price: 2 };
      else if (n === 4) cols = { code: 0, name: 1, unit: 2, price: 3 };
      else              cols = { code: 0, name: 1, spec: 2, unit: 3, price: 4 };
      body = rows;
    }

    var fallbackName = $('#csv-target').value;
    var replace = $('#csv-replace').checked;
    var costOnly = $('#csv-costonly') && $('#csv-costonly').checked;
    var touched = {};   // カテゴリ名 → 追加件数
    var staged = [];
    var skipped = 0;

    body.forEach(function (r) {
      function cell(key) { return cols[key] != null ? String(r[cols[key]] == null ? '' : r[cols[key]]).trim() : ''; }
      var name = cell('name');
      var code = cell('code');
      if (!name && !code) { skipped++; return; }
      var catName = cell('category') || fallbackName;
      var md = toPrice(cell('manDay'));
      var it = {
        code: code,
        name: name || code,
        spec: cell('spec'),
        url: safeUrl(cell('url')),
        color: cell('color'),
        unit: cell('unit') || '個',
        price: toPrice(cell('price'))
      };
      // 人工の列があれば、単価は［人工 × 1人工の金額］で出す
      if (md > 0) { it.manDay = md; it.price = manDayPrice(md); }
      // 仕入値（原価）の列があれば入れる。社内用なので見積書には出ない
      var cst = toPrice(cell('cost'));
      if (cst > 0) it.cost = cst;
      staged.push({ catName: catName, item: it });
      touched[catName] = (touched[catName] || 0) + 1;
    });

    if (!staged.length) { toast('取り込める行が見つかりませんでした'); return; }

    // 仕入先の見積を読ませるとき。行は増やさず、原価だけを書き込む
    if (costOnly) { importCostsOnly(staged); return; }

    // カテゴリが多いとダイアログが長くなり、ブラウザに途中で切られてしまう。
    // 内訳は先頭だけ出して、残りは件数でまとめる。
    var catNames = Object.keys(touched);
    var SUMMARY_MAX = 5;
    var summary = catNames.slice(0, SUMMARY_MAX).map(function (k) {
      return '・' + k + '：' + touched[k] + '件';
    }).join('\n');
    if (catNames.length > SUMMARY_MAX) {
      summary += '\n・ほか ' + (catNames.length - SUMMARY_MAX) + ' カテゴリ';
    }

    // 読み違えていないか目で確かめてもらうため、最初の数件を見せる
    var preview = staged.slice(0, 3).map(function (s) {
      var i = s.item;
      return '　' + [i.code || '（品番なし）', i.name, i.spec || '—', i.unit,
                     (num(i.manDay) ? i.manDay + '人工 ' : '') + yen(i.price) +
                     (num(i.cost) ? '（原価 ' + yen(i.cost) + '）' : '')].join(' ／ ');
    }).join('\n');

    // 読み取り結果を先に出す。長くてブラウザに切られても、ここだけは必ず見えるようにする。
    var msg = staged.length + '件を取り込みます。\n\n' +
      '【読み取り結果の確認（最初の' + Math.min(3, staged.length) + '件）】\n' +
      '　品番 ／ 品名 ／ 規格 ／ 単位 ／ 単価\n' + preview +
      '\n\nこの並びで合っていますか？\n\n' +
      '【入れ先カテゴリ（' + catNames.length + '件）】\n' + summary +
      (skipped ? '\n\n（品名も品番も空の ' + skipped + ' 行はとばします）' : '') +
      (replace ? '\n\n※取り込み先カテゴリの中身は、いったん空にしてから入れ直します。' : '\n\n※いまある項目はそのまま残し、後ろに追加します。');
    if (!confirm(msg)) return;

    if (replace) {
      Object.keys(touched).forEach(function (k) { findOrCreateCategory(k).items = []; });
    }
    staged.forEach(function (s) { findOrCreateCategory(s.catName).items.push(s.item); });

    if (savePB() === false) {
      // 保存できなかったときは、取り込む前の状態に戻す
      toast('件数が多すぎて保存できませんでした。分けて取り込んでください');
      pb = load(KEY_PB, null) || clone(DEFAULT_PRICEBOOK);
      pb.company  = adoptCompany(pb.company);
      pb.defaults = Object.assign({}, DEFAULT_PRICEBOOK.defaults, pb.defaults || {});
      if (!Array.isArray(pb.categories)) pb.categories = clone(DEFAULT_PRICEBOOK.categories);
      if (!pb.categories.some(function (c) { return c.id === activeCat; })) {
        activeCat = pb.categories.length ? pb.categories[0].id : null;
      }
    }
    renderMaster(); renderPicker();
    toast(staged.length + '件を取り込みました');
  }

  /**
   * 仕入先の見積から、原価だけを既存の項目に書き込む。
   *
   * 突き合わせは品番が第一。品番が無い行は品名＋規格で探す。
   * 見つからない行は足さずに数えるだけ。勝手に増やすと、
   * 商社の見積にしか無い品が単価マスタに紛れ込む。
   */
  function importCostsOnly(staged) {
    // 4,000行を毎回なめないよう、先に索引を作る
    var byCode = {}, byName = {};
    pb.categories.forEach(function (c) {
      (c.items || []).forEach(function (it) {
        var cd = String(it.code || '').trim().toUpperCase();
        if (cd && !byCode[cd]) byCode[cd] = { item: it, cat: c };
        var k = (it.name || '') + '｜' + (it.spec || '');
        if (!byName[k]) byName[k] = { item: it, cat: c };
      });
    });

    var hit = [], miss = [], pairs = [];
    staged.forEach(function (sg) {
      var r = sg.item;
      var cost = num(r.cost);
      if (cost <= 0) return;                       // 原価が無い行は用が無い
      var cd = String(r.code || '').trim().toUpperCase();
      var found = (cd && byCode[cd]) || byName[(r.name || '') + '｜' + (r.spec || '')];
      // 掛率は見積の定価と原価から出す。当たったかどうかとは関係なく使える
      if (num(r.price) > 0) {
        pairs.push({ price: num(r.price), cost: cost,
                     text: (r.name || '') + ' ' + (r.spec || '') + ' ' + (sg.catName || '') });
      }
      if (found) hit.push({ ref: found, cost: cost, label: (r.code || r.name) });
      else miss.push(r.code || r.name);
    });

    if (!hit.length && !pairs.length) {
      alert('原価の入った行が見つかりませんでした。\n\n' +
            '見出しに「原価」「仕切」「仕入」のどれかの列が要ります。');
      return;
    }

    var sample = hit.slice(0, 3).map(function (h) {
      return '　' + h.label + ' … ' + yen(num(h.ref.item.price)) + ' → 原価 ' + yen(h.cost);
    }).join('\n');

    var msg = '仕入先の見積として読みました。\n\n' +
      '　いまの項目に当てはまった：' + hit.length + '件\n' +
      '　見つからなかった：' + miss.length + '件（足しません）\n\n' +
      (sample ? '【当てはまった例】\n' + sample + '\n\n' : '') +
      (miss.length ? '【見つからなかった品番】\n　' + miss.slice(0, 5).join('、') +
        (miss.length > 5 ? ' ほか' + (miss.length - 5) + '件' : '') + '\n\n' : '') +
      '原価だけを書き込みます。定価と項目の数は変わりません。よろしいですか？';
    if (!confirm(msg)) return;

    hit.forEach(function (h) { h.ref.item.cost = h.cost; });
    savePB();
    renderMaster(); renderPicker(); renderLines();
    toast(hit.length + '件に原価を入れました');

    offerCostRates(pairs);
  }

  /** 読み取った掛率を、仕入掛率の表に入れるか聞く */
  function offerCostRates(pairs) {
    var sum = summarizeRates(pairs);
    if (!sum.length) return;

    var lines = sum.map(function (r) {
      return r.steady
        ? '　' + r.maker + '　' + r.pct + '%　（' + r.count + '件そろっています）'
        : '　' + r.maker + '　' + r.kinds.join('% / ') + '%　（' + r.count + '件・ばらついています）';
    }).join('\n');

    var steady = sum.filter(function (r) { return r.steady && r.maker !== '（メーカー不明）'; });
    if (!steady.length) {
      alert('掛率はこう読めました。\n\n' + lines + '\n\n' +
        'ばらついているので、自動では入れません。\n' +
        'シリーズごとに違う掛率なら、［自社情報］の仕入掛率で\n' +
        'シリーズ名を書いた行を足してください。');
      return;
    }

    if (!confirm('掛率はこう読めました。\n\n' + lines + '\n\n' +
      'そろっている ' + steady.length + '件を［自社情報］の仕入掛率に入れますか？\n\n' +
      'ここに入れると、見積に載っていない同じメーカーの項目にも\n' +
      '原価が出るようになります（1本の見積で数千行が埋まります）。\n' +
      '※ すでに同じメーカーだけの行があれば、上書きします')) return;

    ensureCostRates();
    steady.forEach(function (r) {
      var at = -1;
      pb.defaults.costRates.forEach(function (x, i) {
        if (String(x.maker || '').trim() === r.maker && !String(x.series || '').trim()) at = i;
      });
      var row = { maker: r.maker, series: '', percent: r.pct };
      if (at >= 0) pb.defaults.costRates[at] = row;
      else pb.defaults.costRates.push(row);
    });
    savePB();
    renderCostRates();
    renderMaster(); renderPicker(); renderLines();
    toast(steady.length + '件の掛率を入れました');
  }

  function renderCsvTargets() {
    var sel = $('#csv-target');
    if (!sel) return;
    var keep = sel.value;
    sel.innerHTML = '';
    pb.categories.forEach(function (c) {
      var o = el('option', null, c.name);
      o.value = c.name;
      sel.appendChild(o);
    });
    var has = function (v) {
      return Array.prototype.some.call(sel.options, function (o) { return o.value === v; });
    };
    // 前に選んでいたカテゴリが残っていればそれを保つ。無ければ先頭にする。
    // （この欄は、カテゴリ列の無いCSVを取り込むときの入れ先を決めるためのもの）
    if (keep && has(keep)) sel.value = keep;
    else if (sel.options.length) sel.selectedIndex = 0;
  }

  $('#file-csv').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    var r = new FileReader();
    r.onerror = function () { toast('ファイルを読み込めませんでした'); };
    r.onload = function () {
      try { importCSV(decodeCSV(r.result)); }
      catch (e) { toast('CSVを読み込めませんでした：' + e.message); }
    };
    r.readAsArrayBuffer(f);
  });

  $('#btn-paste-import').addEventListener('click', function () {
    var text = $('#paste-area').value;
    if (!text.trim()) { toast('貼り付け欄が空です'); return; }
    try {
      importCSV(text);
      $('#paste-area').value = '';
    } catch (e) { toast('読み込めませんでした：' + e.message); }
  });

  $('#btn-paste-clear').addEventListener('click', function () {
    $('#paste-area').value = '';
  });

  $('#btn-csv-template').addEventListener('click', function () {
    var lines = [
      'カテゴリ,品番,品名,規格,単位,定価,URL',
      '材料,LD-70,スリムダクト LD ダクト,ダクト 70,本,0,https://www.inaba-denko.com/ja/product/detail/1540000',
      '材料,,ここに実際の品番・品名・定価を入れてください,,個,0,'
    ].join('\r\n');
    // Excelでそのまま開けるよう BOM 付き UTF-8 で書き出す
    var blob = new Blob(['﻿' + lines], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = '単価取り込みテンプレート.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  var pbTimer;
  function savePBDebounced() {
    clearTimeout(pbTimer);
    pbTimer = setTimeout(function () { savePB(); renderPicker(); }, 500);
  }

  var pbQuietTimer;
  function savePBQuiet() {          // 画面を作り直さずに保存だけする
    clearTimeout(pbQuietTimer);
    pbQuietTimer = setTimeout(function () { savePB(); }, 600);
  }

  $('#btn-autocolor').addEventListener('click', function () {
    // 何色になるかを先に見せる。すでに色のある項目には触らない
    var plan = [];
    pb.categories.forEach(function (c) {
      c.items.forEach(function (it) {
        if (it.color) return;
        var col = autoColorFor(it.name);
        if (col) plan.push({ name: it.name, spec: it.spec || '', color: col });
      });
    });
    if (!plan.length) { toast('色をつけられる項目はありませんでした'); return; }

    var NL = String.fromCharCode(10);
    var sample = plan.slice(0, 6).map(function (x) {
      return '　' + x.color + '　' + x.name + (x.spec ? '（' + x.spec + '）' : '');
    }).join(NL);

    if (!confirm(plan.length + '件に色をつけます。よろしいですか？' + NL +
      '（すでに色をつけてある項目は、そのまま残します）' + NL + NL + sample +
      (plan.length > 6 ? NL + '　…ほか ' + (plan.length - 6) + '件' : ''))) return;

    var n = autoColorAll();
    if (savePB() === false) return;
    renderPicker();
    renderMaster();
    toast(n + '件に色をつけました');
  });

  $('#btn-add-cat').addEventListener('click', function () {
    var v = prompt('新しいカテゴリ名');
    if (!v) return;
    pb.categories.push({ id: 'c' + Date.now(), name: v.trim(), items: [] });
    savePB(); renderMaster(); renderPicker();
  });

  $('#btn-export-pb').addEventListener('click', function () {
    // 機種データも一緒に入れておく。端末を移すとき、これ1つで全部運べるようにするため。
    var bundle = Object.assign({}, pb, { _models: load(KEY_MDL, null) });
    download('50airtec-単価マスタ-' + todayISO() + '.json', JSON.stringify(bundle, null, 2));
  });
  $('#file-import-pb').addEventListener('change', function (ev) {
    readJSON(ev.target, function (data) {
      if (!data || !Array.isArray(data.categories)) { toast('単価マスタの形式が違います'); return; }
      var mdl = data._models || null;      // 古いバックアップには入っていないので、無ければ何もしない
      var msg = '今の単価マスタを、読み込んだファイルの内容で置き換えます。よろしいですか？';
      if (mdl) msg += '\n\n（機種データも一緒に入っています）';
      if (!confirm(msg)) return;
      delete data._models;
      pb = data;
      pb.company  = adoptCompany(pb.company);
      pb.defaults = Object.assign({}, DEFAULT_PRICEBOOK.defaults, pb.defaults || {});
      activeCat = pb.categories.length ? pb.categories[0].id : null;
      savePB(); renderMaster(); renderPicker(); fillCompany();
      if (mdl) { save(KEY_MDL, mdl); chooserSel = {}; loadModels(); }
      toast('読み込みました');
    });
  });
  $('#btn-reset-pb').addEventListener('click', function () {
    if (!confirm('単価マスタを初期値に戻します。今の金額は消えます。よろしいですか？')) return;
    pb = clone(DEFAULT_PRICEBOOK);
    activeCat = pb.categories[0].id;
    savePB(); renderMaster(); renderPicker(); fillCompany();
    toast('初期値に戻しました');
  });

  /* ======================================================================
     自社情報
     ====================================================================== */
  var companyMap = {
    '#c-name': 'name', '#c-owner': 'owner', '#c-zip': 'zip', '#c-address': 'address',
    '#c-tel': 'tel', '#c-email': 'email', '#c-web': 'web', '#c-invoice': 'invoiceNo', '#c-bank': 'bank'
  };

  function fillCompany() {
    Object.keys(companyMap).forEach(function (sel) {
      var n = $(sel);
      if (n) n.value = pb.company[companyMap[sel]] || '';
    });
    $('#c-footer').value = pb.defaults.footerNote || '';
    $('#c-unit-round').value = num(pb.defaults.unitRoundYen) || 0;
    $('#c-manday').value = num(pb.defaults.manDayYen) || 0;
    $('#c-manday-cost').value = num(pb.defaults.manDayCostYen) || 0;
    $('#c-material-cost').value = num(pb.defaults.materialCostPercent) || 0;
    $('#c-model-div').value = num(pb.defaults.modelSellDivisor) || '';
    showModelDivNote();
    // うまく動かないときに「どの版を使っているか」を言えるようにしておく
    $('#app-ver').textContent = '空調王　版 ' + APP_VERSION;
    renderCostRates();
    $('#seal-size').value = pb.company.sealSizeMm || 18;
    $('#logo-size').value = pb.company.logoHeightMm || 12;
    renderSealPreview();
    renderLogoPreview();
    renderPresets();
    updateBrand();
  }

  /* ----------------------------------------------------------------------
     メーカー・シリーズごとの仕入掛率
     商社は「メーカーごと、寒冷地モデルかどうか」で掛率を変える。
     （西方商店：日立の省エネの達人 23%／寒さ知らず 24%）
     ---------------------------------------------------------------------- */
  function renderCostRates() {
    var box = $('#cost-rates');
    if (!box) return;
    box.innerHTML = '';
    var list = pb.defaults.costRates || [];
    if (!list.length) {
      box.appendChild(el('p', 'picker-empty',
        'まだありません。「＋ 行を足す」で、メーカーごとの掛率を決められます。'));
      return;
    }
    list.forEach(function (r, i) { box.appendChild(costRateRow(r, i)); });
  }

  function costRateRow(r, i) {
    var row = el('div', 'rate-row');

    var mk = el('input');
    mk.type = 'text'; mk.placeholder = '日立'; mk.value = r.maker || '';

    var sr = el('input');
    sr.type = 'text'; sr.placeholder = '空ならメーカー全部'; sr.value = r.series || '';

    var pc = el('input');
    pc.type = 'number'; pc.min = 0; pc.max = 100; pc.step = 1;
    pc.placeholder = '%'; pc.value = num(r.percent) || '';

    mk.addEventListener('input', function () { r.maker = mk.value; });
    sr.addEventListener('input', function () { r.series = sr.value; });
    pc.addEventListener('input', function () { r.percent = num(pc.value); });

    var del = el('button', 'icon-btn', '✕');
    del.type = 'button';
    del.title = 'この行を消す';
    del.addEventListener('click', function () {
      pb.defaults.costRates.splice(i, 1);
      renderCostRates();
    });

    row.appendChild(mk); row.appendChild(sr); row.appendChild(pc); row.appendChild(del);
    return row;
  }

  function updateBrand() {
    var name = (pb.company.name || '').trim();
    $('#brand-company').textContent = name || '自社情報が未設定です';
    var mark = name ? name.replace(/[（(].*$/, '').trim().slice(0, 2) : '空調';
    $('#brand-mark').textContent = mark || '空調';
  }

  // 割る数を打ち替えている途中でも、粗利率がいくつになるか見えるようにする
  $('#c-model-div').addEventListener('input', showModelDivNote);

  $('#btn-rate-add').addEventListener('click', function () {
    ensureCostRates();
    pb.defaults.costRates.push({ maker: '', series: '', percent: 0 });
    renderCostRates();
  });

  $('#btn-save-company').addEventListener('click', function () {
    Object.keys(companyMap).forEach(function (sel) {
      pb.company[companyMap[sel]] = $(sel).value;
    });
    pb.defaults.footerNote = $('#c-footer').value;
    pb.defaults.unitRoundYen = num($('#c-unit-round').value);
    pb.defaults.manDayYen = num($('#c-manday').value);
    pb.defaults.manDayCostYen = num($('#c-manday-cost').value);
    pb.defaults.materialCostPercent = num($('#c-material-cost').value);
    pb.defaults.modelSellDivisor = num($('#c-model-div').value);
    // メーカー名もシリーズ名も空、あるいは掛率0の行は捨てる
    pb.defaults.costRates = (pb.defaults.costRates || []).filter(function (r) {
      return (String(r.maker || '').trim() || String(r.series || '').trim()) && num(r.percent) > 0;
    });
    renderCostRates();
    applyLineCosts();
    applyModelPrices();   // 乗せる利益や仕入掛率を変えたら、機種の金額も出し直す
    renderLines();
    savePB();
    updateBrand();
    toast('保存しました');
  });

  /* ---------- 会社情報のひな形 ---------- */
  function renderPresets() {
    var box = $('#preset-actions');
    box.innerHTML = '';
    var presets = (pb.companyPresets && pb.companyPresets.length)
      ? pb.companyPresets
      : (DEFAULT_PRICEBOOK.companyPresets || []);
    presets.forEach(function (p) {
      var b = el('button', 'btn btn-ghost', p.label + 'の情報を入れる');
      b.type = 'button';
      b.addEventListener('click', function () {
        if (!confirm('入力欄を「' + p.label + '」の内容で上書きします。よろしいですか？')) return;
        Object.keys(companyMap).forEach(function (sel) {
          var key = companyMap[sel];
          if (p[key] != null) $(sel).value = p[key];
        });
        toast('入力しました。内容を確認して「保存」を押してください');
      });
      box.appendChild(b);
    });
  }

  /* ======================================================================
     社判
     ====================================================================== */
  var SEAL_MAX_PX = 600;   // 保存サイズ（大きすぎるとブラウザの保存容量を圧迫するため）

  function renderSealPreview() {
    var box = $('#seal-preview');
    box.innerHTML = '';
    if (pb.company.sealImage) {
      var img = el('img', 'seal-img-preview');
      img.src = pb.company.sealImage;
      img.alt = '社判';
      box.appendChild(img);
      box.classList.add('has-seal');
    } else {
      var ph = el('span', 'seal-placeholder');
      ph.innerHTML = '社判なし<br><small>㊞ と印字</small>';
      box.appendChild(ph);
      box.classList.remove('has-seal');
    }
  }

  /** 画像のどこかに透けている部分があるか（＝すでに背景が抜いてある電子印鑑かどうか） */
  function hasTransparency(px) {
    // 全画素見ると重いので、間引いて調べる
    var step = 4 * Math.max(1, Math.floor(px.length / 4 / 20000));
    for (var i = 3; i < px.length; i += step * 4) {
      if (px[i] < 240) return true;
    }
    return false;
  }

  /**
   * 社判の画像を取り込み用に整えて data URL（PNG）で返す。
   *
   * - 写真やスキャン（白い紙が写っている）→ 明るい部分ほど透明にして印影だけ残す
   * - はじめから背景が透明な電子印鑑データ → 何もせずそのまま使う
   * - SVG（ベクター）→ 大きめに描き直してから取り込む
   *
   * cb(dataUrl, info) の info.mode に 'kept'（そのまま）/'removed'（背景を抜いた）が入る。
   */
  function processSeal(file, makeTransparent, cb) {
    var isSVG = /svg/i.test(file.type) || /\.svg$/i.test(file.name || '');

    var reader = new FileReader();
    reader.onerror = function () { toast('ファイルを読み込めませんでした'); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () {
        toast('この形式は読み込めませんでした。PNG か JPEG で書き出してお試しください');
      };
      img.onload = function () {
        var iw = img.naturalWidth || img.width || 0;
        var ih = img.naturalHeight || img.height || 0;
        if (!iw || !ih) { iw = 512; ih = 512; }          // SVGで寸法が取れない場合の保険

        // SVGはベクターなので、粗くならないよう大きめに描き直す
        var scale = isSVG
          ? SEAL_MAX_PX / Math.max(iw, ih)
          : Math.min(1, SEAL_MAX_PX / Math.max(iw, ih));
        var w = Math.max(1, Math.round(iw * scale));
        var h = Math.max(1, Math.round(ih * scale));

        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        var d;
        try { d = ctx.getImageData(0, 0, w, h); }
        catch (e) { cb(cv.toDataURL('image/png'), { mode: 'kept' }); return; }
        var px = d.data;

        // すでに背景が抜けているデータは、絶対に触らない
        if (hasTransparency(px)) {
          cb(cv.toDataURL('image/png'), { mode: 'kept' });
          return;
        }
        if (!makeTransparent) {
          cb(cv.toDataURL('image/png'), { mode: 'kept' });
          return;
        }

        for (var i = 0; i < px.length; i += 4) {
          // 明るい（＝紙の白い部分）ほど透明に、濃い（＝印影）ほどそのまま残す。
          // -22 は、少し灰色がかった紙もきちんと抜けるようにするための下駄。
          var lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          var a = (255 - lum) * 1.7 - 22;
          if (a < 10) a = 0; else if (a > 255) a = 255;
          if (a < px[i + 3]) px[i + 3] = a;              // 元の透明度は残す
        }
        ctx.putImageData(d, 0, 0);
        cb(cv.toDataURL('image/png'), { mode: 'removed' });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  $('#file-seal').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;

    var okType = /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name || '');
    if (!okType) {
      toast(/pdf$/i.test(f.name || '')
        ? 'PDFは読み込めません。PNGかJPEGで書き出してからお試しください'
        : '画像ファイル（PNG・JPEG・SVGなど）を選んでください');
      return;
    }

    processSeal(f, $('#seal-transparent').checked, function (dataUrl, info) {
      var prev = pb.company.sealImage;
      pb.company.sealImage = dataUrl;
      if (savePB() === false) {
        pb.company.sealImage = prev;
        toast('社判が大きすぎて保存できませんでした。もう少し小さい画像でお試しください');
        return;
      }
      renderSealPreview();
      toast(info.mode === 'kept'
        ? '透過データだったので、そのまま取り込みました'
        : '社判を取り込みました（白い背景を透明にしました）');
    });
  });

  $('#btn-seal-clear').addEventListener('click', function () {
    if (!pb.company.sealImage) return;
    if (!confirm('社判を削除します。よろしいですか？')) return;
    pb.company.sealImage = '';
    savePB();
    renderSealPreview();
    toast('社判を削除しました');
  });

  $('#seal-size').addEventListener('input', function () {
    var v = num($('#seal-size').value);
    pb.company.sealSizeMm = Math.min(45, Math.max(8, v || 18));
    savePBDebounced();
  });

  /* ---------- ロゴ ----------
     社判とちがい、ロゴは「見せたい形」がそのまま正解なので、
     白い背景を抜くような加工はせず、大きさだけ整えて取り込む。 */
  var LOGO_MAX_PX = 600;

  function renderLogoPreview() {
    var box = $('#logo-preview');
    box.innerHTML = '';
    if (pb.company.logoImage) {
      var img = el('img', 'logo-img-preview');
      img.src = pb.company.logoImage;
      img.alt = 'ロゴ';
      box.appendChild(img);
      box.classList.add('has-logo');
    } else {
      var ph = el('span', 'seal-placeholder');
      ph.innerHTML = 'ロゴなし<br><small>会社名だけ印字</small>';
      box.appendChild(ph);
      box.classList.remove('has-logo');
    }
  }

  /** ロゴ画像を取り込み用に整えて data URL（PNG）で返す */
  function processLogo(file, cb) {
    var isSVG = /svg/i.test(file.type) || /\.svg$/i.test(file.name || '');
    var reader = new FileReader();
    reader.onerror = function () { toast('ファイルを読み込めませんでした'); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () {
        toast('この形式は読み込めませんでした。PNG か JPEG で書き出してお試しください');
      };
      img.onload = function () {
        var iw = img.naturalWidth || img.width || 0;
        var ih = img.naturalHeight || img.height || 0;
        if (!iw || !ih) { iw = 512; ih = 512; }

        // SVGはベクターなので、粗くならないよう大きめに描き直す
        var scale = isSVG
          ? LOGO_MAX_PX / Math.max(iw, ih)
          : Math.min(1, LOGO_MAX_PX / Math.max(iw, ih));
        var w = Math.max(1, Math.round(iw * scale));
        var h = Math.max(1, Math.round(ih * scale));

        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(cv.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  $('#file-logo').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;

    var okType = /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name || '');
    if (!okType) { toast('画像ファイル（PNG・JPEG・SVGなど）を選んでください'); return; }

    processLogo(f, function (dataUrl) {
      var prev = pb.company.logoImage;
      pb.company.logoImage = dataUrl;
      if (savePB() === false) {
        pb.company.logoImage = prev;
        toast('画像が大きすぎて保存できませんでした。小さめの画像でお試しください');
        return;
      }
      renderLogoPreview();
      toast('ロゴを登録しました');
    });
  });

  $('#btn-logo-clear').addEventListener('click', function () {
    if (!pb.company.logoImage) return;
    if (!confirm('ロゴを削除します。よろしいですか？')) return;
    pb.company.logoImage = '';
    savePB();
    renderLogoPreview();
    toast('ロゴを削除しました');
  });

  $('#logo-size').addEventListener('input', function () {
    var v = num($('#logo-size').value);
    pb.company.logoHeightMm = Math.min(40, Math.max(5, v || 12));
    savePBDebounced();
  });

  /* ======================================================================
     機器を選ぶ（メーカーの機種データから絞り込んで明細に入れる）
     ----------------------------------------------------------------------
     機種データは容量節約のため「辞書＋番号」で保存されているので、
     読み込むときに元の文字列に戻してから使う。
     ====================================================================== */
  // メーカーごとの「機種データ」をまとめて持つ。
  // { packs:[各メーカー], items:[全メーカーぶんを1本にしたもの], seriesOrder, typeOrder }
  var models = null;
  var modelRaws = [];       // 保存されている生のデータ（削除するときに使う）

  /** 保存されている機種データを、使える形（配列）にほどく */
  function decodeModels(p) {
    if (!p || !Array.isArray(p.rows) || !Array.isArray(p.fields)) return null;
    var dictFields = p.dictFields || [];
    var items = p.rows.map(function (r) {
      var o = {};
      p.fields.forEach(function (f, i) {
        o[f] = dictFields.indexOf(f) >= 0 ? (p.dict[f] || [])[r[i]] : r[i];
      });
      if (o.u && !/^https?:\/\//.test(o.u)) o.u = (p.urlBase || '') + o.u;
      return o;
    });
    return {
      maker: p.maker || 'メーカー',
      brand: p.brand || '',
      note: p.note || '',
      fetched: p.fetched || '',
      seriesOrder: p.seriesOrder || [],
      typeOrder: p.typeOrder || [],
      items: items
    };
  }

  /** 同じメーカー・同じシリーズ群かどうかを見分ける鍵 */
  function packKey(p) { return (p && p.maker || '') + '｜' + (p && p.brand || ''); }

  /** 保存されている中身を「メーカーごとの配列」にそろえる。
      以前は1メーカーぶんだけを直に入れていたので、その形も読めるようにしておく。 */
  function rawPacks(raw) {
    if (!raw) return [];
    if (Array.isArray(raw.packs)) return raw.packs;
    return [raw];
  }

  function loadModels() {
    var packs = [];
    modelRaws = [];
    rawPacks(load(KEY_MDL, null)).forEach(function (r) {
      var d = decodeModels(r);
      if (d && d.items.length) { packs.push(d); modelRaws.push(r); }
    });

    if (!packs.length) {
      models = null;
    } else {
      // 全メーカーぶんを1本の配列にまとめる。どのメーカーの機種かは mk に持たせる
      var items = [], so = [], to = [];
      packs.forEach(function (p) {
        p.items.forEach(function (x) { x.mk = p.maker; items.push(x); });
        p.seriesOrder.forEach(function (v) { if (so.indexOf(v) < 0) so.push(v); });
        p.typeOrder.forEach(function (v) { if (to.indexOf(v) < 0) to.push(v); });
      });
      models = { packs: packs, items: items, seriesOrder: so, typeOrder: to };
    }
    renderModelsStatus();
    renderChooser();
  }

  function renderModelsStatus() {
    var box = $('#models-status');
    if (!box) return;
    box.innerHTML = '';
    if (!models) { box.textContent = 'まだ読み込まれていません。'; return; }

    models.packs.forEach(function (p, i) {
      var row = el('div', 'models-row');
      row.appendChild(el('b', null, p.maker + '　' + p.brand));
      row.appendChild(el('span', 'models-num', p.items.length + '機種'));
      if (p.fetched) row.appendChild(el('span', null, '取得日 ' + p.fetched));
      if (p.note) row.appendChild(el('span', 'models-note', p.note));

      var del = el('button', 'icon-btn', '✕');
      del.type = 'button';
      del.title = p.maker + ' の機種データだけを削除';
      del.addEventListener('click', function () { removePack(i); });
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  /** メーカー1つぶんだけ消す */
  function removePack(i) {
    var p = models && models.packs[i];
    if (!p) return;
    if (!confirm(p.maker + '　' + p.brand + ' の機種データを削除します。よろしいですか？\n\n' +
                 '（ほかのメーカーは残ります。見積の明細に入れた機器もそのまま残ります）')) return;
    var raws = modelRaws.slice();
    raws.splice(i, 1);
    if (raws.length) { if (save(KEY_MDL, { v: 2, packs: raws }) === false) return; }
    else removeKey(KEY_MDL);
    chooserSel = {};
    loadModels();
    toast(p.maker + ' の機種データを削除しました');
  }

  /* 絞り込みの順番。ここの並びがそのまま画面の手順になる */
  var STEPS = [
    { k: 'mk', label: 'メーカー' },
    { k: 's',  label: 'シリーズ' },
    { k: 'i',  label: '室内機タイプ' },
    { k: 'hp', label: '馬力', fmt: function (v) { return v + '馬力'; } },
    { k: 'tp', label: '台数' },
    { k: 'pw', label: '電源', fmt: function (v) { return v === '三相' ? '三相200V' : '単相200V'; } },
    { k: 'rc', label: 'リモコン' }
  ];
  var chooserSel = {};

  /** いま選ばれている条件に合う機種を返す。
      stopAt を指定すると、**そのステップの条件だけを外して**残り全部で絞る
      （そのステップの選択肢を出すため）。
      先の順番でも、すでに選ばれている条件は効かせる。
      ＝「必要な能力を出す」から馬力を先に決めて来たとき、
        メーカーやシリーズの件数もその馬力で絞られる。 */
  function chooserMatches(stopAt) {
    if (!models) return [];
    return models.items.filter(function (x) {
      for (var i = 0; i < STEPS.length; i++) {
        if (stopAt != null && i === stopAt) continue;
        var k = STEPS[i].k;
        if (chooserSel[k] != null && String(x[k]) !== String(chooserSel[k])) return false;
      }
      return true;
    });
  }

  /** 選択肢を、その並び順の指定があればそれに従って並べる */
  function sortOptions(k, vals) {
    if (k === 'hp') return vals.slice().sort(function (a, b) { return a - b; });
    var order = k === 's' ? models.seriesOrder : (k === 'tp' ? models.typeOrder : null);
    if (order && order.length) {
      return vals.slice().sort(function (a, b) {
        var ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
      });
    }
    return vals.slice().sort(function (a, b) { return String(a).localeCompare(String(b), 'ja'); });
  }

  function renderChooser() {
    var box = $('#chooser-body');
    var srcEl = $('#chooser-src');
    if (!box) return;
    box.innerHTML = '';

    if (!models) {
      srcEl.textContent = '';
      box.appendChild(el('p', 'picker-empty',
        '機種データがまだありません。［単価マスタ］タブの「機種データを選ぶ」から読み込むと、ここでシリーズ・馬力・電源などから機器を選べるようになります。'));
      return;
    }
    srcEl.textContent = models.packs.map(function (p) { return p.maker + ' ' + p.brand; }).join('　／　');

    // 手順を上から順に出す。前の手順が決まっていない段階では、その先は出さない。
    for (var i = 0; i < STEPS.length; i++) {
      var step = STEPS[i];
      var pool = chooserMatches(i);
      var vals = sortOptions(step.k, [...new Set(pool.map(function (x) { return x[step.k]; }))].filter(function (v) { return v !== '' && v != null; }));

      // 選択肢が1つしかないなら、迷わせず自動で決めてしまう
      if (vals.length === 1 && chooserSel[step.k] == null) chooserSel[step.k] = vals[0];

      var row = el('div', 'chooser-step');
      var head = el('div', 'chooser-step-head');
      head.appendChild(el('span', 'chooser-step-label', (i + 1) + '. ' + step.label));
      if (chooserSel[step.k] != null) {
        var clr = el('button', 'icon-btn chooser-clear', '変更'); clr.type = 'button';
        clr.addEventListener('click', (function (kk, ii) {
          return function () {
            // ここから下の選択はやり直しになるので消す
            for (var j = ii; j < STEPS.length; j++) delete chooserSel[STEPS[j].k];
            renderChooser();
          };
        })(step.k, i));
        head.appendChild(clr);
      }
      row.appendChild(head);

      if (chooserSel[step.k] != null) {
        var fmtSel = step.fmt ? step.fmt(chooserSel[step.k]) : chooserSel[step.k];
        row.appendChild(el('div', 'chooser-chosen', fmtSel));
      } else {
        var opts = el('div', 'chooser-opts');
        vals.forEach(function (v) {
          var n = pool.filter(function (x) { return String(x[step.k]) === String(v); }).length;
          var b = el('button', 'chooser-opt'); b.type = 'button';
          b.appendChild(el('b', null, step.fmt ? step.fmt(v) : String(v)));
          b.appendChild(el('span', null, n + '件'));
          b.addEventListener('click', (function (kk, vv, ii) {
            return function () {
              chooserSel[kk] = vv;
              for (var j = ii + 1; j < STEPS.length; j++) delete chooserSel[STEPS[j].k];
              renderChooser();
            };
          })(step.k, v, i));
          opts.appendChild(b);
        });
        row.appendChild(opts);
        box.appendChild(row);
        return;   // この手順が未選択なら、ここで止める
      }
      box.appendChild(row);
    }

    // 全部選び終わったので候補を出す
    var hits = chooserMatches().slice().sort(function (a, b) { return a.y - b.y; });
    var res = el('div', 'chooser-result');
    res.appendChild(el('div', 'chooser-step-label', '該当 ' + hits.length + ' 機種（安い順）'));
    if (!hits.length) {
      res.appendChild(el('p', 'picker-empty', 'この組み合わせに合う機種がありませんでした。上の「変更」で条件を戻してください。'));
    }
    hits.forEach(function (x) {
      var b = el('button', 'model-btn'); b.type = 'button';
      var top = el('div', 'model-btn-top');
      top.appendChild(el('i', 'item-code', x.m));
      top.appendChild(el('span', 'model-price', yen(x.y)));
      b.appendChild(top);
      if (x.opt) b.appendChild(el('em', null, x.opt));
      b.appendChild(el('small', null, '室外機 ' + x.om + '／室内機 ' + x.im + (x.pm ? '／パネル ' + x.pm : '') + (x.rm ? '／リモコン ' + x.rm : '')));
      b.addEventListener('click', function () {
        var line = {
          name: (x.mk || '') + ' ' + x.s + ' ' + x.i,
          spec: [x.m, x.ab, x.tp, x.pw === '三相' ? '三相200V' : '単相200V', x.rc, x.opt].filter(Boolean).join('　'),
          // 定価は仕様の文字に焼き付けず、行の持ち物として覚えておく。
          // 売値は掛率でいつでも動くので、見せる文字は印刷のたびに作り直す。
          listPrice: x.y,
          qty: 1,
          unit: '台',
          price: x.y,
          url: x.u || ''
        };
        // 定価 × 仕入掛率 ＝ 原価。その原価に利益を乗せた金額を、見積に出す金額にする
        line.base = num(x.y);
        line.cost = lineCostFromSettings(line);
        line.rate = modelRateFor(line);
        addLine(line);
        toast('「' + x.m + '」を追加しました');
        showOptionsFor(x);
      });
      res.appendChild(b);
    });
    box.appendChild(res);
  }

  /* ======================================================================
     必要な能力を出す（用途と広さから馬力の目安）
     ----------------------------------------------------------------------
     土台はカタログの「算出基準冷房負荷（W/m²）」。5社のカタログに共通で載っている。
     （2026-09-06、NotebookLM で5社ぶん確認）

     必要能力[kW] ＝ 面積[m²] × 基準負荷[W/m²] ÷ 1000
       × 天井の高さの分 × 断熱の分 × 現場の事情の分

     **数字の出どころを分けてある。**
     ・用途別の基準負荷、断熱の倍率 …… カタログに書いてある
     ・天井の高さ、西日・厨房などの上乗せ …… カタログに数字が無い。
       設計の考え方から置いた**目安**なので、最後は人が決める。
     ====================================================================== */
  // 5社のカタログに共通で載っている幅を使う（社によってもう少し広い幅を書いているところもある）
  var SZ_USES = [
    { name: '一般事務所', lo: 115, hi: 170 },
    { name: '一般商店', lo: 155, hi: 230 },
    { name: '喫茶店・理美容室', lo: 230, hi: 290 },
    { name: 'レストラン・飲食店', lo: 230, hi: 370 }
  ];

  // カタログの適用面積の倍率をひっくり返したもの（面積が広がる＝能力は小さくてよい）
  var SZ_INSUL = [
    { name: '一重窓・断熱材なし（カタログの基準）', k: 1.00 },
    { name: '標準的な断熱材あり', k: 1 / 1.2 },
    { name: '高断熱＋二重窓・木造', k: 1 / 1.2 },
    { name: '高断熱＋二重窓・コンクリート造', k: 1 / 1.5 }
  ];

  // カタログに数字が無いので、設計の考え方から置いた上乗せ（目安）
  var SZ_ADDS = [
    { key: 'west', name: '西日が強く入る', k: 0.10 },
    { key: 'glass', name: 'ガラス面が大きい', k: 0.10 },
    { key: 'kitchen', name: '厨房・熱を出す機器がある', k: 0.20 },
    { key: 'people', name: '人が多い（ピーク時）', k: 0.10 },
    { key: 'air', name: '外気をたくさん入れる', k: 0.10 }
  ];

  /* 「横×縦」の書き方を見つけるための目印。× ｘ x X * ✕ のどれでも通す */
  var SZ_X = /[×✕xX＊*]/;

  /** 文字から広さ（m²）を読む。
      「8.2×6」「8.2m×6m ＋ 3×2.4」→ 掛けて足す（測ったまま書ける）
      「120㎡」→ そのまま／「36坪」→ m² に直す */
  function szAreaFromText(s) {
    s = String(s || '');
    var re = /([\d.]+)\s*(?:m|ｍ)?\s*[×✕xX＊*]\s*([\d.]+)\s*(?:m|ｍ)?/g;
    var sum = 0, hit = false, m;
    while ((m = re.exec(s))) {
      var w = Number(m[1]), d = Number(m[2]);
      if (w > 0 && d > 0) { sum += w * d; hit = true; }
    }
    if (hit) return Math.round(sum * 100) / 100;
    var ma = s.match(/([\d.]+)\s*(?:㎡|m2|m²|平米)/i);
    if (ma) return Number(ma[1]);
    var mt = s.match(/([\d.]+)\s*坪/);
    if (mt) return Math.round(Number(mt[1]) * 3.3058 * 100) / 100;
    return 0;
  }

  /** 測った部屋の一覧から広さ（m²）を出す。単位が cm なら 100 で割ってから掛ける */
  function szRoomArea(r, unit) {
    var d = (unit === 'cm') ? 100 : 1;
    var a = (num(r.w) / d) * (num(r.d) / d);
    return Math.round(a * 100) / 100;
  }
  function szRoomsArea(rooms, unit) {
    var sum = 0;
    (rooms || []).forEach(function (r) {
      var a = szRoomArea(r, unit);
      sum += r.minus ? -a : a;
    });
    return Math.round(sum * 100) / 100;   // ひきすぎたらマイナスのまま返す（呼ぶ側で気づけるように）
  }
  /** m² を坪にする（1坪 = 3.3058 m²）。現場では坪で話すことが多いので併記する */
  function szTsubo(m2) { return Math.round((m2 / 3.3058) * 10) / 10; }

  /** 小数のうしろのゼロを出さない（56.40 → 56.4、100.00 → 100） */
  function szFmt(n) { return String(Math.round(n * 100) / 100); }

  // 形番号（P40 など）と馬力。能力[kW] は形番号 ÷ 10
  var SZ_FORMS = [
    [40, 1.5], [45, 1.8], [50, 2], [56, 2.3], [63, 2.5], [71, 2.8], [80, 3], [90, 3.2],
    [112, 4], [140, 5], [160, 6], [180, 7], [224, 8], [280, 10], [335, 12], [400, 14],
    [450, 16], [500, 18], [560, 20]
  ];

  function szFormFor(kw) {
    for (var i = 0; i < SZ_FORMS.length; i++) {
      if (SZ_FORMS[i][0] / 10 >= kw - 0.001) return SZ_FORMS[i];
    }
    return SZ_FORMS[SZ_FORMS.length - 1];
  }

  /** 計算だけをする。画面は見積作成でも現調シートでも同じこれを使う。
      p = { use:番号, area:m², height:m, insul:番号, adds:[key,...] } */
  function szCalc(p) {
    var u = SZ_USES[p.use || 0] || SZ_USES[0];
    var ins = SZ_INSUL[p.insul || 0] || SZ_INSUL[0];
    var area = num(p.area) || 0;
    var h = num(p.height) || 2.7;
    var hk = Math.max(1, h / 2.7);          // 天井が高い分は容積の比で見る
    var addK = 1, addNames = [];
    (p.adds || []).forEach(function (key) {
      SZ_ADDS.forEach(function (a) { if (a.key === key) { addK += a.k; addNames.push(a.name); } });
    });
    var lo = area * u.lo / 1000 * ins.k * hk * addK;
    var hi = area * u.hi / 1000 * ins.k * hk * addK;
    var mid = (lo + hi) / 2;
    return {
      ok: area > 0, use: u, insul: ins, area: area, height: h, hk: hk,
      addK: addK, addNames: addNames,
      lo: lo, hi: hi, mid: mid,
      form: szFormFor(mid), formHi: szFormFor(hi)
    };
  }

  /** その形の機種が機種データにあるか探す。無ければ1つ上の形へ */
  function szFindModels(form) {
    if (!models || !models.items || !models.items.length) return null;
    var formOf = function (x) {
      var m = String(x.ab || '').match(/(\d{2,3})\s*[形型]/);
      return m ? Number(m[1]) : 0;
    };
    for (var i = 0; i < SZ_FORMS.length; i++) {
      if (SZ_FORMS[i][0] < form[0]) continue;
      var need = SZ_FORMS[i][0];
      var hit = models.items.filter(function (x) { return formOf(x) === need; });
      if (hit.length) return { form: SZ_FORMS[i], count: hit.length, moved: need !== form[0] };
    }
    return null;
  }


  /* ----------------------------------------------------------------------
     選んだ機種に付けられる別売品を出す
     ----------------------------------------------------------------------
     カタログの表では、列の見出しが「その別売品の付く室内機」になっている。
     見出しは「FHCP40〜71GA」のようなまとめ書きなので、
     容量のところを開いて、選んだ機種の室内機品番と突き合わせる
     （突き合わせは catalog.js の optionsFor がやる）。
     ---------------------------------------------------------------------- */
  function showOptionsFor(x) {
    var box = $('#chooser-options');
    if (!box) return;
    box.innerHTML = '';
    if (!optStores.length || !window.KUCHOO_CATALOG || !KUCHOO_CATALOG.optionsFor) return;

    /* そのメーカーの別売品だけを見る。
       ダイキンの機種にパナソニックのパネルを出してはいけない。 */
    var same = function (a, b) {
      if (!a || !b) return false;
      return String(a).indexOf(String(b)) >= 0 || String(b).indexOf(String(a)) >= 0;
    };
    var list = [];
    optStores.forEach(function (s) {
      if (x.mk && s.maker && !same(x.mk, s.maker)) return;
      KUCHOO_CATALOG.optionsFor(s, x).forEach(function (o) {
        list.push({ code: o.code, name: o.name, y: o.y, fits: o.fits, maker: s.maker });
      });
    });
    if (!list.length) return;

    var head = el('div', 'opt-head');
    head.appendChild(el('b', null, '「' + x.m + '」に付けられる別売品'));
    head.appendChild(el('span', 'models-num', list.length + '品目'));
    var close = el('button', 'icon-btn', '✕');
    close.type = 'button';
    close.title = '閉じる';
    close.addEventListener('click', function () { box.innerHTML = ''; });
    head.appendChild(close);
    box.appendChild(head);

    /* 1台に700品目も出ると現場では選べない。品名で仲間に分けて絞れるようにする */
    var cats = {};
    list.forEach(function (o) {
      o.cat = (KUCHOO_CATALOG.optCategory ? KUCHOO_CATALOG.optCategory(o.name) : 'その他');
      cats[o.cat] = (cats[o.cat] || 0) + 1;
    });
    // 仕事でよく使う順に並べる（catalog.js が持っている順）
    var fixed = (KUCHOO_CATALOG.catOrder || []);
    var order = Object.keys(cats).sort(function (a, b) {
      var ia = fixed.indexOf(a), ib = fixed.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var pick = order.length > 1 ? order[0] : '';   // 最初はいちばん多い仲間だけ出す

    var catBox = el('div', 'picker-cats');
    box.appendChild(catBox);
    var wrap = el('div', 'picker-items');
    box.appendChild(wrap);

    function drawCats() {
      catBox.innerHTML = '';
      var all = el('button', 'cat-btn' + (pick ? '' : ' is-active'), 'すべて' + list.length);
      all.type = 'button';
      all.addEventListener('click', function () { pick = ''; drawCats(); drawItems(); });
      catBox.appendChild(all);
      order.forEach(function (c) {
        var b = el('button', 'cat-btn' + (pick === c ? ' is-active' : ''), c + cats[c]);
        b.type = 'button';
        b.addEventListener('click', function () { pick = c; drawCats(); drawItems(); });
        catBox.appendChild(b);
      });
    }

    function drawItems() {
      wrap.innerHTML = '';
      list.filter(function (o) { return !pick || o.cat === pick; }).forEach(function (o) {
      var b = el('button', 'item-btn');
      b.type = 'button';
      b.appendChild(el('b', null, o.name || o.code));
      b.appendChild(el('span', 'item-code', o.code));
      b.appendChild(el('em', null, yen(o.y)));
      b.addEventListener('click', function () {
        var line = {
          name: (o.maker || '') + '　' + (o.name || o.code),
          spec: o.code,
          listPrice: o.y,
          qty: 1,
          unit: '個',
          price: o.y
        };
        line.base = num(o.y);
        line.cost = lineCostFromSettings(line);
        line.rate = modelRateFor(line);
        addLine(line);
        toast('「' + (o.name || o.code) + '」を追加しました');
      });
      wrap.appendChild(b);
      });
    }

    drawCats();
    drawItems();
  }

  $('#btn-chooser-reset').addEventListener('click', function () {
    chooserSel = {};
    renderChooser();
    var ob = $('#chooser-options');
    if (ob) ob.innerHTML = '';
  });

  /**
   * 機種データ1つぶんを取り込む。
   * 同じメーカー・同じシリーズ群のものがあれば入れ替え、無ければ足す。
   * 戻り値は画面に出す一行（取り込めなければ null）。
   */
  function adoptModelPack(data) {
    var decoded = decodeModels(data);
    if (!decoded || !decoded.items.length) return null;

    var raws = rawPacks(load(KEY_MDL, null));
    var at = -1;
    raws.forEach(function (r, i) { if (packKey(r) === packKey(data)) at = i; });
    if (at >= 0) raws[at] = data; else raws.push(data);

    if (save(KEY_MDL, { v: 2, packs: raws }) === false) return null;
    return decoded.maker + ' ' + decoded.items.length + '件' + (at >= 0 ? '（入れ替え）' : '');
  }

  /** ファイルを1つ読んでJSONにする。読めなければ null を渡す */
  function readJsonFile(f, done) {
    var r = new FileReader();
    r.onerror = function () { done(null); };
    r.onload = function () {
      var data = null;
      try { data = JSON.parse(r.result); } catch (e) { data = null; }
      done(data);
    };
    r.readAsText(f);
  }

  $('#file-models').addEventListener('change', function (ev) {
    var files = Array.prototype.slice.call(ev.target.files || []);
    ev.target.value = '';
    if (!files.length) return;

    var done = [], failed = [], i = 0;

    // 1つずつ順に読む（まとめて読むと、同じ保存先を取り合って上書きし合うため）
    (function next() {
      if (i >= files.length) { finish(); return; }
      var f = files[i++];
      readJsonFile(f, function (data) {
        var line = data ? adoptModelPack(data) : null;
        if (line) done.push(line); else failed.push(f.name);
        next();
      });
    })();

    function finish() {
      chooserSel = {};
      loadModels();
      if (done.length && !failed.length) {
        toast(done.length === 1 ? done[0] + ' を入れました'
                                : done.length + 'メーカーを入れました（' + done.join('／') + '）');
      } else if (done.length) {
        toast(done.length + 'メーカーを入れました。読めなかったファイル: ' + failed.join('、'));
      } else {
        toast('機種データとして読めませんでした（' + failed.join('、') + '）');
      }
    }
  });

  $('#btn-models-clear').addEventListener('click', function () {
    if (!models) return;
    if (!confirm('読み込んだ機種データを、すべてのメーカーぶん削除します。よろしいですか？\n（見積の明細に入れた機器はそのまま残ります）')) return;
    removeKey(KEY_MDL);
    chooserSel = {};
    loadModels();
    toast('機種データを削除しました');
  });

  /* ======================================================================
     カタログPDFから機種データを作る
     ----------------------------------------------------------------------
     メーカーのデジタルカタログからPDFを保存して、ここに入れると、
     その端末の中だけで読み取って機種データができる。

     ・PDFも、読み取った中身も、どこにも送らない
     ・よそのサイトも叩かない（社内のPCでも動く）
     ・読む部品（480KB＋ワーカー2MB）は、押したときだけ読み込む

     どの文字を手がかりに読むかは catalog.js に書いてある。
     カタログの作りが変わって読めなくなったら、直すのはそちら。
     ====================================================================== */
  var catalogLibReady = false;

  function ensureCatalogLib() {
    if (catalogLibReady) return Promise.resolve();
    return loadScript('vendor/pdfparse/pdf-parse.umd.js?v=' + APP_VERSION)
      .then(function () { catalogLibReady = true; });
  }

  /** 途中経過や結果を出す。改行はそのまま行に分ける */
  function catalogNote(msg, kind) {
    var box = $('#catalog-status');
    if (!box) return;
    box.className = 'csv-note' + (kind ? ' ' + kind : '');
    box.textContent = '';
    String(msg).split('\n').forEach(function (line, i) {
      if (i) box.appendChild(document.createElement('br'));
      box.appendChild(document.createTextNode(line));
    });
  }

  function catalogMakers() {
    return (window.KUCHOO_CATALOG && KUCHOO_CATALOG.makers) || [];
  }

  function currentCatalogMaker() {
    var sel = $('#catalog-maker');
    var id = sel ? sel.value : '';
    var found = null;
    catalogMakers().forEach(function (m) { if (m.id === id) found = m; });
    return found;
  }

  /** 選んだメーカーの「どこからPDFを取るか」を出す */
  function renderCatalogHowto() {
    var box = $('#catalog-howto');
    if (!box) return;
    box.innerHTML = '';
    var mk = currentCatalogMaker();
    if (!mk) return;

    var ol = el('ol', 'catalog-howto');
    mk.howto.forEach(function (s) { ol.appendChild(el('li', null, s)); });
    box.appendChild(ol);

    var a = el('a', 'catalog-link', mk.catalog + '（' + mk.name + '）のカタログを開く');
    a.href = mk.url;
    a.target = '_blank';
    a.rel = 'noopener';
    box.appendChild(a);
    box.appendChild(el('div', 'catalog-size', mk.size));
  }

  /* ----------------------------------------------------------------------
     別売品（どの室内機に付くかの情報つき）
     ---------------------------------------------------------------------- */
  // メーカーごとに持つ（機種データと同じ）。1つしか持てないと、
  // 2社目を入れたとたん1社目が消える
  var optStores = [];

  function loadOptions() {
    var raw = load(KEY_OPT, null);
    if (raw && raw.stores) optStores = raw.stores;
    else if (raw && raw.items) optStores = [raw];      // 前の形（1社だけ）も読めるように
    else optStores = [];
    renderOptionsStatus();
  }

  function renderOptionsStatus() {
    var box = $('#options-status');
    if (!box) return;
    box.innerHTML = '';
    if (!optStores.length) { box.textContent = 'まだ読み込まれていません。'; return; }

    optStores.forEach(function (s, i) {
      var row = el('div', 'models-row');
      row.appendChild(el('b', null, s.maker + '　' + (s.brand || '別売品')));
      row.appendChild(el('span', 'models-num', (s.items || []).length + '品目'));
      if (s.fetched) row.appendChild(el('span', null, '取得日 ' + s.fetched));
      var del = el('button', 'icon-btn', '✕');
      del.type = 'button';
      del.title = s.maker + ' の別売品だけを削除';
      del.addEventListener('click', function () {
        if (!confirm(s.maker + ' の別売品を削除します。よろしいですか？\n（ほかのメーカーは残ります）')) return;
        var rest = optStores.slice();
        rest.splice(i, 1);
        if (rest.length) save(KEY_OPT, { v: 1, stores: rest });
        else removeKey(KEY_OPT);
        loadOptions();
        toast(s.maker + ' の別売品を削除しました');
      });
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  function adoptOptions(store, extra) {
    var stores = optStores.slice();
    var at = -1;
    stores.forEach(function (s, i) { if (s.maker === store.maker) at = i; });
    if (at >= 0) stores[at] = store; else stores.push(store);

    if (save(KEY_OPT, { v: 1, stores: stores }) === false) {
      catalogNote('読み取れましたが、保存できませんでした。端末の空きが足りないかもしれません。', 'ng');
      return;
    }
    loadOptions();
    catalogNote(store.items.length + '品目の別売品を読み取りました。' + (extra || '') +
                (at >= 0 ? '（入れ替え）' : '') +
                '\n機器を選ぶと、その機種に付く別売品が下に出ます。', 'ok');
    toast(store.items.length + '品目を入れました');
  }

  /** 読み取れた機種データを入れる。r は catalog.js が返したもの */
  function adoptCatalogPack(pack, count, extra) {
    var line = adoptModelPack(pack);
    if (!line) {
      catalogNote('読み取れましたが、保存できませんでした。端末の空きが足りないかもしれません。', 'ng');
      return;
    }
    chooserSel = {};
    loadModels();
    catalogNote(count + '機種を読み取って、機種データに入れました。' + (extra || '') +
                '\n「見積を作る」の［機器を選ぶ］から使えます。', 'ok');
    toast(count + '機種を入れました');
  }

  function initCatalogBox() {
    var sel = $('#catalog-maker');
    var file = $('#file-catalog');
    if (!sel || !file) return;

    var list = catalogMakers();
    if (!list.length) {
      catalogNote('この版では、まだカタログの読み取りが使えません。');
      return;
    }
    list.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.name;
      sel.appendChild(o);
    });
    sel.addEventListener('change', renderCatalogHowto);
    renderCatalogHowto();
    loadOptions();

    file.addEventListener('change', function (ev) {
      var f = (ev.target.files || [])[0];
      ev.target.value = '';
      if (!f) return;
      var mk = currentCatalogMaker();
      if (!mk) { catalogNote('先にメーカーを選んでください。', 'ng'); return; }
      // 三菱だけはPDFではなくデータファイル（.json）を読む
      var wantJson = (mk.kind === 'json');
      if (!(wantJson ? /\.(json|txt)$/i.test(f.name) : /\.pdf$/i.test(f.name))) {
        catalogNote(wantJson
          ? '保存したデータファイル（.json）を選んでください。'
          : 'カタログのPDFを選んでください。', 'ng');
        return;
      }

      // 大きいカタログは読み取りに数分かかり、そのあいだパソコン全体が重くなる。
      // 黙って始めると「固まった」と思われるので、先に断る。
      var mb = Math.round(f.size / 1024 / 1024);
      if (f.size > 200 * 1024 * 1024) {
        if (!confirm('このカタログは ' + mb + 'MB あります。\n\n' +
                     '読み取りに数分かかり、そのあいだパソコンが重くなります。\n' +
                     'ほかのアプリ（LINE・Discord・動画など）を先に閉じておくと安全です。\n\n' +
                     '始めますか？')) {
          catalogNote('やめました。ほかのアプリを閉じてから、もう一度選んでください。');
          return;
        }
      }

      var t0 = Date.now();
      file.disabled = true;
      catalogNote('読み取りの部品を用意しています…');

      ensureCatalogLib().then(function () {
        catalogNote(mk.name + ' のカタログを読んでいます…');
        return KUCHOO_CATALOG.run(f, mk.id, function (done, total) {
          catalogNote(mk.name + ' のカタログを読んでいます…　' + done + ' / ' + total + 'ページ' +
                      '\nこの画面は閉じないでください。');
        });
      }).then(function (r) {
        var sec = Math.round((Date.now() - t0) / 1000);
        var time = (sec >= 60 ? Math.floor(sec / 60) + '分' + (sec % 60) + '秒' : sec + '秒');
        // 紙のカタログのときだけ「価格ページ○枚」を出す（三菱はデータファイルなので枚数が無い）
        var extra = (wantJson || !r.pricePages) ? '（' + time + '）'
                                                : '（価格ページ ' + r.pricePages + '枚／' + time + '）';
        if (r.options) adoptOptions(r.options, extra);
        else adoptCatalogPack(r.pack, r.count, extra);
      }).catch(function (e) {
        var msg = (e && e.message) || 'うまく読み取れませんでした';
        catalogNote(msg, 'ng');
        // 「いつもより少ない」で止めたときだけ、人が見て入れられるようにする
        if (e && e.soft && e.pack) {
          var box = $('#catalog-status');
          var btn = el('button', 'btn btn-ghost', 'それでも ' + e.rows + '件を入れる');
          btn.type = 'button';
          btn.style.marginTop = '8px';
          btn.addEventListener('click', function () { adoptCatalogPack(e.pack, e.rows, ''); });
          box.appendChild(document.createElement('br'));
          box.appendChild(btn);
        }
      }).then(function () {
        file.disabled = false;
      });
    });
  }

  initCatalogBox();

  /* ======================================================================
     見積書の印刷
     ====================================================================== */
  /**
   * 機種の行に「定価 ¥○○ → ¥△△」を出すための文字を作る。
   * ・定価より安くなっているときだけ出す（同じ額なら見せる意味がない）
   * ・売値は掛率でいつでも動くので、印刷のたびにここで作り直す
   */
  function listPriceHTML(l) {
    var list = num(l.listPrice), now = num(l.price);
    if (!list || !now || list <= now) return '';
    return '<span class="l-list">定価 <s>' + yen(list) + '</s> → <b>' + yen(now) + '</b></span>';
  }

  function buildSheet(mode, doc) {
    var d = doc || st;
    mode = mode || 'estimate';
    var inv = (mode === 'invoice');
    var t = calcOf(d);
    var c = pb.company;
    var to = (d.customer || '').trim();
    var hon = d.honorific === '（なし）' ? '' : ('　' + d.honorific);
    var validUntil = d.validDays ? jpDate(addDays(d.date, d.validDays)) + 'まで' : '';

    var rowList = [];
    d.lines.forEach(function (l, i) {
      rowList.push(
        '<tr>' +
          '<td class="t-no">' + (i + 1) + '</td>' +
          '<td>' + esc(l.name) + (l.spec ? '<span class="l-spec">' + esc(l.spec) + '</span>' : '') + listPriceHTML(l) + '</td>' +
          '<td class="t-qty">' + (num(l.qty) % 1 === 0 ? num(l.qty) : num(l.qty).toFixed(1)) + '</td>' +
          '<td class="t-unit">' + esc(l.unit) + '</td>' +
          '<td class="t-price">' + Math.round(num(l.price)).toLocaleString('ja-JP') + '</td>' +
          '<td class="t-amount">' + lineAmount(l, d.unitRound).toLocaleString('ja-JP') + '</td>' +
        '</tr>');
    });

    var sumHTML = '<tr><th>小計</th><td>' + Math.round(t.subtotal).toLocaleString('ja-JP') + '</td></tr>';
    if (t.overhead) sumHTML += '<tr><th>諸経費</th><td>' + t.overhead.toLocaleString('ja-JP') + '</td></tr>';
    if (t.discount) sumHTML += '<tr><th>値引き</th><td>-' + t.discount.toLocaleString('ja-JP') + '</td></tr>';
    sumHTML += '<tr><th>消費税（' + d.tax + '%）</th><td>' + t.tax.toLocaleString('ja-JP') + '</td></tr>';
    sumHTML += '<tr class="grand"><th>合計</th><td>' + Math.round(t.total).toLocaleString('ja-JP') + '</td></tr>';
    // 適格請求書は「税率ごとに区分した対価の額と消費税額」を書くことが決まっている。
    // 空調工事は軽減税率の対象外なので、区分は1つ（標準税率）だけになる。
    if (inv) {
      sumHTML += '<tr class="tax-break"><th>' + d.tax + '%対象</th><td>' +
        Math.round(t.taxable).toLocaleString('ja-JP') + '</td></tr>';
      sumHTML += '<tr class="tax-break"><th>　うち消費税</th><td>' +
        t.tax.toLocaleString('ja-JP') + '</td></tr>';
    }

    var termsHTML = '';
    function term(k, v) {
      if (!v) return '';
      return '<div><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>';
    }
    termsHTML += term('件　　名', d.subject);
    termsHTML += term('工事場所', d.site);
    if (inv) {
      termsHTML += term('工事完了日', d.doneDate ? jpDate(d.doneDate) : '');
      termsHTML += term('お支払期限', d.dueDate ? jpDate(d.dueDate) : '');
      termsHTML += term('お支払条件', d.payment);
    } else {
      termsHTML += term('工　　期', d.delivery);
      termsHTML += term('お支払条件', d.payment);
      termsHTML += term('有効期限', validUntil);
    }

    var sealMm = Math.min(45, Math.max(8, num(c.sealSizeMm) || 18));
    var sealSrc = safeImage(c.sealImage);
    var sealHTML = sealSrc
      ? '<img class="seal-img" src="' + esc(sealSrc) + '" alt="" style="width:' + sealMm + 'mm">'
      : '<span class="seal-fallback">㊞</span>';

    var logoMm = Math.min(40, Math.max(5, num(c.logoHeightMm) || 12));
    var logoSrc = safeImage(c.logoImage);
    var logoHTML = logoSrc
      ? '<img class="sheet-logo" src="' + esc(logoSrc) + '" alt="" style="height:' + logoMm + 'mm">'
      : '';

    var companyHTML =
      '<div class="sheet-company">' +
        logoHTML +
        '<b>' + esc(c.name) + '</b><br>' +
        (c.zip ? esc(c.zip) + '　' : '') + esc(c.address) + '<br>' +
        (c.tel ? 'TEL：' + esc(c.tel) + '<br>' : '') +
        (c.email ? 'Mail：' + esc(c.email) + '<br>' : '') +
        (c.web ? esc(c.web) + '<br>' : '') +
        (c.invoiceNo ? '登録番号：' + esc(c.invoiceNo) + '<br>' : '') +
        '<div class="seal-area" style="min-height:' + sealMm + 'mm">' +
          '<span class="owner">' + esc(c.owner || '') + '</span>' +
          sealHTML +
        '</div>' +
      '</div>';

    var remarks = (d.note || '') + (c.bank ? '\n\n【お振込先】' + c.bank : '');

    var headHTML =
        '<div class="sheet-title">' + (inv ? '御請求書' : '御見積書') + '</div>' +
        '<div class="sheet-meta">' +
          (inv ? '請求番号：' : '見積番号：') + esc(d.no) + '<br>' +
          (inv ? '請求日：' : '発行日：') + esc(jpDate(d.date)) +
        '</div>' +
        '<div class="sheet-head">' +
          '<div class="sheet-head-left">' +
            '<div class="sheet-to">' + esc(to || '　') + esc(hon) + '</div>' +
            '<p class="sheet-lead">' +
              (inv ? '下記の通りご請求申し上げます。' : '下記の通りお見積り申し上げます。') +
            '</p>' +
            '<div class="sheet-total-box">' +
              '<span class="label">' + (inv ? 'ご請求金額' : '御見積金額') + '</span>' +
              '<span class="value">' + Math.round(t.total).toLocaleString('ja-JP') + ' 円</span>' +
              '<span class="tax-note">（消費税込）</span>' +
            '</div>' +
            '<div class="sheet-terms">' + termsHTML + '</div>' +
          '</div>' +
          '<div class="sheet-head-right">' + companyHTML + '</div>' +
        '</div>';

    var theadHTML =
        '<thead><tr>' +
          '<th class="t-no">No</th><th>品名・仕様</th><th class="t-qty">数量</th>' +
          '<th class="t-unit">単位</th><th class="t-price">単価</th><th class="t-amount">金額</th>' +
        '</tr></thead>';

    var footHTML =
        '<div class="sheet-foot">' +
          '<div class="sheet-remarks"><span class="rk">備考</span>' + esc(remarks) + '</div>' +
          '<table class="sheet-sum">' + sumHTML + '</table>' +
        '</div>';

    paginateSheet(headHTML, theadHTML, rowList, footHTML);
  }

  var EMPTY_ROW = '<tr><td class="t-no">&nbsp;</td><td></td><td class="t-qty"></td>' +
                  '<td class="t-unit"></td><td class="t-price"></td><td class="t-amount"></td></tr>';

  /**
   * 紙に割る。
   *
   * ブラウザ任せにすると、iPhoneでは「行の途中で切るな」も「見出しを繰り返せ」も
   * 効かない。品名だけ前の紙・仕様は次の紙、という見積書ができてしまう。
   * （2026-09-02、実機で確認した）
   *
   * そこで、いったん1枚に全部入れて高さを実際に測り、こちらで紙を分ける。
   * どのブラウザでも同じ紙になるし、プレビューも1枚ずつ見えるようになる。
   */
  function paginateSheet(headHTML, theadHTML, rows, footHTML) {
    var box = $('#sheet');
    var tableOf = function (inner) {
      return '<table class="sheet-lines">' + theadHTML + '<tbody>' + inner + '</tbody></table>';
    };

    // 隠れたままだと高さが全部0になるので、測るあいだだけ見えない形で開く
    var pv = $('#preview'), wasHidden = pv.hidden;
    if (wasHidden) { pv.style.visibility = 'hidden'; pv.hidden = false; }

    box.innerHTML =
      '<div class="sheet-page">' +
        '<div id="m-head">' + headHTML + '</div>' +
        tableOf(rows.join('') + EMPTY_ROW) +
        '<div id="m-foot">' + footHTML + '</div>' +
      '</div>';

    // 1mm が何ピクセルか、実物で測る（端末ごとにちがう）
    var ruler = el('div');
    ruler.style.cssText = 'position:absolute;width:100mm;height:0';
    box.appendChild(ruler);
    var pxPerMm = ruler.offsetWidth / 100;
    box.removeChild(ruler);

    var table  = box.querySelector('table.sheet-lines');
    var headH  = $('#m-head').offsetHeight;
    var theadH = table.tHead ? table.tHead.offsetHeight : 0;
    var footH  = $('#m-foot').offsetHeight;
    var trs    = table.tBodies[0] ? table.tBodies[0].rows : [];
    var rowH   = [];
    for (var i = 0; i < trs.length; i++) rowH.push(trs[i].offsetHeight);
    var emptyH = rowH.pop() || 0;   // いちばん最後は、高さを測るために足した空行

    if (wasHidden) { pv.hidden = true; pv.style.visibility = ''; }

    // A4 297mm から上の余白14mm・下の余白12mm を引くと271mm。
    // ただし iPhone の Safari は、その中にURLと日付とページ番号を自分で刷る。
    // そのぶん使える高さが減るので、271mm いっぱいまで詰めると
    // ほんの数mmはみ出して、真っ白な紙が1枚できてしまう。
    // （2026-09-02、実機で確認）そこで 245mm までしか詰めない。
    var avail = 245 * pxPerMm;
    if (!pxPerMm || avail <= 0 || !rowH.length) return;   // 測れないときは1枚のまま

    var pages = [], cur = [], space = avail - headH - theadH;
    for (i = 0; i < rows.length; i++) {
      if (cur.length && rowH[i] > space) {
        pages.push(cur);
        cur = []; space = avail - theadH;
      }
      cur.push(i);
      space -= rowH[i];
    }
    pages.push(cur);

    // 備考と合計は絶対に割らない。最後の紙に入らなければ、次の紙にまとめて置く
    var footOwnPage = space < footH;

    // 短い見積は表がすかすかに見えるので空行で埋める。
    // ただし入るぶんだけ。数だけ見て足すと紙からあふれて、白紙が1枚増える。
    var restSpace = space - (footOwnPage ? 0 : footH);
    var filler = '';
    for (var k = rows.length; k < 12 && emptyH > 0 && restSpace >= emptyH; k++) {
      filler += EMPTY_ROW;
      restSpace -= emptyH;
    }

    var html = '';
    for (var p = 0; p < pages.length; p++) {
      var last = (p === pages.length - 1);
      var inner = '';
      for (var j = 0; j < pages[p].length; j++) inner += rows[pages[p][j]];
      if (last) inner += filler;
      html += '<div class="sheet-page">' +
                (p === 0 ? headHTML : '') +
                tableOf(inner) +
                (last && !footOwnPage ? footHTML : '') +
              '</div>';
    }
    if (footOwnPage) html += '<div class="sheet-page">' + footHTML + '</div>';

    box.innerHTML = html;
  }

  /* ---------- プレビュー ----------
     印刷用に組んだ #sheet を、そのまま画面にかぶせて見せる。
     別に組み直しているわけではないので、
     プレビューで見た形と印刷された形がずれることはない。 */

  var pvDocTitle = '';   // 印刷するときの見出し（PDF保存のファイル名になる）

  /** 会社名が未登録だと見積書の体裁にならないので、そこだけ先に確かめる */
  function readyToPrint() {
    if ((pb.company.name || '').trim()) return true;
    toast('先に［自社情報］で会社名を登録してください');
    $('.tab[data-view="settings"]').click();
    return false;
  }

  function openPreview(headline, docTitle) {
    pvDocTitle = docTitle || '';
    $('#pv-title').textContent = headline || 'プレビュー';
    $('#preview').hidden = false;
    document.body.style.overflow = 'hidden';   // 後ろの画面が一緒に動かないようにする
    fitPreview();
  }

  function closePreview() {
    $('#preview').hidden = true;
    document.body.style.overflow = '';
  }

  /** 画面の幅に合わせてA4を縮める（スマホでも紙1枚まるごと見えるように）。
      縮めるのは見た目だけなので、印刷される中身は変わらない。 */
  var fitRetry = 0;

  function fitPreview() {
    if ($('#preview').hidden) { fitRetry = 0; return; }
    var scroll = $('#pv-scroll'), fit = $('#pv-fit'), stage = $('#pv-stage');
    stage.style.transform = 'none';
    fit.style.width = '';
    fit.style.height = '';
    var pageW = stage.offsetWidth;
    if (!pageW) return;
    var avail = scroll.clientWidth - 24;       // .preview-scroll の左右パディングぶん
    // 開いた直後は入れ物の幅がまだ決まっていないことがある（スマホで起きやすい）。
    // 幅を0のまま計算すると倍率がマイナスになり、紙が裏返って画面から消える。
    // 次の描画まで待ってから測り直す。待ちすぎないよう回数を区切る。
    if (avail <= 0) {
      if (fitRetry < 30) { fitRetry++; requestAnimationFrame(fitPreview); }
      return;
    }
    fitRetry = 0;
    var scale = Math.min(1, avail / pageW);
    stage.style.transform = 'scale(' + scale + ')';
    // 縮小しても余白が空きっぱなしにならないよう、入れ物の大きさも合わせる
    fit.style.width = (pageW * scale) + 'px';
    fit.style.height = (stage.offsetHeight * scale) + 'px';
  }

  window.addEventListener('resize', fitPreview);

  $('#btn-preview').addEventListener('click', function () {
    if (!readyToPrint()) return;
    buildSheet();
    openPreview('見積書　' + st.no + (st.customer ? '　' + st.customer : ''),
                '見積書_' + (st.customer || '無題') + '_' + st.no);
  });

  $('#pv-close').addEventListener('click', closePreview);

  /* --------------------------------------------------------------------
     PDFを、こちらで作る。

     iPhoneの印刷は、紙の幅ではなく画面の幅で組み立ててから紙に合わせて
     拡大するので、こちらで割った1枚とずれる。ずれた結果、ブラウザが
     もう一度切って、品名と仕様が別の紙に離れてしまう。
     （2026-09-02、実機のPDFで確認。同じ見積がPCで3枚、iPhoneで4枚）

     そこで、印刷そのものに頼らない。画面に出ている紙をそのまま絵にして、
     A4のPDFに1枚ずつ貼る。どの端末でも、画面で見えているとおりの紙になる。

     部品（html2canvas と jsPDF）は vendor/ に置いてある。
     よそのサイトから読まないので、電波が悪いところでも動く。
     押したときだけ読み込むので、ふだんの起動は重くならない。
     -------------------------------------------------------------------- */
  var pdfLibsReady = false;

  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { ok(); };
      s.onerror = function () { ng(new Error('部品が読み込めませんでした')); };
      document.head.appendChild(s);
    });
  }

  function ensurePdfLibs() {
    if (pdfLibsReady) return Promise.resolve();
    return loadScript('vendor/html2canvas.min.js?v=' + APP_VERSION)
      .then(function () { return loadScript('vendor/jspdf.umd.min.js?v=' + APP_VERSION); })
      .then(function () { pdfLibsReady = true; });
  }

  function makePdf(win, btn) {
    btn = btn || $('#pv-pdf');
    var label = btn.textContent;
    // 新しい画面は「押した流れの中」でしか開けない。あとから開くと止められる
    if (win === undefined) win = window.open('', '_blank');
    btn.disabled = true;
    btn.textContent = '作っています…';

    var stage = $('#pv-stage'), fit = $('#pv-fit');
    var keepTransform = stage.style.transform;
    var keepW = fit.style.width, keepH = fit.style.height;

    function restore() {
      stage.style.transform = keepTransform;
      fit.style.width = keepW;
      fit.style.height = keepH;
      btn.disabled = false;
      btn.textContent = label;
      fitPreview();
    }

    ensurePdfLibs().then(function () {
      // 縮めたまま絵にすると粗くなるので、いったん原寸に戻す
      stage.style.transform = 'none';
      fit.style.width = '';
      fit.style.height = '';

      var pages = [].slice.call(document.querySelectorAll('#sheet .sheet-page'));
      if (!pages.length) throw new Error('紙がありません');
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

      var chain = Promise.resolve();
      pages.forEach(function (page, i) {
        chain = chain.then(function () {
          // 何枚目をやっているか出す。止まったように見せない
          btn.textContent = (i + 1) + ' / ' + pages.length + ' 枚目…';
          return window.html2canvas(page, {
            scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false
          });
        }).then(function (canvas) {
          if (i) pdf.addPage();
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
        });
      });

      return chain.then(function () { return pdf; });
    }).then(function (pdf) {
      var name = (pvDocTitle || '見積書') + '.pdf';
      if (win) {
        // その場でPDFを開く。iPhoneはここから共有・印刷ができる
        win.location.href = URL.createObjectURL(pdf.output('blob'));
      } else {
        pdf.save(name);   // 新しい画面が開けなかったときは、ファイルとして保存
      }
      restore();
      toast('PDFにしました（' + document.querySelectorAll('#sheet .sheet-page').length + '枚）');
    }).catch(function (e) {
      if (win) win.close();
      restore();
      toast('PDFが作れませんでした：' + (e && e.message ? e.message : ''));
    });
  }

  $('#pv-pdf').addEventListener('click', function () { makePdf(undefined, $('#pv-pdf')); });

  // 下のバーからも一発で作れるようにする。
  // プレビューを開いてからでないと紙が組み上がらないので、ここで開いてから渡す。
  $('#btn-pdf').addEventListener('click', function () {
    if (!readyToPrint()) return;
    var win = window.open('', '_blank');   // 押した流れの中で開く
    buildSheet();
    openPreview('見積書　' + st.no + (st.customer ? '　' + st.customer : ''),
                '見積書_' + (st.customer || '無題') + '_' + st.no);
    makePdf(win, $('#pv-pdf'));
  });

  $('#pv-print').addEventListener('click', function () {
    if (pvDocTitle) document.title = pvDocTitle;
    setTimeout(function () { window.print(); }, 60);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#preview').hidden) closePreview();
  });

  $('#btn-print').addEventListener('click', function () {
    if (!readyToPrint()) return;
    if (!st.lines.length) {
      if (!confirm('明細が1行もありません。このまま印刷しますか？')) return;
    }
    buildSheet();
    document.title = '見積書_' + (st.customer || '無題') + '_' + st.no;
    setTimeout(function () { window.print(); }, 60);
  });

  window.addEventListener('afterprint', function () {
    document.title = '空調王';
  });

  /* ======================================================================
     初期化
     ====================================================================== */
  fillMeta();
  renderPicker();
  renderLines();
  fillCompany();
  loadModels();
  initBackup();

  // はじめて開いたときは、自社情報の登録から始めてもらう
  if (!(pb.company.name || '').trim()) {
    $('.tab[data-view="settings"]').click();
    toast('まず会社名などの自社情報を登録してください');
  }
})();
