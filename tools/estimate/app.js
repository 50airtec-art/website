/* ==========================================================================
   50Airtec 見積作成ツール（社内用）
   - 単価マスタ・保存した見積は、この端末のブラウザ（localStorage）にのみ保存されます
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 保存キー ---------- */
  var KEY_PB    = 'airtec_pricebook_v1';
  var KEY_EST   = 'airtec_estimates_v1';
  var KEY_DRAFT = 'airtec_draft_v1';
  var KEY_MDL   = 'airtec_models_v1';
  var KEY_SITE  = 'airtec_sites_v1';
  var KEY_INV   = 'airtec_invoices_v1';

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
   * 単価表の項目につける文字色。
   * シリーズごとに色を変えて、単価表から選ぶときに見分けやすくするためのもの。
   * CSVは外から持ってくるファイルなので、決めた色の名前と #rrggbb 以外は受け付けない。
   */
  var ITEM_COLORS = {
    '青': '#1565c0', '緑': '#2e7d32', '橙': '#e65100', '赤': '#c62828',
    '紫': '#6a1b9a', '茶': '#5d4037', '水': '#0277bd', '桃': '#ad1457',
    '灰': '#546e7a', '黒': ''
  };
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
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast('保存できませんでした（ブラウザの容量不足かもしれません）'); return false; }
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
  pb.company  = Object.assign({}, DEFAULT_PRICEBOOK.company, pb.company || {});
  pb.defaults = Object.assign({}, DEFAULT_PRICEBOOK.defaults, pb.defaults || {});
  if (!Array.isArray(pb.categories)) pb.categories = clone(DEFAULT_PRICEBOOK.categories);

  function savePB() { return save(KEY_PB, pb); }

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

  /* ======================================================================
     計算
     ====================================================================== */
  function calc() { return calcOf(st); }

  /** 見積でも請求書でも使えるように、対象の書類を受け取って計算する */
  function calcOf(st) {
    var subtotal = 0;
    (st.lines || []).forEach(function (l) { subtotal += num(l.qty) * num(l.price); });

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
    '#m-discount': 'discount', '#m-tax': 'tax', '#m-rounding': 'rounding', '#m-note': 'note'
  };
  var numericFields = { validDays: 1, overhead: 1, discount: 1, tax: 1 };

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
      if (key === 'overhead' || key === 'discount' || key === 'tax' || key === 'rounding') renderTotals();
      persistDraft();
    });
    node.addEventListener('change', function () {
      var key = metaMap[sel];
      st[key] = numericFields[key] ? num(node.value) : node.value;
      renderTotals();
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
      b.appendChild(el('span', null, yen(r.item.price) + ' / ' + r.item.unit));
      b.addEventListener('click', function () {
        addLine({
          name: r.item.name,
          // 品番は見積書の「仕様」欄に出したいので、ここで一緒にしておく
          spec: [r.item.code || '', r.item.spec || ''].filter(Boolean).join('　'),
          qty: 1,
          unit: r.item.unit,
          price: r.item.price,
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
    var l = Object.assign({ name: '', spec: '', qty: 1, unit: '式', price: 0, url: '' }, line || {});
    // base は掛率をかける前の元値（単価マスタの定価）。rate は「定価の何%で出すか」
    if (l.base == null) l.base = num(l.price);
    if (l.rate == null) l.rate = 100;
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
    var tb = $('#lines-body');
    tb.innerHTML = '';
    $('#lines-empty').style.display = st.lines.length ? 'none' : 'block';
    $('#lines-table').style.display = st.lines.length ? 'table' : 'none';

    st.lines.forEach(function (l, i) {
      var tr = el('tr');

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
        var oX = el('option', null, l.rate + '%');
        oX.value = l.rate; oX.selected = true;
        sRate.insertBefore(oX, sRate.firstChild);
      }
      tdRate.appendChild(sRate);
      tr.appendChild(tdRate);

      // 単価
      var tdPrice = el('td', 'c-price');
      var iPrice = el('input'); iPrice.type = 'number'; iPrice.step = '1'; iPrice.value = l.price;
      tdPrice.appendChild(iPrice);
      tr.appendChild(tdPrice);

      function showBaseHint() {
        // 掛率が100%でないときだけ、元の定価が分かるようにしておく
        iPrice.title = num(l.rate) === 100 ? '' : '定価 ' + yen(num(l.base)) + ' の ' + l.rate + '%';
        tdRate.classList.toggle('is-off', num(l.rate) !== 100);
      }
      showBaseHint();

      sRate.addEventListener('change', function () {
        l.rate = num(sRate.value);
        l.price = Math.round(num(l.base) * l.rate / 100);
        iPrice.value = l.price;
        showBaseHint();
        recalc();
      });

      // 金額
      var tdAmt = el('td', 'c-amount', yen(num(l.qty) * num(l.price)));
      tr.appendChild(tdAmt);

      function recalc() {
        l.qty = num(iQty.value);
        l.price = num(iPrice.value);
        tdAmt.textContent = yen(l.qty * l.price);
        renderTotals();
        persistDraft();
      }
      iQty.addEventListener('input', recalc);
      iPrice.addEventListener('input', function () {
        // 単価を手で書き換えたら、その金額が新しい元値。掛率は100%に戻す
        l.base = num(iPrice.value);
        l.rate = 100;
        sRate.value = '100';
        showBaseHint();
        recalc();
      });

      // 製品ページ ＋ 単価表に登録 ＋ 削除
      var tdDel = el('td', 'c-del');

      var ref = refButton(l.url, l.name);
      if (ref) tdDel.appendChild(ref);

      var reg = el('button', 'icon-btn icon-reg', '＋表'); reg.type = 'button';
      reg.title = 'この行を単価表に登録して、次から選べるようにする';
      reg.addEventListener('click', function () {
        registerLineToMaster(l);
      });
      tdDel.appendChild(reg);

      var del = el('button', 'icon-btn', '✕'); del.type = 'button'; del.title = 'この行を削除';
      del.addEventListener('click', function () {
        st.lines.splice(i, 1);
        renderLines();
        persistDraft();
      });
      tdDel.appendChild(del);
      tr.appendChild(tdDel);

      tb.appendChild(tr);
    });

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
    } else {
      if (!confirm('この内容で「' + cat.name + '」に登録します。よろしいですか？\n\n' +
        '　品番：' + (code || '（なし）') + '\n' +
        '　品名：' + line.name + '\n' +
        '　規格：' + (spec || '（なし）') + '\n' +
        '　単位：' + (line.unit || '個') + '\n' +
        '　単価：' + yen(num(line.price)))) return;
      cat.items.push({
        code: code, name: line.name, spec: spec,
        unit: line.unit || '個', price: num(line.price),
        url: safeUrl(line.url)
      });
    }

    if (savePB() === false) return;
    renderPicker();
    toast('「' + cat.name + '」に登録しました');
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

  function renderTotals() {
    var t = calc();
    var box = $('#totals');
    var rows = [
      ['小計', yen(t.subtotal)]
    ];
    if (t.overhead) rows.push(['諸経費（' + st.overhead + '%）', yen(t.overhead)]);
    if (t.discount) rows.push(['値引き', '-' + yen(t.discount)]);
    rows.push(['課税対象額', yen(t.taxable)]);
    rows.push(['消費税（' + st.tax + '%）', yen(t.tax)]);

    var html = '<dl>';
    rows.forEach(function (r) { html += '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; });
    html += '<dt class="row-total">御見積金額（税込）</dt><dd class="row-total">' + esc(yen(t.total)) + '</dd>';
    html += '</dl>';
    box.innerHTML = html;
  }

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
    if (!confirm('現場「' + s.name + '」を削除します。\n' +
      (n ? 'この現場の見積 ' + n + '件も一緒に消えます。\n' : '') + 'よろしいですか？')) return;
    saveSites(loadSites().filter(function (x) { return x.id !== s.id; }));
    save(KEY_EST, load(KEY_EST, []).filter(function (e) { return e.siteId !== s.id; }));
    openSiteId = null;
    renderList();
    toast('削除しました');
  });

  $('#site-search').addEventListener('input', function () { renderSiteList(); });

  function renderList() {
    migrateEstimatesToSites();
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
  function buildAllData() {
    return {
      type: 'airtec-all',
      version: 1,
      exportedAt: new Date().toISOString(),
      pricebook: pb,
      models: load(KEY_MDL, null),
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
  var BK_DAYS = 14;                       // 何日空いたら知らせるか
  var canPickFile = (typeof window.showSaveFilePicker === 'function');
  var bkHandle = null;

  /* 保存先そのもの（ファイルハンドル）は localStorage に入れられないので IndexedDB に置く */
  function idb(fn) {
    return new Promise(function (res, rej) {
      var q = indexedDB.open('airtec', 1);
      q.onupgradeneeded = function () { q.result.createObjectStore('kv'); };
      q.onerror = function () { rej(q.error); };
      q.onsuccess = function () {
        // put() などはその場でエラーを投げることがある。
        // ここで受け止めないと、待っている側が永久に止まってしまう。
        try {
          var db = q.result;
          var tx = db.transaction('kv', 'readwrite');
          var r = fn(tx.objectStore('kv'));
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
          tx.onabort = function () { rej(tx.error); };
        } catch (e) { rej(e); }
      };
    });
  }
  function idbSet(k, v) { return idb(function (s) { return s.put(v, k); }); }
  function idbGet(k) { return idb(function (s) { return s.get(k); }); }

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
    if (d === Infinity || d >= BK_DAYS) {
      $('#bk-warn-text').textContent = (d === Infinity)
        ? 'まだ一度もバックアップしていません。ブラウザの閲覧データを消すと、入力した内容はすべて消えます。'
        : Math.floor(d) + '日バックアップしていません。';
      warn.style.display = '';
    } else warn.style.display = 'none';
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

  $('#btn-bk-pick').addEventListener('click', function () { pickBackupFile(); });
  $('#btn-bk-save').addEventListener('click', function () { writeBackup(false); });
  $('#btn-bk-warn-save').addEventListener('click', function () { writeBackup(false); });
  $('#btn-bk-warn-hide').addEventListener('click', function () { $('#bk-warn').style.display = 'none'; });

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
        機種: data.models && data.models.rows ? data.models.rows.length : 0,
        現場: (data.sites || []).length,
        見積: (data.estimates || []).length,
        請求書: (data.invoices || []).length
      };
      if (!confirm('この端末の内容を、読み込んだファイルで置き換えます。\n\n' +
        '　単価　：' + n.単価 + '件\n' +
        '　機種　：' + n.機種 + '件\n' +
        '　現場　：' + n.現場 + '件\n' +
        '　見積　：' + n.見積 + '件\n' +
        '　請求書：' + n.請求書 + '件\n\n' +
        'いまの内容は消えます。よろしいですか？')) return;

      pb = data.pricebook;
      pb.company  = Object.assign({}, DEFAULT_PRICEBOOK.company, pb.company || {});
      pb.defaults = Object.assign({}, DEFAULT_PRICEBOOK.defaults, pb.defaults || {});
      if (!Array.isArray(pb.categories)) pb.categories = [];
      activeCat = pb.categories.length ? pb.categories[0].id : null;
      if (savePB() === false) return;

      if (data.models) save(KEY_MDL, data.models); else localStorage.removeItem(KEY_MDL);
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
    return wrap;
  }

  /** 1項目分の入力欄を作る */
  function surveyField(f, data, touch) {
    var box = el('div', 'survey-f' + (f.t === 'memo' ? ' survey-f-wide' : ''));
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

    $('#sheet').innerHTML = html;
    document.title = '現場調査確認表_' + (site.name || '');
    setTimeout(function () { window.print(); }, 60);
  }

  function openEstimate(e, msg) {
    st = clone(e);
    delete st.total; delete st.savedAt;
    fillMeta(); renderLines(); save(KEY_DRAFT, st);
    $('.tab[data-view="edit"]').click();
    toast(msg || '読み込みました');
  }

  /** その現場の情報を引き継いで、新しい見積を始める */
  function newEstimateForSite(s) {
    st = newState();
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
    ['品番', '品名', '規格・仕様', '単位', '単価', '', ''].forEach(function (h) {
      head.appendChild(el('div', null, h));
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
      cat.items.push({ code: '', name: '', spec: '', unit: '', price: 0 });
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

    var mcol = itemColor(item.color);
    if (mcol) row.style.color = mcol;    // シリーズごとの色分け（単価マスタ側）

    row.appendChild(inp(item.code || '', 'm-code', 'text', function (v) { item.code = v; }, '品番'));
    row.appendChild(inp(item.name, null, 'text', function (v) { item.name = v; }, '品名'));
    row.appendChild(inp(item.spec || '', null, 'text', function (v) { item.spec = v; }, '規格・仕様'));
    row.appendChild(inp(item.unit, null, 'text', function (v) { item.unit = v; }, '個'));

    var priceInput = inp(item.price, 'm-price', 'number', function (v) { item.price = num(v); });
    // 単価まで打ったら Enter で次の行へ。続けて打ち込めるようにする
    priceInput.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      savePB();
      if (onEnterAtEnd) onEnterAtEnd();
    });
    row.appendChild(priceInput);

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
    price:    ['定価', '単価', '価格', '金額', '希望小売価格', '標準価格', 'price']
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
    var touched = {};   // カテゴリ名 → 追加件数
    var staged = [];
    var skipped = 0;

    body.forEach(function (r) {
      function cell(key) { return cols[key] != null ? String(r[cols[key]] == null ? '' : r[cols[key]]).trim() : ''; }
      var name = cell('name');
      var code = cell('code');
      if (!name && !code) { skipped++; return; }
      var catName = cell('category') || fallbackName;
      staged.push({
        catName: catName,
        item: {
          code: code,
          name: name || code,
          spec: cell('spec'),
          url: safeUrl(cell('url')),
          color: cell('color'),
          unit: cell('unit') || '個',
          price: toPrice(cell('price'))
        }
      });
      touched[catName] = (touched[catName] || 0) + 1;
    });

    if (!staged.length) { toast('取り込める行が見つかりませんでした'); return; }

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
      return '　' + [i.code || '（品番なし）', i.name, i.spec || '—', i.unit, yen(i.price)].join(' ／ ');
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
      pb.company  = Object.assign({}, DEFAULT_PRICEBOOK.company, pb.company || {});
      pb.defaults = Object.assign({}, DEFAULT_PRICEBOOK.defaults, pb.defaults || {});
      if (!Array.isArray(pb.categories)) pb.categories = clone(DEFAULT_PRICEBOOK.categories);
      if (!pb.categories.some(function (c) { return c.id === activeCat; })) {
        activeCat = pb.categories.length ? pb.categories[0].id : null;
      }
    }
    renderMaster(); renderPicker();
    toast(staged.length + '件を取り込みました');
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
      pb.company  = Object.assign({}, DEFAULT_PRICEBOOK.company, pb.company || {});
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
    $('#seal-size').value = pb.company.sealSizeMm || 18;
    $('#logo-size').value = pb.company.logoHeightMm || 12;
    renderSealPreview();
    renderLogoPreview();
    renderPresets();
    updateBrand();
  }

  function updateBrand() {
    var name = (pb.company.name || '').trim();
    $('#brand-company').textContent = name || '自社情報が未設定です';
    var mark = name ? name.replace(/[（(].*$/, '').trim().slice(0, 2) : '空調';
    $('#brand-mark').textContent = mark || '空調';
  }

  $('#btn-save-company').addEventListener('click', function () {
    Object.keys(companyMap).forEach(function (sel) {
      pb.company[companyMap[sel]] = $(sel).value;
    });
    pb.defaults.footerNote = $('#c-footer').value;
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
  var models = null;        // { maker, brand, note, items:[...] }

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

  function loadModels() {
    models = decodeModels(load(KEY_MDL, null));
    renderModelsStatus();
    renderChooser();
  }

  function renderModelsStatus() {
    var el2 = $('#models-status');
    if (!el2) return;
    if (!models) { el2.textContent = 'まだ読み込まれていません。'; return; }
    el2.textContent = models.maker + '　' + models.brand + '　' + models.items.length +
      '機種　（取得日 ' + models.fetched + '）　' + models.note;
  }

  /* 絞り込みの順番。ここの並びがそのまま画面の手順になる */
  var STEPS = [
    { k: 's',  label: 'シリーズ' },
    { k: 'i',  label: '室内機タイプ' },
    { k: 'hp', label: '馬力', fmt: function (v) { return v + '馬力'; } },
    { k: 'tp', label: '台数' },
    { k: 'pw', label: '電源', fmt: function (v) { return v === '三相' ? '三相200V' : '単相200V'; } },
    { k: 'rc', label: 'リモコン' }
  ];
  var chooserSel = {};

  /** いま選ばれている条件に合う機種を返す（stopAt を指定するとそこまでの条件だけで絞る） */
  function chooserMatches(stopAt) {
    if (!models) return [];
    var limit = stopAt == null ? STEPS.length : stopAt;
    return models.items.filter(function (x) {
      for (var i = 0; i < limit; i++) {
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
    srcEl.textContent = models.maker + ' ' + models.brand;

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
        addLine({
          name: models.maker + ' ' + x.s + ' ' + x.i,
          spec: [x.m, x.ab, x.tp, x.pw === '三相' ? '三相200V' : '単相200V', x.rc, x.opt].filter(Boolean).join('　'),
          qty: 1,
          unit: '台',
          price: x.y,
          url: x.u || ''
        });
        toast('「' + x.m + '」を追加しました');
      });
      res.appendChild(b);
    });
    box.appendChild(res);
  }

  $('#btn-chooser-reset').addEventListener('click', function () {
    chooserSel = {};
    renderChooser();
  });

  $('#file-models').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    var r = new FileReader();
    r.onerror = function () { toast('ファイルを読み込めませんでした'); };
    r.onload = function () {
      var data;
      try { data = JSON.parse(r.result); }
      catch (e) { toast('機種データの形式が違います（JSONではありません）'); return; }
      var decoded = decodeModels(data);
      if (!decoded || !decoded.items.length) { toast('機種データの中身が読み取れませんでした'); return; }
      if (save(KEY_MDL, data) === false) return;
      chooserSel = {};
      loadModels();
      toast(decoded.maker + ' の機種データ ' + decoded.items.length + '件を読み込みました');
    };
    r.readAsText(f);
  });

  $('#btn-models-clear').addEventListener('click', function () {
    if (!models) return;
    if (!confirm('機種データを削除します。よろしいですか？\n（見積の明細に入れた機器はそのまま残ります）')) return;
    localStorage.removeItem(KEY_MDL);
    chooserSel = {};
    loadModels();
    toast('機種データを削除しました');
  });

  /* ======================================================================
     見積書の印刷
     ====================================================================== */
  function buildSheet(mode, doc) {
    var d = doc || st;
    mode = mode || 'estimate';
    var inv = (mode === 'invoice');
    var t = calcOf(d);
    var c = pb.company;
    var to = (d.customer || '').trim();
    var hon = d.honorific === '（なし）' ? '' : ('　' + d.honorific);
    var validUntil = d.validDays ? jpDate(addDays(d.date, d.validDays)) + 'まで' : '';

    var rowsHTML = '';
    d.lines.forEach(function (l, i) {
      rowsHTML +=
        '<tr>' +
          '<td class="t-no">' + (i + 1) + '</td>' +
          '<td>' + esc(l.name) + (l.spec ? '<span class="l-spec">' + esc(l.spec) + '</span>' : '') + '</td>' +
          '<td class="t-qty">' + (num(l.qty) % 1 === 0 ? num(l.qty) : num(l.qty).toFixed(1)) + '</td>' +
          '<td class="t-unit">' + esc(l.unit) + '</td>' +
          '<td class="t-price">' + Math.round(num(l.price)).toLocaleString('ja-JP') + '</td>' +
          '<td class="t-amount">' + Math.round(num(l.qty) * num(l.price)).toLocaleString('ja-JP') + '</td>' +
        '</tr>';
    });
    // 見た目を整えるため最低12行になるよう空行を足す
    for (var k = d.lines.length; k < 12; k++) {
      rowsHTML += '<tr><td class="t-no">&nbsp;</td><td></td><td class="t-qty"></td><td class="t-unit"></td><td class="t-price"></td><td class="t-amount"></td></tr>';
    }

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
    var sealHTML = c.sealImage
      ? '<img class="seal-img" src="' + c.sealImage + '" alt="" style="width:' + sealMm + 'mm">'
      : '<span class="seal-fallback">㊞</span>';

    var logoMm = Math.min(40, Math.max(5, num(c.logoHeightMm) || 12));
    var logoHTML = c.logoImage
      ? '<img class="sheet-logo" src="' + c.logoImage + '" alt="" style="height:' + logoMm + 'mm">'
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

    $('#sheet').innerHTML =
      '<div class="sheet-page">' +
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
        '</div>' +
        '<table class="sheet-lines">' +
          '<thead><tr>' +
            '<th class="t-no">No</th><th>品名・仕様</th><th class="t-qty">数量</th>' +
            '<th class="t-unit">単位</th><th class="t-price">単価</th><th class="t-amount">金額</th>' +
          '</tr></thead>' +
          '<tbody>' + rowsHTML + '</tbody>' +
        '</table>' +
        '<div class="sheet-foot">' +
          '<div class="sheet-remarks"><span class="rk">備考</span>' + esc(remarks) + '</div>' +
          '<table class="sheet-sum">' + sumHTML + '</table>' +
        '</div>' +
      '</div>';
  }

  $('#btn-print').addEventListener('click', function () {
    if (!(pb.company.name || '').trim()) {
      toast('先に［自社情報］で会社名を登録してください');
      $('.tab[data-view="settings"]').click();
      return;
    }
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
