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
  function calc() {
    var subtotal = 0;
    st.lines.forEach(function (l) { subtotal += num(l.qty) * num(l.price); });

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
      box.appendChild(b);
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
    st.lines.push(Object.assign({ name: '', spec: '', qty: 1, unit: '式', price: 0, url: '' }, line || {}));
    renderLines();
    persistDraft();
  }

  function renderLines() {
    var tb = $('#lines-body');
    tb.innerHTML = '';
    $('#lines-empty').style.display = st.lines.length ? 'none' : 'block';
    $('#lines-table').style.display = st.lines.length ? 'table' : 'none';

    st.lines.forEach(function (l, i) {
      var tr = el('tr');

      // 並び替え
      var tdMove = el('td', 'c-move');
      var mv = el('div', 'move-btns');
      var up = el('button', 'icon-btn', '▲'); up.type = 'button'; up.title = '上へ';
      var dn = el('button', 'icon-btn', '▼'); dn.type = 'button'; dn.title = '下へ';
      up.addEventListener('click', function () { moveLine(i, -1); });
      dn.addEventListener('click', function () { moveLine(i, 1); });
      mv.appendChild(up); mv.appendChild(dn);
      tdMove.appendChild(mv);
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

      // 単価
      var tdPrice = el('td', 'c-price');
      var iPrice = el('input'); iPrice.type = 'number'; iPrice.step = '1'; iPrice.value = l.price;
      tdPrice.appendChild(iPrice);
      tr.appendChild(tdPrice);

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
      iPrice.addEventListener('input', recalc);

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

  function moveLine(i, dir) {
    var j = i + dir;
    if (j < 0 || j >= st.lines.length) return;
    var tmp = st.lines[i];
    st.lines[i] = st.lines[j];
    st.lines[j] = tmp;
    renderLines();
    persistDraft();
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
  function renderList() {
    var box = $('#estimate-list');
    var list = load(KEY_EST, []);
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(el('p', 'empty-note', 'まだ保存された見積はありません。'));
      return;
    }
    list.sort(function (a, b) { return String(b.savedAt).localeCompare(String(a.savedAt)); });

    list.forEach(function (e) {
      var row = el('div', 'est-row');
      var main = el('div', 'est-main');
      main.appendChild(el('b', null, (e.customer || '（宛名なし）') + '　' + (e.subject || '')));
      main.appendChild(el('small', null, e.no + '　/　' + jpDate(e.date)));
      row.appendChild(main);
      row.appendChild(el('div', 'est-amount', yen(e.total || 0)));

      var open = el('button', 'btn btn-ghost', '開く'); open.type = 'button';
      open.addEventListener('click', function () {
        st = clone(e);
        delete st.total; delete st.savedAt;
        fillMeta(); renderLines(); save(KEY_DRAFT, st);
        $('.tab[data-view="edit"]').click();
        toast('読み込みました');
      });

      var dup = el('button', 'btn btn-ghost', '複製'); dup.type = 'button';
      dup.addEventListener('click', function () {
        st = clone(e);
        delete st.total; delete st.savedAt;
        st.id = 'e' + Date.now();
        st.no = nextNo();
        st.date = todayISO();
        fillMeta(); renderLines(); save(KEY_DRAFT, st);
        $('.tab[data-view="edit"]').click();
        toast('複製しました');
      });

      var del = el('button', 'btn btn-ghost btn-danger', '削除'); del.type = 'button';
      del.addEventListener('click', function () {
        if (!confirm('この見積を削除します。よろしいですか？\n' + e.no + '　' + (e.customer || ''))) return;
        var cur = load(KEY_EST, []).filter(function (x) { return x.id !== e.id; });
        save(KEY_EST, cur);
        renderList();
        toast('削除しました');
      });

      row.appendChild(open); row.appendChild(dup); row.appendChild(del);
      box.appendChild(row);
    });
  }

  $('#btn-export-estimates').addEventListener('click', function () {
    download('50airtec-見積データ-' + todayISO() + '.json', JSON.stringify(load(KEY_EST, []), null, 2));
  });
  $('#file-import-estimates').addEventListener('change', function (ev) {
    readJSON(ev.target, function (data) {
      if (!Array.isArray(data)) { toast('見積データの形式が違います'); return; }
      if (!confirm('保存済みの見積を、読み込んだファイルの内容で置き換えます。よろしいですか？')) return;
      save(KEY_EST, data);
      renderList();
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
    var other = el('option', null, '材料（因幡電工）');
    other.value = '材料（因幡電工）';
    if (!pb.categories.some(function (c) { return c.name === '材料（因幡電工）'; })) sel.appendChild(other);
    var has = function (v) {
      return Array.prototype.some.call(sel.options, function (o) { return o.value === v; });
    };
    // 前の選択を保つ。初回は材料を入れることが多いので材料カテゴリを既定にする
    if (keep && has(keep)) sel.value = keep;
    else if (has('材料（因幡電工）')) sel.value = '材料（因幡電工）';
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
      '材料（因幡電工）,LD-70,スリムダクト LD ダクト,ダクト 70,本,0,https://www.inaba-denko.com/ja/product/detail/1540000',
      '材料（因幡電工）,,ここに実際の品番・品名・定価を入れてください,,個,0,'
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
  function buildSheet() {
    var t = calc();
    var c = pb.company;
    var to = (st.customer || '').trim();
    var hon = st.honorific === '（なし）' ? '' : ('　' + st.honorific);
    var validUntil = st.validDays ? jpDate(addDays(st.date, st.validDays)) + 'まで' : '';

    var rowsHTML = '';
    st.lines.forEach(function (l, i) {
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
    for (var k = st.lines.length; k < 12; k++) {
      rowsHTML += '<tr><td class="t-no">&nbsp;</td><td></td><td class="t-qty"></td><td class="t-unit"></td><td class="t-price"></td><td class="t-amount"></td></tr>';
    }

    var sumHTML = '<tr><th>小計</th><td>' + Math.round(t.subtotal).toLocaleString('ja-JP') + '</td></tr>';
    if (t.overhead) sumHTML += '<tr><th>諸経費</th><td>' + t.overhead.toLocaleString('ja-JP') + '</td></tr>';
    if (t.discount) sumHTML += '<tr><th>値引き</th><td>-' + t.discount.toLocaleString('ja-JP') + '</td></tr>';
    sumHTML += '<tr><th>消費税（' + st.tax + '%）</th><td>' + t.tax.toLocaleString('ja-JP') + '</td></tr>';
    sumHTML += '<tr class="grand"><th>合計</th><td>' + Math.round(t.total).toLocaleString('ja-JP') + '</td></tr>';

    var termsHTML = '';
    function term(k, v) {
      if (!v) return '';
      return '<div><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>';
    }
    termsHTML += term('件　　名', st.subject);
    termsHTML += term('工事場所', st.site);
    termsHTML += term('工　　期', st.delivery);
    termsHTML += term('お支払条件', st.payment);
    termsHTML += term('有効期限', validUntil);

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

    var remarks = (st.note || '') + (c.bank ? '\n\n【お振込先】' + c.bank : '');

    $('#sheet').innerHTML =
      '<div class="sheet-page">' +
        '<div class="sheet-title">御見積書</div>' +
        '<div class="sheet-meta">見積番号：' + esc(st.no) + '<br>発行日：' + esc(jpDate(st.date)) + '</div>' +
        '<div class="sheet-head">' +
          '<div class="sheet-head-left">' +
            '<div class="sheet-to">' + esc(to || '　') + esc(hon) + '</div>' +
            '<p class="sheet-lead">下記の通りお見積り申し上げます。</p>' +
            '<div class="sheet-total-box">' +
              '<span class="label">御見積金額</span>' +
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

  // はじめて開いたときは、自社情報の登録から始めてもらう
  if (!(pb.company.name || '').trim()) {
    $('.tab[data-view="settings"]').click();
    toast('まず会社名などの自社情報を登録してください');
  }
})();
