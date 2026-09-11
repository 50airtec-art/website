/* ======================================================================
   空調王｜カタログPDFから機種データを作る
   ----------------------------------------------------------------------
   メーカーのデジタルカタログからPDFを保存して、この画面に入れると、
   その端末の中だけで読み取って「機種データ」を作る。

   ・よそのサイトを叩かない（社内のPCでも、電波が悪いところでも動く）
   ・PDFも、読み取った中身も、どこにも送らない
   ・だから、メーカーのデータを人に渡すことにはならない

   カタログの作りが変わって読めなくなったら、直すのは MAKERS の中の
   build（どの文字を手がかりにするか）だけ。ほかは触らなくてよい。

   【いちばん大事な約束】
   読み取りは「0件でも黙って通す」ことを絶対にしない。
   件数が下限を割ったら失敗にして、何を疑えばいいかを画面に出す。
   （2026-09-03、金額の「¥」1文字を見落として1社まるごと落としかけた反省）
   ====================================================================== */
(function () {
  'use strict';

  /* --------------------------------------------------------------------
     金額の読み方
     社によって「49,000」「49,000円」「¥49,000」「￥49,000」と書き方が違う。
     1つ通し忘れるとその社が丸ごと落ちるので、ここで全部まとめて受ける。
     -------------------------------------------------------------------- */
  function yen(s) {
    if (s == null) return 0;
    var t = String(s)
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[￥¥,、\s円]/g, '');
    var n = Number(t);
    return isFinite(n) ? n : 0;
  }

  /* --------------------------------------------------------------------
     日本キヤリア（旧東芝）
     店舗・オフィス用カスタムエアコン（デジタルカタログ・1本のPDF）

     形名の読み方（カタログ p.16〜21「形名の見方」より）
       G［タイプ］［シリーズ］［構成］［容量3桁］…［末尾＝リモコン］
     C＝天井吊形 と W＝天カセ2方向 は記号表の並びが紛らわしいので、
     カタログ本文（p.97、p.60）で裏を取ってある。
     -------------------------------------------------------------------- */
  var CARRIER_TYPE = {
    U: '天井カセット形4方向', W: '天井カセット形2方向', S: '天井カセット形1方向',
    C: '天井吊形', K: '壁掛形', B: 'ビルトイン', D: 'ダクト',
    F: '床置形（スタンド）', P: '厨房用天井吊形'
  };
  var CARRIER_SERIES = {
    X: 'ウルトラパワーエコ', S: 'スーパーパワーエコ ゴールド',
    E: 'スマートエコ neo', H: '暖太郎（寒冷地向け）'
  };
  var CARRIER_CONF = { A: 'シングル', B: '同時ツイン', C: '同時トリプル', F: '同時ダブルツイン' };
  var HP = {
    40: 1.5, 45: 1.8, 50: 2, 56: 2.3, 63: 2.5, 71: 2.8, 80: 3, 90: 3.2, 112: 4,
    140: 5, 160: 6, 180: 7, 224: 8, 280: 10, 335: 12, 400: 14, 450: 16, 500: 18, 560: 20
  };

  // 価格ページ＝「セット ¥○○」が2つ以上あるページ
  function carrierIsPricePage(t) {
    return ((t || '').match(/セット\s*[¥￥]/g) || []).length >= 2;
  }

  /** 別売品の読み取り用。「セッ ト ¥」のように割れて来てもよいように、すき間を無視して数える */
  function carrierIsPricePageLoose(t) {
    return ((t || '').replace(/\s+/g, '').match(/セット[¥￥]/g) || []).length >= 2;
  }

  function buildCarrier(pages) {
    var nums = Object.keys(pages).map(Number).sort(function (a, b) { return a - b; });
    var pricePages = nums.filter(function (n) { return carrierIsPricePage(pages[n]); });

    var seen = {}, rows = [];
    pricePages.forEach(function (n) {
      var t = pages[n];
      var re = /セット\s*[¥￥]\s*([\d,]+)/g, m;
      while ((m = re.exec(t)) !== null) {
        var before = t.slice(Math.max(0, m.index - 400), m.index);
        var parts = before.split(/セット\s*[¥￥]\s*[\d,]+|ワイヤレス|ワイヤード|受信部組込|送信部/);
        var tail = parts[parts.length - 1];
        var after = t.slice(m.index, m.index + 900);   // 構成品はセットの後ろに書かれている

        var im = (after.match(/室\s*内\s*([A-Z]{2,4}-[A-Z0-9]+)/) || [])[1] || '';
        var pm = (after.match(/パネル\s*([A-Z]{2,4}-[A-Z0-9]+)/) || [])[1] || '';
        // 室外機は単相ぶんと三相ぶんが続けて書いてある（末尾Jが単相）。電源に合う方を選ぶ
        var omBlock = (after.match(/室\s*外([\s\S]{0,140})/) || [])[1] || '';
        var omCands = [];
        var re2 = /\b([A-Z]{2,4}-[A-Z0-9]+)\b/g, m2;
        while ((m2 = re2.exec(omBlock)) !== null) omCands.push(m2[1]);

        var re3 = /\b([A-Z]{4}\d{5}[A-Z0-9]*)\b\s*(○単)?/g, g;
        while ((g = re3.exec(tail)) !== null) {
          var name = g[1];
          if (seen[name]) continue;
          seen[name] = 1;
          var cap = Number(name.slice(4, 7));
          var hp = HP[cap] || 0;
          var pw = g[2] ? '単相' : '三相';
          var om = '';
          for (var i = 0; i < omCands.length; i++) {
            var isJ = /J$/.test(omCands[i]);
            if ((pw === '単相') === isJ) { om = omCands[i]; break; }
          }
          if (!om) om = omCands[0] || '';
          rows.push({
            m: name, hp: hp, y: yen(m[1]), u: String(n),
            s: CARRIER_SERIES[name[2]] || 'その他',
            i: CARRIER_TYPE[name[1]] || 'その他',
            ab: cap ? 'P' + cap + '形（' + (hp || '?') + '馬力相当）' : '',
            pw: pw,
            rc: /XU$/.test(name) ? 'ワイヤレス' : (/BU$/.test(name) ? '内蔵リモコン' : 'ワイヤード'),
            tp: CARRIER_CONF[name[3]] || '',
            // 形名に P1 が入るものはプラズマ空清つき（同じ容量でも十数万円高い）
            opt: /\d{5}J?P1/.test(name) ? 'プラズマ空清つき' : '',
            om: om, im: im, pm: pm, rm: ''
          });
        }
      }
    });

    return {
      rows: rows,
      pricePages: pricePages.length,
      head: {
        maker: '日本キヤリア（旧東芝）',
        brand: '店舗・オフィス用カスタムエアコン',
        source: '店舗・オフィス用カスタムエアコン（デジタルカタログ）',
        note: '希望小売価格・税抜。消費税/配送費/配管パイプ・据付部材/電気・据付工事費/試運転調整費は含まず。社内利用限定（第三者提供不可）。',
        seriesOrder: ['ウルトラパワーエコ', 'スーパーパワーエコ ゴールド', 'スマートエコ neo', '暖太郎（寒冷地向け）', 'その他'],
        typeOrder: ['シングル', '同時ツイン', '同時トリプル', '同時ダブルツイン'],
        urlBase: 'https://cjc.icata.net/iportal/oc.do?v=CJC00001&d=CJCD01&c=090_90_9999_1&p='
      }
    };
  }

  /* --------------------------------------------------------------------
     日立
     店舗・オフィス用パッケージエアコン総合カタログ

     価格は「セット価格」として、室内機・室外機・化粧パネル・分岐管・
     リモコンの内訳つきで載っている。それをそのまま1機種にする。

     ・「RAS-GP80RGHJ2・GP80RGH2」のように、単相ぶんと三相ぶんが
       1行にまとめて書かれている。分けて2件にする。
     ・日立の価格は「事業者向けの積算見積価格」。ほかの社の希望小売価格
       とは意味が少し違う（note に書いてある）。
     -------------------------------------------------------------------- */
  var HITACHI_TYPE = [
    ['RCIC', 'てんかせJr.'], ['RCID', 'てんかせ2方向'], ['RCIS', 'てんかせ1方向'], ['RCI', 'てんかせ4方向'],
    ['RCB', 'ビルトイン'], ['RPI', 'てんうめ'], ['RPCK', '厨房用てんつり'], ['RPC', 'てんつり'],
    ['RPK', 'かべかけ'], ['RPFI', 'ゆかおき（埋込形）'], ['RPF', 'ゆかおき'],
    /* RPV は外気処理ではなく**ゆかおき（床置形）**。
       ここを外気処理と読んでいたので、60機種が別の型として並び、
       ゆかおきの別売品が1つも出なかった（2026-09-09、NotebookLMで紙面を確認）。
       外気処理エアコンの室内機は RPI-GP…KAF で、セット価格の表には載っていない */
    ['RPV', 'ゆかおき']
  ];
  var HITACHI_TP = { 1: 'シングル', 2: 'ツイン', 3: 'トリプル', 4: 'フォー' };

  function hitachiType(m) {
    for (var i = 0; i < HITACHI_TYPE.length; i++) {
      if (m.indexOf(HITACHI_TYPE[i][0]) === 0) return HITACHI_TYPE[i][1];
    }
    return 'その他';
  }
  function hitachiSeries(om) {
    if (/RGH/.test(om)) return '省エネの達人プレミアム';
    if (/RSH/.test(om)) return '省エネの達人';
    if (/RHN/.test(om)) return '寒さ知らず（寒冷地向け）';
    return 'その他';
  }
  function hitachiRc(rm) {
    if (!rm) return 'リモコン別売';
    return /AWR/.test(rm) ? 'ワイヤレス' : 'ワイヤード';
  }

  function hitachiIsPricePage(t) {
    return (t || '').indexOf('セット価格') >= 0;
  }

  function buildHitachi(pages) {
    var nums = Object.keys(pages).map(Number).sort(function (a, b) { return a - b; });
    var pricePages = nums.filter(function (n) { return hitachiIsPricePage(pages[n]); });

    var rows = [], blocks = 0;
    pricePages.forEach(function (n) {
      var t = pages[n] || '';
      var re = /室内\s*([A-Z]{2,4}-[A-Z0-9]+)\s*(?:×\s*(\d+))?\s*([\d,]+)\s*円([\s\S]*?)セット価格\s*([\d,]+)\s*円/g;
      var m;
      while ((m = re.exec(t)) !== null) {
        blocks++;
        var im = m[1], imN = Number(m[2] || 1), mid = m[4], setYen = m[5];
        var before = t.slice(Math.max(0, m.index - 300), m.index);
        var hpAll = before.match(/（([\d.]+)馬力相当）/g) || [];
        var hp = hpAll.length ? Number(hpAll[hpAll.length - 1].replace(/[^\d.]/g, '')) : 0;
        var omRaw = (mid.match(/室外\s*([A-Z0-9\-]+(?:\s*・\s*[A-Z0-9\-]+)*)/) || [])[1] || '';
        var pm = (mid.match(/化粧パネル\s*([A-Z0-9\-]+)/) || [])[1] || '';
        var rm = (mid.match(/リモコン\s*([A-Z0-9\-]+)/) || [])[1] || '';
        var br = (mid.match(/分岐管\s*([A-Z0-9\-]+)/) || [])[1] || '';
        var type = hitachiType(im);
        var imLabel = im + (imN > 1 ? '×' + imN : '');

        // 単相ぶんと三相ぶんを分ける（「・」でつないで書かれている）
        var heads = omRaw.replace(/\s/g, '').split('・');
        heads.forEach(function (h, i) {
          if (!h) return;
          var om = (i === 0 || h.indexOf('RAS-') === 0) ? h : 'RAS-' + h;
          var pw = /J\d*$/.test(om) ? '単相' : '三相';
          var form = Number((om.match(/(\d{2,3})[A-Z]/) || [])[1]) || 0;
          rows.push({
            m: om + '／' + imLabel,
            hp: hp, y: yen(setYen), u: String(n),
            s: hitachiSeries(om),
            i: type,
            ab: form ? form + '型（' + hp + '馬力相当）' : hp + '馬力相当',
            pw: pw, rc: hitachiRc(rm), tp: HITACHI_TP[imN] || '',
            opt: br ? '分岐管 ' + br : '',
            om: om, im: imLabel, pm: pm, rm: rm
          });
        });
      }
    });

    return {
      rows: rows,
      pricePages: pricePages.length,
      blocks: blocks,          // 読み取れた「セット価格」の塊の数（点検で紙面と突き合わせる）
      head: {
        maker: '日立',
        brand: '店舗・オフィス用パッケージエアコン',
        source: '店舗・オフィス用パッケージエアコン総合カタログ（デジタルカタログ）',
        note: '事業者向けの積算見積価格・税抜。消費税/配送費/試運転調整費/配管セット/工事費は含まず。社内利用限定（第三者提供不可）。',
        seriesOrder: ['省エネの達人プレミアム', '省エネの達人', '寒さ知らず（寒冷地向け）', 'その他'],
        typeOrder: ['シングル', 'ツイン', 'トリプル', 'フォー'],
        urlBase: 'https://www.hitachi-gls.co.jp/catalog/office/book/index.html#target/page_no='
      }
    };
  }

  /* --------------------------------------------------------------------
     パナソニック
     オフィス・店舗用エアコン総合カタログ

     **このメーカーだけ、文字を「位置つき」で読む。**
     紙面が3段組で、素直につなげると隣の段の部材が混ざるため。
     「セット価格」「合計希望小売価格」の x で段を割り出し、段ごとに読む。

     踏んだ落とし穴（2026-09-03 に踏んだもの）
     ・段の境目は「隣との真ん中」ではなく「次の段の左端」。真ん中で切ると金額が落ちる
     ・行にまとめる y の許容は3pt。広いと隣の行と混ざり、狭いと同じ行が割れる
     ・塊の終わりは2通り（「セット価格」＝分岐管あり／「合計希望小売価格」＝分岐管なし）
     ・部材の合計＝合計価格 で検算する。合わない塊は捨てる（金額なので疑わしきは通さない）
     -------------------------------------------------------------------- */
  var PANA_TOL = 3;
  // 金額は「3桁ずつカンマで区切った形」だけを受ける。
  // 紙面には「室内CS-P56FE7C・7CL × 2946,000円」のように、
  // 台数の「×2」と金額がくっついて出てくる行がある。
  // [\d,]{5,} で拾うと「2946,000」＝2,946,000円と読み、200万円ずれて塊ごと落ちる。
  // カンマの位置まで見れば「946,000」だけが取れ、ついでに台数の2も m[3] 側に残る。
  var PANA_MONEY = '((?:\\d{1,3},)+\\d{3})';
  // 「円」は付いていないことがある。紙面でラベルと品番が別の行に割れると
  //   「エパ ネ ル円（税抜）」／「CZ-02HPF3 × 2･････66,000」
  // のように、金額だけが「円」に置いていかれる。円を必須にすると部材が1つ落ち、
  // 検算がずれて塊ごと捨ててしまう。金額はカンマの形で見分けているので円は要らない。
  var PANA_PART = new RegExp('^(.{0,12}?)([A-Z][A-Z0-9\\-]{3,})(.*?)' + PANA_MONEY + '\\s*円?');
  var PANA_END = new RegExp('(セット価格|合計希望小売価格)（工事費別）\\D*' + PANA_MONEY);

  // 室内機のタイプ（品番 PA-P［容量］［ここ］7… の記号）。長い記号から先に見る
  var PANA_TYPE = [
    ['BD', '床置形（ダクト形）'], ['DM', '1方向天井カセット形'], ['FE', 'ビルトインオールダクト形'],
    ['VK', '高温吸込み天吊形厨房用エアコン'],
    ['B', '床置形'], ['D', '高天井用1方向カセット形'], ['E', '天井埋込形'],
    ['F', '天井ビルトインカセット形'], ['K', '壁掛形'], ['L', '2方向天井カセット形'],
    ['T', '天井吊形'], ['U', '4方向天井カセット形'], ['V', '天吊形厨房用エアコン']
  ];
  var PANA_TP = { 1: 'シングル', 2: 'ツイン', 3: 'トリプル', 4: 'ダブルツイン' };

  function panaCols(items) {
    var xs = [];
    items.forEach(function (i) {
      if (/セット価格|合計希望小売価格/.test(i.s)) xs.push(Math.round(i.x));
    });
    if (!xs.length) return null;
    xs.sort(function (a, b) { return a - b; });
    var s = [];
    xs.forEach(function (x) { if (!s.length || x - s[s.length - 1] > 40) s.push(x); });
    return s;
  }

  /** 段の中を行にまとめて、行ごとの文字列にする */
  function panaLines(items, lo, hi) {
    var a = items.filter(function (i) { return i.s.trim() && i.x >= lo && i.x < hi; })
      .sort(function (p, q) { return q.y - p.y || p.x - q.x; });
    var rows = [], cur = null;
    a.forEach(function (it) {
      if (!cur || Math.abs(cur.y - it.y) > PANA_TOL) { cur = { y: it.y, a: [] }; rows.push(cur); }
      cur.a.push(it);
    });
    return rows.map(function (r) {
      return r.a.sort(function (p, q) { return p.x - q.x; })
        .map(function (o) { return o.s; }).join('');
    });
  }

  /** 1つの段を読んで、機種の塊を取り出す */
  function panaColumn(lines, page, carry) {
    var out = [], start = 0;

    // 「合計希望小売価格（工事費別）････円（税抜）」の行に金額が無く、
    // 金額だけが次の行に落ちていることがある（p.121 の床置形など）。
    // 塊の終わりを見つけられずに丸ごと落ちるので、先につないでおく。
    for (var q = 0; q < lines.length - 1; q++) {
      if (!/(セット価格|合計希望小売価格)（工事費別）/.test(lines[q])) continue;
      if (PANA_END.test(lines[q])) continue;
      var nx = lines[q + 1].match(/^\s*([1-9]\d{0,2}(?:,\d{3})+)\s*$/);
      if (nx) { lines[q] = lines[q] + nx[1]; lines[q + 1] = ''; }
    }

    lines.forEach(function (L, idx) {
      var ab = L.match(/P(\d+)\s*形（([\d.]+)\s*馬力相当）/);
      if (ab) { carry.form = Number(ab[1]); carry.hp = Number(ab[2]); }

      var endM = L.match(PANA_END);
      if (!endM) return;
      var blk = lines.slice(start, idx + 1);
      start = idx + 1;
      var setYen = yen(endM[2]);
      var isSet = endM[1] === 'セット価格';

      // 品番は通し番号とセットで書かれていることが多いが、
      //   「標準（ワイヤレス）500○単」／「PA-P45T7SGNCX」
      // のように番号と品番が別の行に割れることがある。番号は当てにしない。
      // 品番は必ず PA-P で始まるので、部材（CS-・CU-・CZ-）と取り違えることはない。
      var mds = [];
      blk.forEach(function (x) {
        var re = /(PA-P[A-Z0-9]{4,})\s*[○●]?\s*([単三])?/g, m;
        while ((m = re.exec(x)) !== null) mds.push({ m: m[1], pw: m[2] || '' });
      });
      if (!mds.length) return;

      var listYen = 0, brYen = 0, afterSum = false, parts = [], brs = [];
      blk.forEach(function (L2) {
        if (PANA_END.test(L2)) { if (!isSet) { listYen = setYen; afterSum = true; } return; }
        var s2 = L2.match(new RegExp('合計希望小売価格\\D*' + PANA_MONEY));
        if (s2) { listYen = yen(s2[1]); afterSum = true; return; }
        // 台数と金額がくっついて出てくる（「×31,386,000円」＝×3で1,386,000円）。
        // 「31,386,000」はカンマの形として正しいので、金額の形だけでは見分けられない。
        // 「×」の直後の数字は台数、と決めて先に切り離す。
        // 台数はできるだけ短く取る（× 2946,000 の台数は 29 ではなく 2）。
        // 金額の先頭は0にならないので、それを手がかりに境目を決める。
        L2 = L2.replace(/×\s*(\d{1,2}?)([1-9]\d{0,2}(?:,\d{3})+)/g, '×$1 $2');

        var m = L2.match(PANA_PART);
        if (!m) return;
        var n = (m[3].match(/×\s*(\d+)/) || [])[1];
        var rec = {
          label: m[1].replace(/[^ぁ-ヿ一-鿿]/g, ''),
          code: m[2], n: n ? Number(n) : 1, yen: yen(m[4])
        };
        if (afterSum) { brs.push(rec); brYen += rec.yen; return; }
        parts.push(rec);
      });
      if (!listYen) listYen = setYen;

      // 検算。合わない塊は捨てる（読み違えた金額を見積に出すほうが怖い）
      var sum = 0;
      parts.forEach(function (p) { sum += p.yen; });
      if (sum !== listYen) return;
      if (listYen + brYen !== setYen) return;

      var find = function (re) {
        for (var i = 0; i < parts.length; i++) if (re.test(parts[i].label)) return parts[i];
        return null;
      };
      var im = find(/内/), om = find(/外/), pm = find(/パネル/);
      var rms = parts.filter(function (p) { return /リモコン/.test(p.label); });

      mds.forEach(function (x) {
        out.push({
          page: page, m: x.m,
          pw: x.pw === '単' ? '単相' : (x.pw === '三' ? '三相' : ''),
          im: im ? im.code : '', imN: im ? im.n : 1,
          om: om ? om.code : '', pm: pm ? pm.code : '',
          rm: rms.map(function (r) { return r.code; }).join('・'),
          br: brs.map(function (b) { return b.code; }).join('・'),
          form: carry.form, hp: carry.hp, y: setYen
        });
      });
    });
    return out;
  }

  /** 1ページぶんの「位置つきの文字」から機種の塊を取り出す */
  function panaReadPage(items, page) {
    var st = panaCols(items);
    if (!st) return [];
    var out = [], carry = {};
    st.forEach(function (s, i) {
      var lo = s - 12;
      var hi = (i === st.length - 1) ? s + 200 : st[i + 1] - 12;
      out.push.apply(out, panaColumn(panaLines(items, lo, hi), page, carry));
    });
    return out;
  }

  /** 品番の記号から室内機のタイプを読む */
  function panaType(m) {
    var sym = (m.match(/^PA-P\d+([A-Z]+)/) || [])[1] || '';
    for (var i = 0; i < PANA_TYPE.length; i++) {
      if (sym.indexOf(PANA_TYPE[i][0]) === 0) return PANA_TYPE[i][1];
    }
    return 'その他';
  }

  /** 品番の記号からシリーズを読む
      PA-P［容量］［タイプ］7［S＝単相］［ここ］…
      G＝Premium／H＝Eco（HZ なら沖縄向け）／K＝寒冷地／M＝中温用 */
  function panaSeries(m) {
    var tail = m.replace(/^PA-P\d+[A-Z]*/, '').replace(/^\d/, '').replace(/^S/, '');
    var c = tail.charAt(0);
    if (c === 'G') return 'XEPHY Premium';
    if (c === 'H') return tail.charAt(1) === 'Z' ? '沖縄向け' : 'XEPHY Eco';
    if (c === 'K') return '寒冷地向け';
    if (c === 'M') return '中温用';
    return 'その他';
  }

  /** 集めた塊を、空調王の行にそろえる */
  function panaFinish(sets) {
    var rows = [], seen = {}, pages = {};
    sets.forEach(function (x) {
      pages[x.page] = 1;
      if (seen[x.m]) return;
      seen[x.m] = 1;
      var hp = x.hp || 0;
      rows.push({
        m: x.m, hp: hp, y: x.y, u: String(x.page),
        s: panaSeries(x.m),
        i: panaType(x.m),
        ab: x.form ? x.form + '形（' + (hp || '?') + '馬力相当）' : '',
        pw: x.pw || (/^PA-P\d+[A-Z]*\d?S/.test(x.m) ? '単相' : '三相'),
        rc: !x.rm ? 'リモコン別売' : (/CZ-\d*RW/.test(x.rm) ? 'ワイヤレス' : 'ワイヤード'),
        tp: PANA_TP[x.imN] || 'シングル',
        opt: x.br ? '別売分岐管 ' + x.br : '',
        om: x.om, im: x.im + (x.imN > 1 ? '×' + x.imN : ''), pm: x.pm, rm: x.rm
      });
    });
    return {
      rows: rows,
      pricePages: Object.keys(pages).length,
      head: {
        maker: 'パナソニック',
        brand: 'オフィス・店舗用エアコン',
        source: 'オフィス・店舗用エアコン総合カタログ（デジタルカタログ）',
        note: '希望小売価格・税抜。配管/据付工事費は含まず。社内利用限定（第三者提供不可）。',
        seriesOrder: ['XEPHY Premium', 'XEPHY Eco', '寒冷地向け', '中温用', '沖縄向け', 'その他'],
        typeOrder: ['シングル', 'ツイン', 'トリプル', 'ダブルツイン'],
        urlBase: 'https://panasonic.icata.net/iportal/CatalogSearch.do?method=catalogSearchByAnyCategories&volumeID=PEWJ0001&categoryID=353090000#'
      }
    };
  }

  /* --------------------------------------------------------------------
     ダイキン
     店舗・オフィスエアコン（スカイエア）

     **パナソニックと同じく位置つきで読む。ただし行の文字をつなげない。**
     PDFの中では［別売リモコンBRC1G4］［46,000］［円］と部品が分かれている。
     つなげると「BRC1G4＋46,000」か「BRC1G＋446,000」か分からなくなる
     （400,000円ずれる）。部品のまま「数字だけの部品＝金額」と読む。

     ・紙面は4段組。「合計価格／セット価格」の x で段を割る
     ・塊の終わりは「合計価格」か「セット価格」の2通り
     ・ワイヤレス版は差分しか書いていない（リモコンだけ差し替え）。
       直前の塊の部材を引き継ぐ。引き継ぎ違いは検算で落ちるので危なくない
     -------------------------------------------------------------------- */
  var DAIKIN_TOL = 3;
  var DAIKIN_MONEY_CELL = /^((?:[1-9]\d{0,2},)?\d{1,3},\d{3})$/;
  // 品番は必ず英字で終わる（D-SEARCHの1,063件すべてで確認）。
  // 末尾に数字を許すと、紙面で品番のうしろに続く通し番号まで飲み込み、
  // 「SZRUC40CV401SZRUC40CT403」のような幻の品番ができる。
  var DAIKIN_CODE_RE = /(S[DSZ]R[A-Z]{1,3}\d{2,3}[A-Z]*)/g;

  // タイプ記号（S?R のあとの英字）。長い記号から先に見る
  var DAIKIN_TYPE = [
    ['JMM', '天井埋込ダクト形'], ['HU', 'スタイリッシュフロー'], ['JH', '天井吊形'],
    ['JM', '天井埋込ダクト形'], ['MH', '天井埋込ダクト形'], ['MM', '天井埋込ダクト形'],
    ['UC', '天井埋込カセット形 Ｓ－ラウンドフロー'],
    ['A', '壁掛形'], ['B', '天井埋込カセット形 ビルトインＨｉ'],
    ['C', '天井埋込カセット形 Ｓ－ラウンドフロー'], ['G', '天井埋込カセット形 エコ・ダブルフロー'],
    ['H', '天井吊形'], ['K', '天井埋込カセット形 シングルフロー'],
    ['M', '天井埋込ダクト形'], ['N', '天井埋込カセット形 マルチフロー（ショーカセ）'],
    ['T', '厨房用エアコン'], ['U', '天吊自在形ワンダ風流'], ['V', '床置形']
  ];
  var DAIKIN_SERIES = { SDR: 'スゴ暖ＺＥＡＳ', SSR: 'ＦＩＶＥ ＳＴＡＲ ＺＥＡＳ', SZR: 'ＥＣＯ ＺＥＡＳ' };
  var DAIKIN_TP = { 1: 'シングル', 2: 'ツイン', 3: 'トリプル', 4: 'ダブルツイン' };

  function daikinCols(items) {
    var xs = [];
    items.forEach(function (i) { if (/合計価格|セット価格/.test(i.s)) xs.push(Math.round(i.x)); });
    if (!xs.length) return null;
    xs.sort(function (a, b) { return a - b; });
    var s = [];
    xs.forEach(function (x) { if (!s.length || x - s[s.length - 1] > 40) s.push(x); });
    return s;
  }

  /** 段の中を行にまとめる。文字はつなげず、部品のまま持つ */
  function daikinRows(items, lo, hi) {
    var a = items.filter(function (i) { return i.s.trim() && i.x >= lo && i.x < hi; })
      .sort(function (p, q) { return q.y - p.y || p.x - q.x; });
    var rows = [], cur = null;
    a.forEach(function (o) {
      if (!cur || Math.abs(cur.y - o.y) > DAIKIN_TOL) { cur = { y: o.y, c: [] }; rows.push(cur); }
      cur.c.push(o);
    });
    return rows.map(function (r) {
      var c = r.c.sort(function (p, q) { return p.x - q.x; });
      return { cells: c, text: c.map(function (o) { return o.s; }).join('') };
    });
  }

  /** 1行から「ラベル・品番・金額」を取る。数字だけの部品を金額とみなす */
  function daikinPart(row) {
    var mi = -1;
    row.cells.forEach(function (c, i) { if (DAIKIN_MONEY_CELL.test(c.s.trim())) mi = i; });
    if (mi < 0) return null;
    var head = row.cells.slice(0, mi).map(function (o) { return o.s; }).join('');
    // 品番のうしろに「×2」「×3」が付くことがある（ツイン・トリプル）
    var cm = head.match(/([A-Z][A-Z0-9\-]*(?:・[A-Z0-9\-]+)*)\s*(?:×\s*(\d+))?\s*$/);
    if (!cm) return null;
    return {
      label: head.slice(0, head.length - cm[0].length).replace(/[^ぁ-ヿ一-鿿]/g, ''),
      code: cm[1], n: cm[2] ? Number(cm[2]) : 1, yen: yen(row.cells[mi].s)
    };
  }

  function daikinEnd(row) {
    if (!/合計価格|セット価格/.test(row.text)) return null;
    var v = 0;
    row.cells.forEach(function (c) { if (DAIKIN_MONEY_CELL.test(c.s.trim())) v = yen(c.s); });
    if (!v) return null;
    return { kind: /セット価格/.test(row.text) ? 'set' : 'sum', yen: v };
  }

  function daikinColumn(rows, page, out) {
    var start = 0, carry = null, form = 0, hp = 0;
    rows.forEach(function (row, idx) {
      var ab = row.text.match(/(\d{2,3})\s*形\s*（\s*([\d.]+)\s*馬力相当/);
      if (ab) { form = Number(ab[1]); hp = Number(ab[2]); }

      var e = daikinEnd(row);
      if (!e) return;
      var blk = rows.slice(start, idx + 1);
      start = idx + 1;

      var mds = [];
      blk.forEach(function (r) {
        var re = new RegExp(DAIKIN_CODE_RE.source, 'g'), m;
        while ((m = re.exec(r.text.replace(/\s/g, ''))) !== null) mds.push(m[1]);
      });
      if (!mds.length) return;

      var sumYen = 0, afterSum = false, brYen = 0, parts = [], brs = [];
      blk.forEach(function (r) {
        var ee = daikinEnd(r);
        if (ee) { if (ee.kind === 'sum') { sumYen = ee.yen; afterSum = true; } return; }
        var rec = daikinPart(r);
        if (!rec) return;
        if (afterSum) { brs.push(rec); brYen += rec.yen; return; }
        parts.push(rec);
      });
      if (!parts.length) return;
      if (!sumYen) sumYen = e.yen;

      // 室内機が書かれていない塊は、上の塊から引き継ぐ（リモコンだけ差し替える）
      var use = parts;
      var hasIm = parts.some(function (p) { return /室内/.test(p.label); });
      if (!hasIm && carry) {
        var kinds = {};
        parts.forEach(function (p) { kinds[p.label] = 1; });
        use = carry.filter(function (p) { return !kinds[p.label]; }).concat(parts);
      }

      var calc = 0;
      use.forEach(function (p) { calc += p.yen; });
      if (calc !== sumYen) return;                                   // 検算。合わない塊は捨てる
      if (e.kind === 'set' && sumYen + brYen !== e.yen) return;
      if (use.some(function (p) { return /室内/.test(p.label); })) carry = use;

      var find = function (re) {
        for (var i = 0; i < use.length; i++) if (re.test(use[i].label)) return use[i];
        return null;
      };
      var im = find(/室内/), om = find(/室外/), pm = find(/パネル/), rm = find(/リモコン/);
      mds.forEach(function (code) {
        out.push({
          page: page, m: code, form: form, hp: hp,
          im: im ? im.code : '', imN: im ? im.n : 1,
          om: om ? om.code : '', pm: pm ? pm.code : '', rm: rm ? rm.code : '',
          br: brs.map(function (b) { return b.code; }).join('・'),
          y: e.kind === 'set' ? e.yen : sumYen
        });
      });
    });
  }

  /* 品番が横一列に並び、そのすぐ下に価格が横一列に並ぶ形の表。
     （p.72 の「ツイン・トリプル同時マルチ」など）
     段組みでもなく、塊の終わりを示す「合計価格」の行も無いので、
     ふつうの読み方では1件も取れない。x の近さで品番と価格を結ぶ。

     「SSRJH63DT(V)」は1つのマスに2機種ぶん書いてある書き方。
     紙面に「（V）は単相200V電源機種です。その他は全て3相200V」とあるので、
     三相の SSRJH63DT と単相の SSRJH63DTV の2つに分ける。

     この表は部材の内訳が無いので、**検算ができない**。
     代わりに「品番と金額の x が60pt以内で並んでいる」ことだけを頼りにする。 */
  function daikinWideTable(items, page) {
    var rows = daikinRows(items, -1e9, 1e9);
    var out = [];
    for (var i = 0; i < rows.length - 1; i++) {
      var codes = rows[i].cells.filter(function (c) {
        return /^S[DSZ]R[A-Z]{1,3}\d{2,3}[A-Z]*(\(V\))?$/.test(c.s.replace(/\s/g, ''));
      });
      if (codes.length < 2) continue;
      var money = rows[i + 1].cells.filter(function (c) { return DAIKIN_MONEY_CELL.test(c.s.trim()); });
      if (money.length < codes.length) continue;

      codes.forEach(function (c) {
        var best = null, bd = 1e9;
        money.forEach(function (m) { var d = Math.abs(m.x - c.x); if (d < bd) { bd = d; best = m; } });
        if (!best || bd > 60) return;
        var raw = c.s.replace(/\s/g, '');
        var base = raw.replace(/\(V\)$/, '');
        var list = /\(V\)$/.test(raw) ? [base, base + 'V'] : [base];
        list.forEach(function (code) {
          out.push({ page: page, m: code, form: 0, hp: 0, im: '', imN: 1,
                     om: '', pm: '', rm: '', br: '', y: yen(best.s) });
        });
      });
    }
    return out;
  }

  function daikinReadPage(items, page) {
    var out = [];
    var st = daikinCols(items);
    if (st) {
      st.forEach(function (s, i) {
        var lo = s - 12;
        var hi = (i === st.length - 1) ? s + 200 : st[i + 1] - 12;
        daikinColumn(daikinRows(items, lo, hi), page, out);
      });
    }
    // ふつうの読み方で1件も取れなかったページだけ、横並びの表として読み直す
    if (!out.length) out = daikinWideTable(items, page);
    return out;
  }

  function daikinType(m) {
    var sym = (m.match(/^S[DSZ]R([A-Z]{1,3})\d/) || [])[1] || '';
    for (var i = 0; i < DAIKIN_TYPE.length; i++) {
      if (sym.indexOf(DAIKIN_TYPE[i][0]) === 0) return DAIKIN_TYPE[i][1];
    }
    return 'その他';
  }

  /* セットに除菌ユニットが入っているかどうか。

     SSRH112D と SSRJH112D は、室外機も室内機もリモコンも同じで
     値段だけ17万円ちがう。SSRJH のほうに
     ストリーマ除菌ユニット BAEF50A160（¥170,000）が入っているためで、
     1,536,000＋170,000＝1,706,000 でぴったり合う。

     形名の頭で見分けられる（D-SEARCHの1,063機種ぜんぶで確かめた。混ざりは0）

       …RJH / …RUC  → ストリーマ除菌ユニット      91機種
       …RJM         → ダクト接続式除菌ユニット    44機種

     印を出さないと、見た目が同じ機種が2つ並んで、
     安いほうと高いほうを取り違える（2026-09-09、BIGBOSSの指摘） */
  function daikinKit(m) {
    if (/^S[DSZ]R(JH|UC)/.test(m)) return 'ストリーマ除菌ユニットつき';
    if (/^S[DSZ]RJM/.test(m)) return 'ダクト接続式除菌ユニットつき';
    return '';
  }

  function daikinFinish(sets) {
    var rows = [], seen = {}, pages = {};
    sets.forEach(function (x) {
      pages[x.page] = 1;
      if (seen[x.m]) return;
      seen[x.m] = 1;
      var cap = Number((x.m.match(/^S[DSZ]R[A-Z]{1,3}(\d{2,3})/) || [])[1]) || 0;
      var hp = x.hp || HP[cap] || 0;
      // 容量より後ろに V があれば単相（CV・CNV・CVD）。無ければ三相
      var tail = x.m.replace(/^S[DSZ]R[A-Z]{1,3}\d{2,3}/, '');
      rows.push({
        m: x.m, hp: hp, y: x.y, u: String(x.page),
        s: DAIKIN_SERIES[x.m.slice(0, 3)] || 'その他',
        i: daikinType(x.m),
        ab: cap ? cap + '形（' + (hp || '?') + '馬力相当）' : '',
        pw: /V/.test(tail) ? '単相' : '三相',
        rc: !x.rm ? 'リモコン別売' : (/^BRC1/.test(x.rm) ? 'ワイヤード' : 'ワイヤレス'),
        tp: DAIKIN_TP[x.imN] || 'シングル',
        opt: [daikinKit(x.m), x.br ? '別売分岐管 ' + x.br : ''].filter(Boolean).join('　'),
        om: x.om, im: x.im + (x.imN > 1 ? '×' + x.imN : ''), pm: x.pm, rm: x.rm
      });
    });
    return {
      rows: rows,
      pricePages: Object.keys(pages).length,
      head: {
        maker: 'ダイキン',
        brand: 'スカイエア（店舗・オフィスエアコン）',
        source: '店舗・オフィスエアコン スカイエア（公開デジタルカタログ）',
        note: '希望小売価格・税抜。配管/据付工事費は含まず。社内利用限定（第三者提供不可）。',
        seriesOrder: ['ＦＩＶＥ ＳＴＡＲ ＺＥＡＳ', 'ＥＣＯ ＺＥＡＳ', 'スゴ暖ＺＥＡＳ', 'その他'],
        typeOrder: ['シングル', 'ツイン', 'トリプル', 'ダブルツイン'],
        urlBase: 'https://ec.daikinaircon.com/ecatalog/index.html#'
      }
    };
  }

  /* --------------------------------------------------------------------
     ダイキン ルームエアコン（住宅設備用カタログ）……まずは壁掛形
     --------------------------------------------------------------------
     家電の店に並ぶモデルはオープン価格だが、工事店向けの住宅設備用カタログには、
     スタンダード（Eシリーズ）以外に希望小売価格が載っている
     （2026-09-11、BIGBOSSの「オープンなのはスタンダードモデルだけ」で調べ直した。
       私は確かめずに「ルームエアコンはオープン価格が多い」と言っていた）。

     1台ぶんは、3列に並んだ小さな表
       S286ATRS-W(-C)
       価格 605,000円（税抜き 550,000円）          ← 品番と同じ行か、すぐ下の行
       室内 F286ATRS-W(-C)／質量16kg   室内電源 単 100 V 20A
       室外 R286ARS／質量46kg
       （品番の上に「おもに 10 畳程度」）
     品番の形：S ＋ 能力の数字3けた（28＝2.8kW）＋ AT（壁掛形）＋ シリーズの字 ＋ 電源の字
       電源の字は S＝単相100V、P・V＝単相200V（Vは室外から電源をとる形）

     ・カタログのはじめの一覧表にも品番と値段が並ぶが、室内機・室外機の品番が無い。
       品番と値段だけ拾うと別の列の値段を掴むので、室内機と室外機がそろったものだけ採る
     ・天井埋込などのハウジングエアコンは、パネル別売の「合計価格」があって形が違うので、まだ読まない
     -------------------------------------------------------------------- */
  var DK_ROOM_SERIES = {
    R: 'RXシリーズ', A: 'AXシリーズ', S: 'SXシリーズ', G: 'GXシリーズ', C: 'CXシリーズ',
    D: 'DXシリーズ', H: 'HXシリーズ', K: 'KXシリーズ', E: 'Eシリーズ'
  };
  /* ハウジングエアコンは、能力の数字のあとの記号でシリーズと形が決まる（38〜52ページの見出しで確かめた）
       S28ZCRV   CRシリーズ   天井埋込カセット形 シングルフロー
       S284ACDV  CDシリーズ   天井埋込カセット形 シングルフロー（スゴ暖）
       S28ZCV    Cシリーズ    天井埋込カセット形 シングルフロー
       S40ZGV    ダブルフロー 天井埋込カセット形 ダブルフロー
       S285AVRV  VRシリーズ   床置形／S285AVDV VDシリーズ／S285AVV Vシリーズ
       S28ZMV    壁埋込形
       S283ALV   アメニティビルトイン／S286ALDV フリービルトイン */
  var DK_ROOM_KIND = {
    ZCR: ['CRシリーズ', '天井埋込カセット形（シングルフロー）'],
    ACD: ['CDシリーズ', '天井埋込カセット形（シングルフロー）'],
    ZC: ['Cシリーズ', '天井埋込カセット形（シングルフロー）'],
    ZG: ['ダブルフロー', '天井埋込カセット形（ダブルフロー）'],
    AVR: ['VRシリーズ', '床置形'],
    AVD: ['VDシリーズ', '床置形'],
    AV: ['Vシリーズ', '床置形'],
    ZM: ['壁埋込形', '壁埋込形'],
    AL: ['アメニティビルトイン', 'ビルトイン形'],
    ALD: ['フリービルトイン', 'ビルトイン形']
  };
  // 能力（kW）ごとの「おもに○畳」。紙面の「○畳程度」が読めなかったときだけ使う
  var ROOM_TATAMI = { 22: 6, 25: 8, 28: 10, 36: 12, 40: 14, 45: 15, 50: 16, 56: 18, 63: 20, 71: 23, 80: 26, 90: 29 };
  // S ＋ 能力2けた ＋（年式の数字）＋ 形の記号 ＋ 電源の字（S＝単相100V、P・V＝単相200V）
  var DK_ROOM_CODE = /^(S(\d{2})\d?([A-Z]{2,3})([SPV]))(?=-|\s|$)/;
  // 別売のパネル・グリル・据付枠の品番
  var DK_ROOM_PARTS = /(BCF\d{3}[A-Z](?:-[A-Z])?|BC\d{2}[A-Z]*(?:-[A-Z]+)?|BG\d{2}[A-Z]*(?:-[A-Z]+)?|KDG\d{3}[A-Z]\d*|KKF\d{3}[A-Z]\d*[A-Z]?)/g;

  function dkRoomKind(sym) {
    if (/^AT/.test(sym)) return DK_ROOM_SERIES[sym.charAt(2)] ? [DK_ROOM_SERIES[sym.charAt(2)], '壁掛形'] : null;
    return DK_ROOM_KIND[sym] || null;
  }

  function dkRoomReadPage(items, page) {
    var out = [];
    var codes = [];
    items.forEach(function (c) {
      var m = c.s.trim().match(DK_ROOM_CODE);
      if (m && dkRoomKind(m[3])) codes.push({ c: c, m: m });
    });
    codes.forEach(function (k) {
      var c = k.c, m = k.m, kind = dkRoomKind(m[3]);
      // その品番の列（3列並びの1列ぶん）の文字だけを見る
      var band = items.filter(function (o) { return o.x >= c.x - 6 && o.x < c.x + 150; });
      function sel(dyLo, dyHi) {
        return band.filter(function (o) { var dy = o.y - c.y; return dy >= dyLo && dy <= dyHi; })
          .sort(function (a, b) { return b.y - a.y || a.x - b.x; });
      }
      // HXシリーズのページだけ、すき間が空白ではなく制御文字（U+0007）で来る。
      // 「（税抜き␇390,000円）」「単␇100 V」を読めず、HXが1台も入らなかった
      function clean(t) { return t.replace(/[\u0000-\u001f]/g, ' '); }
      function text(dyLo, dyHi) {
        return sel(dyLo, dyHi).map(function (o) { return clean(o.s); }).join(' ');
      }
      var head = text(-14, 2);
      var price = head.match(/税抜き\s*([\d,]+)\s*円/);
      // Eシリーズ（スタンダード）は「オープン価格」。機種は入れて、値段は0（仕入先の見積で入れる）
      var open = !price && /オープン価格/.test(head);
      var im = text(-32, -4).match(/(F\d{2,3}[A-Z]{2,5})(?=[-／\s(]|$)/);
      // 室外機の品番のうしろは「／質量46kg」のことも「 297,000円」のこともある（SXシリーズ）
      var om = text(-48, -8).match(/(R\d{2,3}[A-Z]{2,5})(?=[-／\s(]|$)/);
      // カタログのはじめの一覧表は品番と値段だけで、室内機・室外機が無い。そろったものだけ採る
      if ((!price && !open) || !im || !om) return;
      var pw = text(-36, -14).match(/単\s*(100|200)\s*V/);
      var tat = text(4, 26).match(/(\d{1,2})\s*畳程度/);
      // SXシリーズ（risora）はパネル込みのセット価格。パネルの品番も覚えておく
      var inPanel = text(-34, -20).match(/パネル\s*：?\s*(BC[A-Z0-9]+)/);
      var cap = Number(m[2]);
      var base = {
        page: page, m: m[1], y: price ? yen(price[1]) : 0, im: im[1], om: om[1],
        pm: inPanel ? inPanel[1] : '',
        kw: cap / 10,
        tat: tat ? Number(tat[1]) : (ROOM_TATAMI[cap] || 0),
        pw: '単相' + (pw ? pw[1] : (m[4] === 'S' ? '100' : '200')) + 'V',
        s: kind[0], i: kind[1],
        opt: open ? 'オープン価格（値段は仕入先の見積で）' : ''
      };

      /* 天井埋込カセット・壁埋込形は、パネルやグリルが別売。
         セットの価格の下に「フラットパネル（別売）BC40JF-WF 価格…」「採用時 合計価格 693,000円（税抜き 630,000円）」
         が組み合わせの数だけ並ぶ。セットだけの値段では見積にならないので、合計価格ごとに1台として出す。
         下を見るのは、同じ列の次の品番の少し上まで */
      var lo = -110;
      codes.forEach(function (k2) {
        if (k2 === k || Math.abs(k2.c.x - c.x) > 20 || k2.c.y >= c.y) return;
        lo = Math.max(lo, k2.c.y - c.y + 25);
      });
      var rows = [];
      sel(lo, -30).forEach(function (o) {
        var r = null;
        rows.forEach(function (x) { if (Math.abs(x.y - o.y) <= 1.5) r = x; });
        if (!r) { r = { y: o.y, s: '' }; rows.push(r); }
        r.s += clean(o.s) + ' ';
      });
      rows.sort(function (a, b) { return b.y - a.y; });
      var parts = [], names = [], variants = [];
      rows.forEach(function (r) {
        var flat = r.s.replace(/\s+/g, '');
        (r.s.match(DK_ROOM_PARTS) || []).forEach(function (x) { if (parts.indexOf(x) < 0) parts.push(x); });
        (flat.match(/フラットパネル|標準パネル|別売パネル|和風グリル|据付枠/g) || []).forEach(function (x) {
          if (names.indexOf(x) < 0) names.push(x);
        });
        var tot = /合計価格/.test(flat) && r.s.match(/税抜き\s*([\d,]+)\s*円/);
        if (tot) {
          variants.push({ y: yen(tot[1]), pm: parts.join('・'), label: names.join('＋') });
          parts = []; names = [];
        }
      });
      if (!variants.length) { out.push(base); return; }
      variants.forEach(function (v) {
        var x = {};
        for (var key in base) x[key] = base[key];
        x.y = v.y; x.pm = v.pm;
        x.opt = (v.label || 'パネル') + '込み';
        out.push(x);
      });
    });
    return out.concat(dkMultiReadPage(items, page));
  }

  /* --------------------------------------------------------------------
     ダイキン マルチエアコン（住宅設備用カタログ 53〜59ページ）
     --------------------------------------------------------------------
     室外機1台に室内機を何台かつなぐ形なので、セットの品番が無い（マルチパックだけはある）。
     機器を選ぶで1台ずつ明細に足していけるように、室外機と室内機を別々の1台として入れる。
       マルチパック   PAC-403AV  室内 C22RTV×2 ＋ 室外 MP403AV（パック価格）
       ココタス室外機 2M30YCV・2M403ACV（品番が「2M」「30YCV」と2つに割れて来る）
       システムマルチ室外機 2M455AV〜5M1005AV（頭の数字が何室用か）
       室内機         C28ZCV・C285AVV-W・C223ATSVW …… パネルが別売のものは「合計価格」ごとに1台
     室内機の一覧は、パネル違いの「合計価格」が同じ行に2つ並ぶ（フラットパネル・標準パネル）。
     だから合計価格は、文字の x の位置ごとに見る。
     壁埋込形の「別売前面グリル・据付枠合計価格」はグリルと据付枠だけの合計なので、本体の値段に足す
     -------------------------------------------------------------------- */
  var DK_MULTI_IN = {
    ZC: '天井埋込カセット形（シングルフロー）', ZG: '天井埋込カセット形（ダブルフロー）', AV: '床置形',
    ZM: '壁埋込形', YCC: '小空間マルチ（ココタス）', AL: 'ビルトイン形',
    RT: '壁掛形', VTCC: '壁掛形', AT: '壁掛形', ATC: '壁掛形', ATCS: '壁掛形', ATS: '壁掛形'
  };

  function dkCapLabel(cap) {
    var t = ROOM_TATAMI[cap];
    return (cap / 10).toFixed(1) + 'kW' + (t ? '（おもに' + t + '畳）' : '');
  }

  function dkPanelName(code) {
    if (/^BCF\d/.test(code)) return '別売パネル';
    if (/^BC\d{2}JF/.test(code)) return 'フラットパネル';
    if (/^BC\d{2}J-/.test(code)) return '標準パネル';
    return '';
  }

  function dkMultiReadPage(items, page) {
    function clean(t) { return t.replace(/[\u0000-\u001f]/g, ' '); }
    var all = clean(items.map(function (o) { return o.s; }).join(' '));
    // 別売品の一覧のページにも室内機の品番は出るが、そこは読まない。
    // 「マルチ」の字では絞らない（59ページの室内機の一覧には「マルチ」の字が無く、丸ごと落ちていた）
    if (/別売品の種類/.test(all)) return [];

    // 「2M」「30YCV」のように割れて来る室外機の品番をつなぐ
    var its = items.slice();
    items.forEach(function (o) {
      if (!/^\dM$/.test(o.s.trim())) return;
      var nx = null;
      items.forEach(function (q) {
        if (q !== o && Math.abs(q.y - o.y) < 1 && q.x > o.x && q.x - o.x < 20 && (!nx || q.x < nx.x)) nx = q;
      });
      if (nx) its.push({ s: o.s.trim() + nx.s.trim(), x: o.x, y: o.y, w: 0 });
    });

    var codes = [];
    its.forEach(function (o) {
      var t = clean(o.s).trim(), m;
      if ((m = t.match(/^PAC-(\d{3})AV$/))) {
        codes.push({ o: o, kind: 'pack', m: 'PAC-' + m[1] + 'AV' });
      } else if ((m = t.match(/^(\d)M(\d{2,4})([A-Z]{1,3})V$/))) {
        var d = m[2];
        codes.push({ o: o, kind: 'out', m: t, rooms: Number(m[1]), cap: Number(d.length >= 4 ? d.slice(0, 3) : d.slice(0, 2)), coco: /YC|AC/.test(m[3]) });
      } else if ((m = t.match(/^C(\d{2})(\d?)([A-Z]{2,4}?)V([WK]?)(?=$|[-(（／\s])/)) && DK_MULTI_IN[m[3]]) {
        codes.push({ o: o, kind: 'in', m: 'C' + m[1] + m[2] + m[3] + 'V' + m[4], cap: Number(m[1]), type: DK_MULTI_IN[m[3]] });
      }
    });

    var out = [];
    codes.forEach(function (k) {
      var o = k.o;
      // その品番の列：右どなりの品番（上下120ポイント以内）の手前まで
      var bx1 = o.x + 150;
      codes.forEach(function (k2) {
        if (k2 !== k && k2.o.x > o.x + 20 && Math.abs(k2.o.y - o.y) < 120) bx1 = Math.min(bx1, k2.o.x - 6);
      });
      var band = its.filter(function (q) { return q.x >= o.x - 6 && q.x < bx1; });
      function sel(dyLo, dyHi) {
        return band.filter(function (q) { var dy = q.y - o.y; return dy >= dyLo && dy <= dyHi; })
          .sort(function (a, b) { return b.y - a.y || a.x - b.x; });
      }
      function text(dyLo, dyHi) { return sel(dyLo, dyHi).map(function (q) { return clean(q.s); }).join(' '); }

      // 値段は「税抜き」と4けた以上の数。「（税抜き 249,000」「円）」と別の行に割れることがある（58ページ C40ZGV）
      var TAX = /税抜き\s*([\d,]{4,})/;
      // ビルトイン形（59ページ C283ALV）は値段の行が品番の18〜25ポイント下にある。上から順に見るので、自分の値段が先に当たる
      var price = text(-26, 2).match(TAX);
      if (!price) return;
      var y = yen(price[1]);
      var pw = text(-20, 2).match(/単\s*(100|200)\s*V/);

      if (k.kind === 'pack') {
        var ins = text(-40, -8).match(/C\d{2}RTV/g) || [];
        var om = text(-50, -10).match(/MP\d{3}AV/);
        if (!ins.length || !om) return;
        var caps = ins.map(function (c) { return (Number(c.slice(1, 3)) / 10).toFixed(1) + 'kW'; });
        out.push({
          page: page, m: k.m, y: y, om: om[0],
          im: ins.every(function (c) { return c === ins[0]; }) ? ins[0] + '×' + ins.length : ins.join('＋'),
          pm: '', cap: caps.join('＋') + '（' + ins.length + '室）',
          s: 'マルチパック', i: '壁掛形（' + ins.length + '室パック）', tp: 'マルチパック（' + ins.length + '室）',
          pw: '単相' + (pw ? pw[1] : '200') + 'V', rc: 'ワイヤレス', opt: ''
        });
        return;
      }
      if (k.kind === 'out') {
        out.push({
          page: page, m: k.m, y: y, om: k.m, im: '', pm: '',
          cap: (k.cap / 10).toFixed(1) + 'kW（' + k.rooms + '室用）',
          s: k.coco ? 'ココタス（室外機）' : 'システムマルチ（室外機）', i: 'マルチ室外機', tp: k.rooms + '室用',
          pw: '単相' + (pw ? pw[1] : '200') + 'V', rc: '', opt: ''
        });
        return;
      }

      // 室内機。パネル・グリルが別売なら「合計価格」ごとに1台
      var base = {
        page: page, m: k.m, y: y, om: '', im: k.m, pm: '', cap: dkCapLabel(k.cap),
        s: 'マルチ用室内機', i: k.type, tp: 'マルチ用室内機', pw: '室外機から', rc: 'ワイヤレス', opt: ''
      };
      var lo = -100;
      codes.forEach(function (k2) {
        if (k2 === k || k2.o.y >= o.y || k2.o.x < o.x - 6 || k2.o.x >= bx1) return;
        // 色違いの兄弟（最後の W・K だけ違う）は、同じ1組なのでさえぎらない
        if (k2.kind === 'in' && k2.m.replace(/[WK]$/, '') === k.m.replace(/[WK]$/, '') && o.y - k2.o.y < 15) return;
        lo = Math.max(lo, k2.o.y - o.y + 12);
      });
      // 「別売グリル・据付枠別」とある室内機（ビルトイン形）は、グリルと据付枠が別に要る
      if (/グリル・?据付枠別/.test(text(-12, 2).replace(/\s+/g, ''))) base.opt = '別売グリル・据付枠が別に必要';
      var tots = sel(lo, -5).filter(function (q) { return /合計価格/.test(clean(q.s)); });
      var used = [], prevByCol = [], variants = [];
      tots.forEach(function (T) {
        function near(q, dyLo, dyHi, xLo, xHi) {
          return q.y - T.y >= dyLo && q.y - T.y <= dyHi && q.x >= T.x + xLo && q.x <= T.x + xHi;
        }
        var cand = band.filter(function (q) { return near(q, -3, 3, -5, 120) && TAX.test(clean(q.s)); });
        if (!cand.length) cand = band.filter(function (q) { return near(q, -9, -3, -30, 120) && TAX.test(clean(q.s)); });
        cand = cand.filter(function (q) { return used.indexOf(q) < 0; });
        if (!cand.length) return;
        cand.sort(function (a, b) { return Math.abs(a.x - T.x) - Math.abs(b.x - T.x); });
        used.push(cand[0]);
        var tot = yen(clean(cand[0].s).match(TAX)[1]);
        // この合計に入る部品：同じ縦の列で、ひとつ上の合計（無ければ本体の値段の行）との間
        var upper = o.y - 12;
        prevByCol.forEach(function (P) { if (Math.abs(P.x - T.x) < 40 && P.y > T.y) upper = Math.min(upper, P.y); });
        prevByCol.push(T);
        var parts = [], names = [];
        band.forEach(function (q) {
          if (!(q.y > T.y && q.y < upper && Math.abs(q.x - T.x) < 60)) return;
          (clean(q.s).match(DK_ROOM_PARTS) || []).forEach(function (x) { if (parts.indexOf(x) < 0) parts.push(x); });
        });
        parts.forEach(function (x) { var nm = dkPanelName(x); if (nm && names.indexOf(nm) < 0) names.push(nm); });
        if (/グリル|据付枠/.test(clean(T.s) + text(T.y - o.y - 2, T.y - o.y + 8))) {
          if (names.indexOf('前面グリル・据付枠') < 0) names.push('前面グリル・据付枠');
        }
        // 「別売前面グリル・据付枠合計価格」はグリルと据付枠だけの合計。本体の値段に足す
        var full = /^合計価格/.test(clean(T.s).trim());
        var onlyPanels = parts.length > 1 && parts.every(function (x) { return /^B[CG]/.test(x); });
        variants.push({ y: full ? tot : y + tot, pm: parts.join(onlyPanels ? '／' : '・'), label: names.join('＋') });
      });
      if (!variants.length) { out.push(base); return; }
      variants.forEach(function (v) {
        var x = {};
        for (var key in base) x[key] = base[key];
        x.y = v.y; x.pm = v.pm;
        x.opt = (v.label || 'パネル') + '込み';
        out.push(x);
      });
    });
    return out;
  }


  /* --------------------------------------------------------------------
     ダイキン ルームエアコンの別売品（住宅設備用カタログ 69〜77ページ）
     --------------------------------------------------------------------
     紙面の表は3通り
       ・●の表：縦に別売品（品番・税込価格）、横に機種の列。列の見出しは「【RX】S22～406ATRS」のような品番の範囲。
         1つの列の見出しに、上の段（セパレート）と下の段（システムマルチ）の範囲が縦に積まれている。
         見出しの文字の左はしと●の位置はずれるので、●の列のあいだのまん中を境目にして区画に分け、
         見出しのまん中がどの区画に入るかで列を決める（69ページは1列目に見出しが2つ〔RX・AX と DX〕ある）
       ・一覧の表（70ページ）：「機種名 システムマルチ C28～56ZCV」の下に品目が並ぶ。●は無い。表の中の範囲全部に付く
       ・配管の太さの表（71ページ、ビルトイン形のダクト）：列が φ100～φ200。見出しの形の名前で付ける
     **値段は税込**（「本ページに掲載の別売品は税込価格を表記しています」）。1.1で割って税抜きにする。
       パネル BC40JF-WF は税込136,400円 → 124,000円で、機種のページの税抜きと合う
     -------------------------------------------------------------------- */
  // 別売品の品番（頭がKかBで、数字を含む。うしろの（WW）（W）（T）は色）
  // 数字の無い品番もある（71ページ「K-FDSKD」断熱材・「K-FDSKDP」ダクトテープ・「K-FDBPA」バンド本体・「K-FDBSPA」サドルバンド）
  var DKO_CODE = /^((?:K-?[A-Z]{1,6}|B[A-Z]{1,3})[A-Z0-9-]*\d[A-Z0-9-]*|K-[A-Z]{4,8})((?:\([A-Z]+\))*)$/;
  var DKO_MONEY = /([\d,]{2,})\s*円/;

  // 見出しの品番の範囲 → 付く機種の形
  function dkoRangeFit(txt) {
    var t = String(txt || '').replace(/[\u0000-\u001f\s]/g, '');
    var m = t.match(/^(MP|\dM|[SC])(\d{2})([～~〜・])(\d{2})([0-9]?[A-Z][A-Z0-9]*)$/);
    if (m) return { rm: { p: m[1], t: m[5], r: m[3] !== '・', c: [Number(m[2]), Number(m[4])] } };
    m = t.match(/^(MP|\dM|[SC])(\d{2,4}[A-Z][A-Z0-9]*)$/);
    if (m) return { mc: m[1] + m[2] };
    return null;
  }

  function dkRoomOptReadPage(items, page) {
    function clean(t) { return String(t || '').replace(/[\u0000-\u001f]/g, ' '); }
    var all = clean(items.map(function (o) { return o.s; }).join(''));
    // 別売品のページ（69〜78）には必ず「本ページに掲載の別売品は税込価格を表記しています」とある。
    // 機種のページ（43〜48）の「パネル（別売）価格…」まで読んでいたので、これで絞る
    if (!/税込価格を表記/.test(all.replace(/\s/g, ''))) return [];
    var its = items.filter(function (o) { return clean(o.s).trim(); });

    // 「S40」「・566ATRP」のように割れて来る見出しをつなぐ
    var merged = its.slice();
    its.forEach(function (o) {
      var t0 = clean(o.s).trim();
      if (!/^(MP|\dM|[SC])\d{2}/.test(t0) || dkoRangeFit(t0)) return;
      var txt = t0, end = o.x + (o.w || 0), grew = false;
      for (var guard = 0; guard < 4; guard++) {
        var nx = null;
        its.forEach(function (q) {
          var tq = clean(q.s).trim();
          if (q !== o && Math.abs(q.y - o.y) < 1 && q.x >= end - 2 && q.x - end < 4 &&
              /^[・～~〜0-9A-Z]+$/.test(tq) && (!nx || q.x < nx.x)) nx = q;
        });
        if (!nx) break;
        txt += clean(nx.s).trim(); end = nx.x + (nx.w || 0); grew = true;
      }
      if (grew && dkoRangeFit(txt)) merged.push({ s: txt, x: o.x, y: o.y, w: end - o.x });
    });

    // 表の見出し（「…別売品」）で区切る。左右2段のページは左右に分ける
    /* 表の見出しは「…用別売品」「…関連別売品」「室外機用別売品（…」で終わる行。
       ページの下の注記（「…他のHA端子S21を使用する別売品との併用は…」）にも「別売品」の字があり、
       それを右の段の見出しと取り違えて、ページを左右2段に分け、右半分の●の列を捨てていた（73ページ） */
    var titles = its.filter(function (o) {
      var t = clean(o.s).replace(/\s+/g, '');
      return /(用|関連|配管)別売品/.test(t) && !/。|注|別売品名|別売品の|別売品は|別売品に|別売品と|別売品を|別売品が/.test(t);
    });
    var twoCol = titles.some(function (o) { return o.x >= 300; });
    var out = [];
    // 78ページのスカイダクト（配管化粧ダクト）も見出しに「別売品」が無い。どの機種にも使う部材
    if (!titles.length) { readDkoTable(merged, /スカイダクト/.test(all) ? 'スカイダクト' : '', page, out, clean); return out; }
    titles.forEach(function (T) {
      var right = twoCol && T.x >= 300;
      var xLo = right ? 305 : 0, xHi = (twoCol && !right) ? 310 : 1e9;
      // 表の下の端。70ページのいちばん下の行（KDG99C41-X）は高さ40にあり、40より上としていて落ちていた
      var yLo = 20;
      titles.forEach(function (U) {
        if (U === T || U.y >= T.y - 2) return;
        if ((twoCol && U.x >= 300) !== right) return;
        yLo = Math.max(yLo, U.y + 2);
      });
      var reg = merged.filter(function (o) { return o.x >= xLo && o.x < xHi && o.y < T.y + 2 && o.y > yLo; });
      var title = its.filter(function (o) { return Math.abs(o.y - T.y) < 2 && o.x <= T.x + 1 && o.x > T.x - 200; })
        .sort(function (a, b) { return a.x - b.x; }).map(function (o) { return clean(o.s); }).join('').replace(/\s+/g, '');
      readDkoTable(reg, title, page, out, clean);
    });
    return out;
  }

  /* 別売品の表の品名（2026-09-11）
     左の欄は2段のことが多い（74ページ）。
       左の段：大きなまとまり「樹脂製日除け屋根」「防雪屋根」「防雪フード」（何行ぶんものマスのまん中）
       右の段：その中の区分「塗装」「ステンレス」「（加湿部）」「（吸込側面）」（これも何行ぶんものまん中）
     いちばん近い名前を採ると、となりのまとまりの区分（「ステンレス」）を取ってしまう。
     日立の別売品と同じく、「分けた行のまん中」と「名前の高さ」がいちばん合う分け方で割り当てる。
     区分は、大きなまとまりの中だけで分ける */
  function dkoAssign(rowYs, labels, U, E, glue) {
    var n = rowYs.length, k = labels.length, INF = 1e12, i, j, p, t;
    var f = [], from = [];
    for (i = 0; i <= n; i++) { f.push([]); from.push([]); for (j = 0; j <= k; j++) { f[i].push(INF); from[i].push(null); } }
    f[0][0] = 0;
    for (i = 0; i <= n; i++) {
      for (j = 0; j <= k; j++) {
        if (!i && !j) continue;
        var best = INF, how = null;
        if (i > 0 && f[i - 1][j] + U < best) { best = f[i - 1][j] + U; how = ['skip']; }
        if (j > 0 && f[i][j - 1] + E < best) { best = f[i][j - 1] + E; how = ['empty']; }
        if (j > 0) {
          for (p = 0; p < i; p++) {
            if (f[p][j - 1] >= INF) continue;
            // glue[t]：t-1行目とt行目は同じマス。その境目でまとまりを切らない
            if (glue && ((p > 0 && glue[p]) || (i < n && glue[i]))) continue;
            var sum = 0;
            for (t = p; t < i; t++) sum += rowYs[t];
            var c = f[p][j - 1] + Math.abs(sum / (i - p) - labels[j - 1].y);
            if (c < best) { best = c; how = ['block', p]; }
          }
        }
        f[i][j] = best; from[i][j] = how;
      }
    }
    var asg = [];
    for (t = 0; t < n; t++) asg.push(-1);
    i = n; j = k;
    while (i > 0 || j > 0) {
      var h = from[i][j];
      if (!h) break;
      if (h[0] === 'skip') i--;
      else if (h[0] === 'empty') j--;
      else { for (t = h[1]; t < i; t++) asg[t] = j - 1; i = h[1]; j--; }
    }
    return asg;
  }

  function dkoNames(reg, codes, top, clean) {
    function isNameBit(o) {
      var tt = clean(o.s).trim();
      if (!tt || /^注\s*[\d,\s]*$/.test(tt) || /^[●―□★※]+$/.test(tt)) return false;
      if (DKO_CODE.test(tt) || /^[SCRF]\d{2}/.test(tt) || DKO_MONEY.test(tt) || /^[\d,]+$/.test(tt)) return false;
      if (/。/.test(tt)) return false;                        // 表の下の注記の文
      return true;
    }
    function tidy(t) {
      // 全角の英字と数字は半角にそろえる（「Ｐ板」「高さ １２０」）
      t = t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
      t = t.replace(/注\s*[\d,]+/g, ' ').replace(/★\s*\d?|□|※/g, ' ').replace(/別売品名/g, ' ')
        .replace(/([ぁ-んァ-ヶー一-龥（）])\s+(?=[ぁ-んァ-ヶー一-龥（）])/g, '$1')
        .replace(/\s+/g, ' ').trim();
      // 1文字ずつあいた英数字（73ページ「L A N」「H E M S」、70ページ「N 3 . 3」、77ページ「高さ ３ ０ ０」）をつなぐ
      // かっこを離してから数える（「３０ ０）」の「０）」も1けたの数字として見る）
      var tok = t.replace(/（/g, '（ ').replace(/）/g, ' ）').replace(/\s+/g, ' ').trim().split(' '), outT = [], prevOne = false;
      tok.forEach(function (w) {
        var one1 = /^[A-Za-z0-9.０-９Ａ-Ｚ．]$/.test(w);
        // 「３０」「０」のように数字が2つに割れて来ることもある（77ページ「高さ 300」）
        var digAfterDigits = /^[0-9]$/.test(w) && /^[0-9.]+$/.test(outT[outT.length - 1] || '');
        if (one1 && (prevOne || digAfterDigits)) outT[outT.length - 1] += w; else outT.push(w);
        prevOne = one1;
      });
      return outT.join(' ').replace(/（\s+/g, '（').replace(/\s+）/g, '）');
    }
    // 品番の行
    var rows = [];
    codes.forEach(function (c) { if (!rows.some(function (y) { return Math.abs(y - c.y) < 2.5; })) rows.push(c.y); });
    rows.sort(function (a, b) { return b - a; });
    var xsC = codes.map(function (c) { return c.x; }).sort(function (a, b) { return a - b; });
    /* 名前の欄の端にする品番の列は、左から見て「いちばん多い列の3分の1以上（3個以上）の品番がある列」。
       70ページ左下は上の表（x167 に17個）と下のワイドグリルの表（x123 に4個）が1つの区切りに入り、
       x123 を端にして、上の表の名前の右半分（「壁用」「間用」「空清フィルタ」の「ー」）を捨てていた */
    var colN = xsC.map(function (x0) { return xsC.filter(function (x) { return Math.abs(x - x0) < 6; }).length; });
    var maxN = Math.max.apply(null, colN);
    var codeX = xsC[0];
    for (var q = 0; q < xsC.length; q++) {
      if (colN[q] >= 3 && colN[q] * 3 >= maxN) { codeX = xsC[q]; break; }
    }
    var lo = Math.min.apply(null, rows) - 12;
    /* 名前の欄の左の端。名前の欄の左に、同じ高さで別の小さな表（78ページ「バンドホルダー K-TH7A 99 円」）があると、
       その表の名前がまとまりの名前になり、TM シリーズの35品目が「バンドホルダー」になっていた。
       名前の列の品番と同じ高さの範囲で、名前の列より左にある品番・値段の右はしより右だけを名前にする */
    var colYs = codes.filter(function (c) { return Math.abs(c.x - codeX) < 6; }).map(function (c) { return c.y; });
    var yHi = Math.max.apply(null, colYs) + 4, yLo = Math.min.apply(null, colYs) - 4;
    var xLeft = -1e9;
    reg.forEach(function (o) {
      if (o.x >= codeX - 20 || o.y > yHi || o.y < yLo) return;
      var tt = clean(o.s).trim();
      if ((DKO_CODE.test(tt) && !/^[SCRF]\d/.test(tt)) || DKO_MONEY.test(tt)) xLeft = Math.max(xLeft, o.x + (o.w || 0));
    });
    var bits = reg.filter(function (o) { return o.x < codeX - 2 && o.x > xLeft + 2 && o.y <= top + 4 && o.y >= lo && isNameBit(o); })
      .sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    /* 縦書きの名前（70ページ「前」「面」「グ」「リ」「ル※」が x57 に1文字ずつ縦に並ぶ）は、
       となりの横書きの名前（「和 風 （ 白 木 ）」）とくっついて「前和 風（白」になっていた。
       同じ x に1文字の字が4つ以上、4〜9ポイントの間で縦に続き、その多くが右どなりに1文字の字を持たない
       （字間をあけた横書き「簡　単」「気　密」ではない）ものは、上から読んで1つの名前にする */
    var single = bits.filter(function (o) { return /^[ぁ-んァ-ヶー一-龥]※?$/.test(clean(o.s).trim()); });
    var used = [], vert = [];
    single.forEach(function (o) {
      if (used.indexOf(o) >= 0) return;
      var ch = [o];
      for (;;) {
        var a0 = ch[ch.length - 1];
        var nx = single.filter(function (p) {
          return used.indexOf(p) < 0 && ch.indexOf(p) < 0 && Math.abs(p.x - a0.x) <= 1.5 && a0.y - p.y >= 4 && a0.y - p.y <= 9;
        })[0];
        if (!nx) break;
        ch.push(nx);
      }
      if (ch.length < 4) return;
      var spread = ch.filter(function (c) {
        // 右か左に、同じ高さの1文字の字があれば字間をあけた横書き（「ミ ン ト グ リ ー ン」の右はしの「ン」）
        return single.some(function (p) { return p !== c && Math.abs(p.y - c.y) < 0.6 && Math.abs(p.x - c.x) > 4 && Math.abs(p.x - c.x) < 60; });
      }).length;
      if (spread * 2 >= ch.length) return;
      ch.forEach(function (c) { used.push(c); });
      vert.push({ x: o.x, hi: ch[0].y, lo: ch[ch.length - 1].y, t: ch.map(function (c) { return clean(c.s).trim(); }).join('') });
    });
    bits = bits.filter(function (o) { return used.indexOf(o) < 0; });
    // 同じ高さで続く文字を1行に（「ペ」「ア」「コ」「イ」「ル」）
    var lines = [];
    function one(o) { return /^[ぁ-んァ-ヶー一-龥（）・]$/.test(clean(o.s).trim()); }
    bits.forEach(function (o) {
      var L = null;
      lines.forEach(function (x) {
        if (Math.abs(x.y - o.y) >= 2.5 || o.x < x.x - 1) return;
        // 1文字ずつ間をあけて組んだ名前（39ページ「パ　ネ　ル」「気　密　枠」）は、字の間が広くても1行
        // 70ページ「気　　密　　枠」は字の間が47ある（同じ高さぴったりのときだけ60まで）
        if (o.x - x.end < 14 || (x.one && one(o) && Math.abs(x.y - o.y) < 1.2 &&
            (o.x - x.end < 36 || (Math.abs(x.y - o.y) < 0.6 && o.x - x.end < 60)))) L = x;
      });
      if (!L) { L = { x: o.x, end: o.x + (o.w || 0), y: o.y, t: '' }; lines.push(L); }
      L.t += ' ' + clean(o.s); L.end = Math.max(L.end, o.x + (o.w || 0));
      L.one = one(o) || /\s[ぁ-んァ-ヶー一-龥]$/.test(clean(o.s).trim());
    });
    lines.forEach(function (L) { L.t = tidy(L.t); });
    // 縦書きの名前は、まん中の高さの1行として足す
    vert.forEach(function (v) { lines.push({ x: v.x, end: v.x + 6, y: (v.hi + v.lo) / 2, t: tidy(v.t) }); });
    // 1文字の英字の行（78ページ「Ｔ」）は、すぐ下の英字で始まる行（「M シリーズ」）の頭につなぐ（「TM シリーズ」）
    lines.forEach(function (L) {
      if (!/^[A-Za-z]$/.test(L.t.trim())) return;
      var below = lines.filter(function (M) {
        return M !== L && /^[A-Za-z]/.test(M.t) && L.y - M.y > 2 && L.y - M.y <= 20 && Math.abs(M.x - L.x) <= 6;
      }).sort(function (a, b) { return b.y - a.y; })[0];
      if (below) { below.t = L.t.trim() + below.t; L.t = ''; }
    });
    // 表の下の注記（「注 1. 防雪フード（加湿部）…」は「注 1」を抜くと「. 防雪フード…」になる）は名前にしない
    lines = lines.filter(function (L) { return L.t && !/^[.．、,注※]/.test(L.t) && !/[、。]/.test(L.t) && /[ぁ-んァ-ヶー一-龥\dａ-ｚA-Za-z]/.test(L.t); });
    // 句点が別の文字で来る注記の文（77ページ「…のいずれかを使用してくださ」「い。」）も名前にしない
    lines = lines.filter(function (L) { return !/くださ|ます|です|ません|を使用する|のいずれか|お願い|納品姿|ご注文|販売単位/.test(L.t) && !/^[\d\s.]+$/.test(L.t); });
    // 表の見出しの言葉（78ページ「梱包入数」「外観」「室内用」「ダクト外寸（mm）…」）と、英字1文字だけの行は名前にしない
    lines = lines.filter(function (L) { return !/^(梱包入数|外観|品番|価格|機種名|適用銅管|室内用|ダクト外寸.*|外形寸法.*|[Ａ-ＺA-Z]|[\d,]+ ?個)$/.test(L.t.trim()); });
    /* 区切りの見出し（73ページ「■遠隔制御Ｐ板による遠隔制御」「■ＬＡＮ接続」）は区切りの頭に書いてある。
       まん中に書く名前と同じに扱うと、上の区切りの品物にまで下の見出しを付けていた。
       名前には使わず、見出しから次の見出しまでを1つの区切りにする */
    var heads = lines.filter(function (L) { return /^■/.test(L.t); }).map(function (L) { return L.y; });
    lines = lines.filter(function (L) { return !/^■/.test(L.t); });
    function sectionOf(y) {
      var best = null;
      heads.forEach(function (h) { if (h > y && (best == null || h < best)) best = h; });
      return best == null ? 1e9 : best;
    }
    if (!lines.length) return { rows: rows, names: [], codeX: codeX };
    // 値段のある品番の行ぜんぶで見る（70ページ KAF968B41「枠付」は2列目の品番の行）
    var rowsX = rows;
    // 一覧の名前は行の高さぴったり（0.3 以内）。69ページ「埋込配管用／シングルコイル／組合せ」は行から1.0ずれた3行の名前
    function onRow(y) { return y != null && rowsX.some(function (r) { return Math.abs(r - y) <= 0.8; }); }
    function len(t) { return t.replace(/\s+/g, '').length; }
    // 段：いちばん左に始まる行が「まとまり」、それより右が「区分」
    var minX = Math.min.apply(null, lines.map(function (L) { return L.x; }));
    function labelsOf(col) {
      var ls = lines.filter(function (L) { return (L.x - minX < 6) === (col === 0); })
        .sort(function (a, b) { return b.y - a.y; });
      // 縦に続く行（「防雪」「フード」）は1つの名前
      var out = [];
      ls.forEach(function (L) {
        var last = out[out.length - 1];
        /* 1行に1つ名前がある一覧の表（45ページ「集塵・脱臭フィルター枠付」「抗ウイルスフィルター枠付」「木台」…）は、
           行の高さに名前が1つずつある。縦に続く1つの名前（「防雪三点」「セット」）と思ってつなげると、
           表の名前が全部1つにつながった（39・45・70ページの34品目）。行の高さにある長い名前どうしはつなげない */
        // 長い名前（9文字以上）のあとだけ止める。73ページ「無線 L A N 接」「続アダプター」は1つの名前の途中で割れている
        var lt = last ? (last.lt || last.t) : '';
        var paren = /^[（(]/.test(L.t);
        var own = col === 0 && last && !paren && (
          (onRow(last.lo) && onRow(L.y) && len(lt) >= 5 && len(L.t) >= 5) ||   // 行の高さの名前どうし（「防振フレーム」「ブラケット」）
          (onRow(last.lo) && len(L.t) > 5 && len(lt) > 8) ||                    // 39ページ「ワイドパネル（470…）」のあとの「ワイドパネル（670…）」
          (onRow(L.y) && len(lt) > 8));                                         // 「ワイドパネル（670…）」のあとの「気密枠」
        // かっこで始まる行どうし（74ページ「（吸込側面）」「（吸込背面）」、77ページ「（標準）」「（戸袋用）」）は別々の区分
        var sib = last && paren && /^[（(]/.test(lt) &&
          (lt.match(/[（(]/g) || []).length <= (lt.match(/[）)]/g) || []).length;   // 前の行のかっこが閉じていなければ続き
        /* 縦に3行以上、行の高さに1つずつ名前が並ぶ欄は一覧（39ページの色「フレッシュホワイト」「ホワイト」「ブラウン」「木目」）。
           2行だけ（「防雪三点」「セット」、「配管スペーサー」「付き」）は1つの名前の続き */
        var run = last && onRow(last.lo) && onRow(L.y) && lines.some(function (M) {
          return M !== L && Math.abs(M.x - L.x) < 8 && onRow(M.y) &&
            ((M.y < L.y - 2 && M.y > L.y - 10) || (M.y > last.hi + 2 && M.y < last.hi + 10));
        });
        /* かっこで始まる続きの行（69ページ「前面パネル」…「（交換用）」）は、マスの上と下に分けて書いてある。
           間にほかの名前が無ければ、離れていてもつなぐ */
        var near = last && (last.lo - L.y <= 7 ||
          (last.lo - L.y <= 30 && /^[（(]/.test(L.t) && !ls.some(function (M) { return M.y < last.lo - 1 && M.y > L.y + 1; })));
        if (last && !own && !run && !sib && near && Math.abs(last.x - L.x) < 8) { last.t += L.t; last.lo = L.y; last.ys.push(L.y); last.lt = L.t; }
        else out.push({ x: L.x, hi: L.y, lo: L.y, t: L.t, ys: [L.y], lt: L.t });
      });
      out.forEach(function (x) { x.y = (x.hi + x.lo) / 2; });
      return out;
    }
    var g = labelsOf(0), sub = labelsOf(1);
    var names = rows.map(function () { return ''; });
    /* 2つの行のまん中に名前の文字があれば、その2行は同じマスの中。
       71ページのドレンアップキットは4行（K-KDU573MS・MV・NS・NV）で、名前は上寄りに書いてある。
       まん中の高さだけで分けると3行と1行に分け、NV を下の「ドレンポンプキット」にしていた。
       NS と NV のまん中には「ハーフサイズ」があるので、ここは切れない */
    var glue = rows.map(function (y, t) {
      if (!t) return false;
      var a = rows[t - 1], gap = a - y, mid = (a + y) / 2;
      if (gap > 9) return false;
      return lines.some(function (L) { return Math.abs(L.y - mid) < gap / 4; });
    });
    // まとまりは区切りごとに割り当てる（区切りの中の名前だけを使う）
    var ga = rows.map(function () { return -1; });
    var sec = rows.map(function (y) { return sectionOf(y); });
    var s0 = 0;
    while (s0 < rows.length) {
      var s1 = s0;
      // 品番の行が30以上あいたら別の表（77ページの下の「防雪三点セットの組み合わせ」）
      while (s1 + 1 < rows.length && sec[s1 + 1] === sec[s0] && rows[s1] - rows[s1 + 1] <= 30) s1++;
      var top0 = (s0 > 0 && sec[s0 - 1] === sec[s0]) ? rows[s0 - 1] : sec[s0], bottom0 = s1 + 1 < rows.length ? rows[s1 + 1] : -1e9;
      var gIn = g.filter(function (x) { return x.y < top0 && x.y > bottom0 && sectionOf(x.y) === sec[s0]; });
      var part = dkoAssign(rows.slice(s0, s1 + 1), gIn, 40, 9, glue.slice(s0, s1 + 1).map(function (v, t) { return t > 0 && v; }));
      for (var t0 = s0; t0 <= s1; t0++) ga[t0] = part[t0 - s0] >= 0 ? g.indexOf(gIn[part[t0 - s0]]) : -1;
      s0 = s1 + 1;
    }
    // まとまりごとに、区分を割り当てる
    var leaf = rows.map(function () { return false; });
    function hasOn(lab, y) { return lab.ys.some(function (v) { return Math.abs(v - y) <= 1.2; }); }
    var i = 0;
    while (i < rows.length) {
      var j = i;
      while (j + 1 < rows.length && ga[j + 1] === ga[i] && sec[j + 1] === sec[i]) j++;
      var blockRows = rows.slice(i, j + 1);
      var hi = blockRows[0] + 4, lw = blockRows[blockRows.length - 1] - 4;
      var subs = sub.filter(function (x) { return x.y <= hi && x.y >= lw; });
      var sa = dkoAssign(blockRows, subs, 9, 9);
      for (var t = i; t <= j; t++) {
        var parts = [];
        if (ga[t] >= 0) parts.push(g[ga[t]].t);
        var sl = sa[t - i] >= 0 ? subs[sa[t - i]] : null;
        if (sl) parts.push(sl.t);
        names[t] = parts.join(' ').trim();
        /* 品番の行の高さに書いてあり、その行だけに付いた名前なら「その品物だけの名前」。
           同じ品番が何ページにもあるとき（KRP413BB1S は70・71・73ページ）は、これを使う */
        var k0 = t - i;
        leaf[t] = (sl && sa.filter(function (v) { return v === sa[k0]; }).length === 1 && hasOn(sl, rows[t])) ||
                  (ga[t] >= 0 && ga.filter(function (v) { return v === ga[t]; }).length === 1 && hasOn(g[ga[t]], rows[t]));
      }
      i = j + 1;
    }
    return { rows: rows, names: names, codeX: codeX, leaf: leaf };
  }

  /* 1つの見出しの下に、列の間隔の違う表が上下に並ぶことがある（72ページのリモコン用別売品）。
     2つの表の●の列を混ぜると、見出しの当たらない列ができて品目が落ちる。
     品番の範囲の見出しが縦に続くかたまりごとに、表を分けて読む */
  function readDkoTable(reg, title, page, out, clean) {
    var hs = reg.filter(function (o) { return dkoRangeFit(clean(o.s)); })
      .map(function (o) { return o.y; }).sort(function (a, b) { return b - a; });
    var blocks = [];
    hs.forEach(function (y) {
      var last = blocks[blocks.length - 1];
      if (last && last.lo - y <= 20) { last.lo = y; last.n++; }
      else blocks.push({ hi: y, lo: y, n: 1 });
    });
    /* 表を分けるのは、本物の見出しのかたまり（品番の範囲が3つ以上）で、
       その上の見出しとの間に品番の行が2つ以上あるときだけ。
       表の途中にある範囲の文字1つ（注記の中など）で分けると、74・75ページの品目がごっそり落ちた */
    var codeRows = [];
    reg.forEach(function (o) {
      var t = clean(o.s).trim();
      if (DKO_CODE.test(t) && !/^[SCRF]\d/.test(t) && !codeRows.some(function (y) { return Math.abs(y - o.y) < 2.5; })) codeRows.push(o.y);
    });
    var real = [];
    blocks.forEach(function (b) {
      if (!real.length) { real.push({ hi: b.hi, lo: b.lo }); return; }
      var prev = real[real.length - 1];
      var between = codeRows.filter(function (y) { return y < prev.lo && y > b.hi; }).length;
      if (b.n >= 3 && between >= 2) real.push({ hi: b.hi, lo: b.lo });
    });
    if (real.length <= 1) { readDkoTable1(reg, title, page, out, clean); return; }
    real.forEach(function (b, i) {
      var bottom = i + 1 < real.length ? real[i + 1].hi + 12 : -1e9;
      // 下の表は、その見出しの12上（【RX】などの札）から。上の表の品番の行は含めない
      var sub = reg.filter(function (o) { return o.y > bottom && (i === 0 || o.y <= b.hi + 12); });
      readDkoTable1(sub, title, page, out, clean);
    });
  }

  function readDkoTable1(reg, title, page, out, clean) {
    var codes = reg.filter(function (o) {
      var t = clean(o.s).trim();
      return DKO_CODE.test(t) && !/^[SCRF]\d/.test(t) && !/^K[A-Z]$/.test(t);
    });
    if (!codes.length) return;
    /* 表の上の端は、品番が縦に3つ以上ならぶ列の品番で決める。
       71ページのドレンの表は、左の写真の説明（「● ドレンアップキット K-KDU573NS（NV）」）の品番が
       見出しの高さにあり、それを表の上の端にして、見出しの範囲を31のうち7つしか数えなかった */
    var inCol = codes.filter(function (c) {
      return codes.filter(function (d) { return Math.abs(d.x - c.x) < 6; }).length >= 3;
    });
    if (inCol.length) {
      var topCol = Math.max.apply(null, inCol.map(function (o) { return o.y; }));
      codes = codes.filter(function (o) { return inCol.indexOf(o) >= 0 || o.y <= topCol + 2; });
    }
    var top = Math.max.apply(null, codes.map(function (o) { return o.y; }));
    var heads = reg.filter(function (o) { return o.y > top + 2 && dkoRangeFit(clean(o.s)); });
    // 列は ● だけで決める。一覧の表の「―」（その色は無い）を列と思い込み、表ごと捨てていた（70ページ）
    var marks = reg.filter(function (o) { return /^●/.test(clean(o.s).trim()) && o.y <= top + 2; });

    // ●の列：まん中の位置をまとめる
    var mcols = [];
    marks.forEach(function (o) {
      var cx = o.x + 3, c = null;
      mcols.forEach(function (k) { if (!c && Math.abs(k.x - cx) < 10) c = k; });
      if (!c) { c = { x: cx, n: 0, fits: [] }; mcols.push(c); }
      c.n++;
    });
    /* ●が1つしかない列も列と見る（72ページ下の表の KRC944A2 は、その列の●がこれ1つ）。
       見出しの範囲が当たらない列は、下の「一覧の表として読む」で捨てられる */
    mcols = mcols.sort(function (a, b) { return a.x - b.x; });
    // 見出しを、●の列のあいだのまん中を境目にした区画に割り当てる
    heads.forEach(function (h) {
      var cx = h.x + (h.w || 0) / 2, best = -1;
      for (var i = 0; i < mcols.length; i++) {
        var lo = i ? (mcols[i - 1].x + mcols[i].x) / 2 : -1e9;
        var hi = i < mcols.length - 1 ? (mcols[i].x + mcols[i + 1].x) / 2 : 1e9;
        if (cx >= lo && cx < hi) best = i;
      }
      if (best >= 0) mcols[best].fits.push(dkoRangeFit(clean(h.s)));
    });
    /* ●の列に見出しの範囲が1つも当たらないなら、●の表ではない（注記の「●」を拾っただけ）。
       71ページのビルトイン形のダクトの表を●の表と思い込み、●の無い行を120品目ほど捨てていた */
    if (!mcols.some(function (k) { return k.fits.length; })) mcols = [];
    var allFits = heads.map(function (h) { return dkoRangeFit(clean(h.s)); });
    // 品名は表ごとにまとめて作る（何行ぶんもあるマスのまん中に書いた名前を、行に割り当てる）
    /* 品名の行は、値段のある品番の行だけ。77ページは上の注記の中にも品番（「K-KW5G」など）があり、
       その行まで名前の割り当てに入って、いちばん下の「つかみ金具」が40行に付いた */
    var priced = codes.filter(function (c) {
      return reg.some(function (o) {
        if (Math.abs(o.y - c.y) >= 2.5 || o.x <= c.x) return false;
        var tt = clean(o.s).trim();
        return DKO_MONEY.test(tt) || /オープン価格/.test(tt) || /^[\d,]{4,}$/.test(tt);
      });
    });
    /* 品名は、値段のある品番の行を「行が20以上あいたところ」で分けた帯ごとに作る。
       78ページは1つの区切りに D シリーズ・TL シリーズ・TM シリーズの表が縦に並び、品番の列の位置が表ごとに違う（x225 と x382）。
       1つとして読むと、TM シリーズの品名を x225 より左の文字（となりの「バンドホルダー」の表）から付けていた */
    var src = priced.length ? priced : codes;
    var bys = [];
    src.forEach(function (c) { if (!bys.some(function (y) { return Math.abs(y - c.y) < 2.5; })) bys.push(c.y); });
    bys.sort(function (a, b) { return b - a; });
    var bands = [];
    bys.forEach(function (y) { var b = bands[bands.length - 1]; if (b && b.lo - y <= 20) b.lo = y; else bands.push({ hi: y, lo: y }); });
    var nameRows = { rows: [], names: [], leaf: [], codeXs: [] };
    bands.forEach(function (b, k) {
      var up = k ? bands[k - 1].lo - 2 : 1e9, down = k + 1 < bands.length ? bands[k + 1].hi + 2 : -1e9;
      var subReg = reg.filter(function (o) { return o.y < up && o.y > down; });
      var subCodes = src.filter(function (c) { return c.y <= b.hi + 2.5 && c.y >= b.lo - 2.5; });
      // 帯の上の端は最初の行より10上まで（73ページ「無線 LAN 接」、70ページ「ワイドグリル※」は最初の行より上に書いてある）
      var r = dkoNames(subReg, subCodes, k ? Math.min(b.hi + 10, up - 1) : top, clean);
      r.rows.forEach(function (y, t) {
        nameRows.rows.push(y); nameRows.names.push(r.names[t] || '');
        nameRows.leaf.push(!!(r.leaf && r.leaf[t])); nameRows.codeXs.push(r.codeX);
      });
    });
    var names = nameRows.names;
    /* 組み合わせの表（77ページ「防雪三点セットの組み合わせについて」）は、品番が横に何列も並び、
       列の頭に「置台」「防雪屋根」「防雪パネル」と書いてある。左の欄の名前ではなく列の頭で呼ぶ。
       品番が3つ以上ならぶ列が3列以上ある表だけ（2列の表は、機種ちがいの同じ品物） */
    var cols = [];
    codes.forEach(function (c) {
      if (cols.some(function (x) { return Math.abs(x - c.x) < 6; })) return;
      if (codes.filter(function (d) { return Math.abs(d.x - c.x) < 6; }).length >= 3) cols.push(c.x);
    });
    function stem(o) { var m = clean(o.s).trim().match(/^[A-Z]+(?:-[A-Z]+)?/); return m ? m[0] : ''; }
    function colHead(c) {
      if (cols.length < 3 || Math.abs(c.x - nameRows.codeXs[rowOf(c.y)]) < 20) return '';
      /* 同じ行の品番が同じ頭（78ページ K-TD6A・K-TD8A・K-TD10A）なら、大きさ違いの同じ品物の表。
         列の頭は太さ（「（φ6.35×φ9.52）」）なので名前にしない */
      var mates = codes.filter(function (d) { return d !== c && Math.abs(d.y - c.y) < 2.5; });
      if (!mates.length || mates.some(function (d) { return stem(d) === stem(c); })) return '';
      // 列の上の端は、c から続いている品番だけで決める（77ページは上の注記の中にも同じ x の品番がある）
      var col = codes.filter(function (d) { return Math.abs(d.x - c.x) < 6; });
      var colTop = c.y, colBot = c.y;
      col.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (d) { if (d.y > colTop && d.y - colTop <= 12) colTop = d.y; });
      col.slice().sort(function (a, b) { return b.y - a.y; }).forEach(function (d) { if (d.y < colBot && colBot - d.y <= 12) colBot = d.y; });
      if (col.filter(function (d) { return d.y <= colTop && d.y >= colBot; }).length < 3) return '';
      var hs = reg.filter(function (o) {
        var tt = clean(o.s).trim();
        return o.y > colTop + 2 && o.y <= colTop + 12 && o.x >= c.x - 8 && o.x <= c.x + 32 &&
          tt && !DKO_CODE.test(tt) && !DKO_MONEY.test(tt) && !dkoRangeFit(tt) && !/^[●―【】]/.test(tt);
      }).sort(function (a, b) { return Math.abs(a.x - c.x) - Math.abs(b.x - c.x); });
      if (!hs.length) return '';
      var h = hs[0], ht = clean(h.s).replace(/\s+/g, '');
      // 表の題（「防雪三点セットの組み合わせについて」）を頭に付ける
      var cap = reg.filter(function (o) { return o.y > h.y + 4 && o.y <= h.y + 20 && /について/.test(clean(o.s)); })[0];
      var pre = '';
      if (cap) pre = reg.filter(function (o) { return Math.abs(o.y - cap.y) < 1.5 && o.x <= cap.x + 1 && o.x > cap.x - 120; })
        .sort(function (a, b) { return a.x - b.x; }).map(function (o) { return clean(o.s); }).join('')
        .replace(/\s+/g, '').replace(/の組み?合わせについて$/, '');
      return (pre + ' ' + (/品番/.test(ht) ? '' : ht)).trim();
    }
    function rowOf(y) {
      var best = 0, bd = 1e9;
      nameRows.rows.forEach(function (ry, i) { var d = Math.abs(ry - y); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    // 配管の太さの表（ビルトイン形のダクト）は見出しに品番が無い。表の名前の形で付ける
    if (!allFits.length && /ビルトイン/.test(title)) allFits = [{ type: 'ビルトイン形' }];
    // スカイダクト（配管化粧ダクト）は、ルームエアコンのどの機種にも使う部材。
    // ルームエアコンの別売品は、ルームエアコンの機種にしか出ない（app.js の showOptionsFor）
    if (!allFits.length && /スカイダクト/.test(title)) allFits = [{ all: true }];

    codes.forEach(function (c) {
      var t = clean(c.s).trim(), cm = t.match(DKO_CODE);
      var code = cm[1];
      // 値段：同じ行の右（次の品番の手前まで）
      var nextX = 1e9;
      codes.forEach(function (d) { if (d !== c && Math.abs(d.y - c.y) < 2.5 && d.x > c.x && d.x < nextX) nextX = d.x; });
      var row = reg.filter(function (o) { return Math.abs(o.y - c.y) < 2.5; });
      var priceItem = null;
      row.forEach(function (o) {
        if (o.x <= c.x || o.x >= nextX) return;
        var tt = clean(o.s);
        if ((DKO_MONEY.test(tt) || /オープン価格/.test(tt)) && (!priceItem || o.x < priceItem.x)) priceItem = o;
      });
      // 値段が「108,240」「円」と2つに割れて来ることがある（76ページ K-AWS8H）
      var splitYen = null;
      if (!priceItem) {
        row.forEach(function (o) {
          if (o.x <= c.x || o.x >= nextX || !/^[\d,]{4,}$/.test(clean(o.s).trim())) return;
          var en = row.some(function (q) { return /^円/.test(clean(q.s).trim()) && q.x > o.x && q.x - (o.x + (o.w || 0)) < 12; });
          if (en && (!priceItem || o.x < priceItem.x)) { priceItem = o; splitYen = clean(o.s).trim(); }
        });
      }
      if (!priceItem) return;
      var open = /オープン価格/.test(clean(priceItem.s));
      var y = open ? 0 : Math.round(yen(splitYen || clean(priceItem.s).match(DKO_MONEY)[1]) / 1.1);

      // 付く機種：●の列の見出し。●の無い表は表の中の範囲全部
      var fits = [], mates = [];
      if (mcols.length) {
        /* ●は品番の行より少し上に組まれていることがある（72ページ KRC944A1 は2.6上）。3.5まで同じ行と見る。
           それでも無ければ、すぐ上の「品番の無い行」の●（74ページ「上下吹出 KPW937F4 ＋ KPW081A41（アタッチメント）」は
           ●が上の行にある） */
        var dots = reg.filter(function (o) { return /^●/.test(clean(o.s).trim()) && Math.abs(o.y - c.y) < 3.5 && o.x > priceItem.x; });
        if (!dots.length) {
          var up = reg.filter(function (o) { return /^●/.test(clean(o.s).trim()) && o.y - c.y >= 3.5 && o.y - c.y <= 7.5 && o.x > priceItem.x; });
          var upHasCode = up.length && codes.some(function (d) { return d !== c && Math.abs(d.y - up[0].y) < 2.5; });
          if (!upHasCode) dots = up;
        }
        dots.forEach(function (o) {
          var cx = o.x + 3, best = null, bd = 1e9;
          mcols.forEach(function (k) { var d = Math.abs(k.x - cx); if (d < bd) { bd = d; best = k; } });
          if (best && bd < 20) best.fits.forEach(function (f) { if (f) fits.push(f); });
        });
        /* ●の無いセットの表（77ページ「防雪三点セット」の防雪パネル K-APC6HL）。
           同じ行のほかの品番（K-AH63HL・K-KP6H）の付く機種を、あとで借りる */
        if (!fits.length) {
          codes.forEach(function (d) { if (d !== c && Math.abs(d.y - c.y) < 2.5) mates.push(clean(d.s).trim().match(DKO_CODE)[1]); });
          if (!mates.length) return;
        }
      } else {
        fits = allFits.slice();
      }
      if (!fits.length && !mates.length) return;

      // 品名：同じ行で品番より左の文字。短い（「3m」「枠付」）ときは、左の欄のいちばん近い名前を頭に付ける
      var head = colHead(c);
      var name = head || names[rowOf(c.y)] || '';
      /* 名前の欄より左にある品番（78ページ「バンドホルダー K-TH7A 99 円」は TM シリーズの表の左の小さな表）は、
         その行の左の文字で呼ぶ。名前の欄の行の名前（「ひねりエルボ」）を付けていた */
      if (!head && c.x < nameRows.codeXs[rowOf(c.y)] - 20) {
        var leftBits = reg.filter(function (o) {
          var tt = clean(o.s).trim();
          return o.x < c.x - 2 && o.x > c.x - 160 && Math.abs(o.y - c.y) <= 4 && tt &&
            !DKO_CODE.test(tt) && !DKO_MONEY.test(tt) && !/^注|^[●―□★※]+$|^[\d,]+ ?個?$|。/.test(tt);
        }).sort(function (a, b) { return b.y - a.y || a.x - b.x; });
        var lt0 = leftBits.map(function (o) { return clean(o.s).trim(); }).join(' ')
          .replace(/([ぁ-んァ-ヶー一-龥（）])\s+(?=[ぁ-んァ-ヶー一-龥（）])/g, '$1').replace(/\s+/g, ' ').trim();
        if (lt0) name = lt0;
      }
      if (!name) name = title.replace(/用?別売品.*$/, '') + '用 別売品';
      if (open) name += '（オープン価格）';
      if (cm[2]) name += '　色 ' + cm[2].replace(/[()]/g, ' ').trim().split(/\s+/).join('・');
      out.push({ page: page, code: code, name: name, y: y, fits: fits, mates: mates, weak: !!head,
                 leaf: !head && !!(nameRows.leaf && nameRows.leaf[rowOf(c.y)]) });
    });
  }

  /** ●の無いセットの表の品目に、同じ行のほかの品番の付く機種を貸す。借りられなかったものは入れない */
  function dkRoomOptFinish(list) {
    var byCode = {}, strong = {};
    /* 同じ品番が何ページにもある（KRP413BB1S は70・71・73ページ）。
       品番の行の高さに、その品物だけの名前が書いてある表（73ページ「遠隔制御用Ｐ板セット」）の名前がいちばん確か。
       そういう名前がいくつかあれば短いほう（70ページの「ドレンポンプキット エアコンと離して」より「変換コネクタ」）。
       無ければ最初に読んだ名前。「いちばん短い名前」だけで選ぶと、途中で切れた名前（「ドレンパイプ用」）を選んだ */
    // そういう名前が表ごとに違うときは、いちばん多い名前（同じ数なら短いほう）
    var votes = {};
    function n0(t) { return t.replace(/\s+/g, '').length; }
    list.forEach(function (o) {
      if (o.weak || !o.name) return;
      if (!strong[o.code]) strong[o.code] = o.name;
      if (!o.leaf || n0(o.name) < 4) return;
      var v = votes[o.code] = votes[o.code] || {};
      v[o.name] = (v[o.name] || 0) + 1;
    });
    Object.keys(votes).forEach(function (k) {
      var best = null;
      Object.keys(votes[k]).forEach(function (nm) {
        var c = votes[k][nm];
        if (!best || c > votes[k][best] || (c === votes[k][best] && n0(nm) < n0(best))) best = nm;
      });
      strong[k] = best;
    });
    list.forEach(function (o) {
      if (!o.fits.length) return;
      var v = byCode[o.code] = byCode[o.code] || [];
      o.fits.forEach(function (f) { v.push(f); });
    });
    var ok = [];
    list.forEach(function (o) {
      if (!o.fits.length) {
        (o.mates || []).forEach(function (m) { (byCode[m] || []).forEach(function (f) { o.fits.push(f); }); });
      }
      if (o.fits.length) ok.push({ page: o.page, code: o.code, name: strong[o.code] || o.name, y: o.y, fits: o.fits });
    });
    return optResult(ok, 'ダイキン', 'ルームエアコン（住宅設備用） 別売品');
  }

  function dkRoomFinish(sets) {
    var rows = [], seen = {}, pages = {};
    sets.forEach(function (x) {
      pages[x.page] = 1;
      // パネル違いは別の1台（同じ品番でも合計価格が違う）
      var key = x.m + '｜' + x.pm;
      if (seen[key]) return;
      seen[key] = 1;
      // 「馬力」の手順には、ルームエアコンでは能力の文字を入れる（画面はそのまま出す）
      var cap = x.cap || (x.kw.toFixed(1) + 'kW（おもに' + x.tat + '畳）');
      rows.push({
        m: x.m, hp: cap, y: x.y, u: String(x.page),
        s: x.s, i: x.i, ab: cap, pw: x.pw,
        rc: x.rc != null ? x.rc : 'ワイヤレス', tp: x.tp || 'シングル', opt: x.opt,
        om: x.om, im: x.im, pm: x.pm, rm: ''
      });
    });
    return {
      rows: rows,
      pricePages: Object.keys(pages).length,
      head: {
        maker: 'ダイキン',
        brand: 'ルームエアコン（住宅設備用）',
        source: '住宅設備用カタログ（公開デジタルカタログ）',
        note: '希望小売価格・税抜。配管/据付工事費は含まず。Eシリーズはオープン価格（値段0）。社内利用限定（第三者提供不可）。',
        seriesOrder: ['RXシリーズ', 'AXシリーズ', 'SXシリーズ', 'GXシリーズ', 'CXシリーズ', 'DXシリーズ', 'HXシリーズ', 'KXシリーズ', 'Eシリーズ',
                      'CRシリーズ', 'CDシリーズ', 'Cシリーズ', 'ダブルフロー', 'VRシリーズ', 'VDシリーズ', 'Vシリーズ',
                      '壁埋込形', 'アメニティビルトイン', 'フリービルトイン',
                      'マルチパック', 'システムマルチ（室外機）', 'ココタス（室外機）', 'マルチ用室内機'],
        typeOrder: ['シングル', 'マルチパック（2室）', '2室用', '3室用', '4室用', '5室用', 'マルチ用室内機'],
        urlBase: 'https://ec.daikinaircon.com/ecatalog/DKCA001/index.html#'
      }
    };
  }

  /* --------------------------------------------------------------------
     三菱電機
     Mr.SLIM（店舗・事務所用パッケージエアコン）

     **このメーカーだけ、PDFではなくデータファイル（.json）を読む。**
     三菱の総合カタログには価格が載っていない（2026-09-02 に紙面で確認済み）。
     価格は、三菱の機種検索ページが読み込んでいるデータファイルの中にある。
     ブラウザでそのリンクを開いて保存すれば、ただのファイルなので放り込める。

     中身は1機種＝1つのかたまりで、品番・価格・シリーズ・室内機タイプまで
     全部そろっている。紙面を読み解く必要がないぶん、5社の中でいちばん楽。
     -------------------------------------------------------------------- */
  function mitsuFinish(list) {
    var rows = [], seen = {}, noPrice = 0;
    var dash = function (v) { return (!v || v === '-') ? '' : String(v); };

    list.forEach(function (x) {
      var m = x && x.set_model ? String(x.set_model) : '';
      if (!m || seen[m]) return;
      seen[m] = 1;
      // 「1,078,000 円(税別)」のように単位と注が付いている。数字のところだけ取る
      var y = yen((String(x.price || '').match(/[\d,]+/) || [])[0]);
      if (!y) { noPrice++; return; }
      var hp = Number((String(x.ability || '').match(/<\s*([\d.]+)\s*馬力/) || [])[1]) || 0;
      rows.push({
        m: m, hp: hp, y: y,
        u: String(x.url || '').replace(/^.*\//, ''),
        s: dash(x.out_name) || 'その他',
        i: dash(x.in_name) || 'その他',
        ab: dash(x.ability),
        pw: dash(x.power) || '三相',
        rc: dash(x.remocon) || 'リモコン別売',
        tp: dash(x.type) || 'シングル',
        opt: dash(x.wide),
        om: dash(x.out_model), im: dash(x.in_model),
        pm: dash(x.panel_model), rm: dash(x.rc_model)
      });
    });

    return {
      rows: rows,
      pricePages: rows.length ? 1 : 0,   // 紙ではないので「ページ」は数えない
      skippedNoPrice: noPrice,
      head: {
        maker: '三菱電機',
        brand: 'Mr.SLIM（店舗・事務所用パッケージエアコン）',
        source: '三菱電機 Mr.SLIM 機種検索のデータファイル',
        note: '価格は税別のメーカー標準価格です。配管・据付工事費は含みません。社内利用限定（第三者提供不可）。',
        seriesOrder: ['スリムZR', 'スリムER', 'ズバ暖スリムHシリーズ', 'ズバ暖スリムDHシリーズ'],
        typeOrder: ['シングル', '同時ツイン', '同時トリプル', '同時フォー'],
        urlBase: 'https://www.mitsubishielectric.co.jp/ldg/wink/qr/002/'
      }
    };
  }

  /* ====================================================================
     別売品（オプション）を読む
     --------------------------------------------------------------------
     機種データとは別の表。紙面の作りが違うので読み方も別にしてある。

     表の作り（ダイキン p.185〜240 で確認）
     ・列の見出し＝**その別売品が付く室内機**（FHCP40〜71GA など）
     ・マスに品番と価格があれば「付く」、**「―」なら付かない**
       （「―」＝非対応は NotebookLM でも確認した）
     ・品名は左側に縦に並ぶ。しかも表のマスが縦につながっているので、
       品名の文字が**その行より下に置かれている**ことがある。
       だから「上の行から引き継ぐ」では取れない。
       x の帯ごとに、その行にいちばん近い文字を採る。

     ここを間違えると「フレッシュホワイト」のような色だけの名前になる。
     正しくは「センシング機能無しパネル 標準パネル フレッシュホワイト」。
     ==================================================================== */
  var OPT_MONEY = /^[¥￥]?\s*((?:[1-9]\d{0,2},)?\d{1,3},\d{3})\s*円?/;
  var OPT_CODE = /^[A-Z][A-Z0-9\-]{3,}$/;
  var OPT_DASH = /^[―—‐\-–]$/;
  // 室内機の見出し（FHCP40〜71GA、FHP224・280DB など）
  var OPT_HEAD = /^F[A-Z]{1,3}\d{2,3}\s*[～~〜・,、]\s*\d{2,3}\s*[A-Z]{1,2}$|^F[A-Z]{1,3}\d{2,3}\s*[A-Z]{1,2}$/;
  var OPT_COMMON = '(各機種共通)';

  function isJa(s) { return /[ぁ-ヿ一-鿿]/.test(s); }

  /** 行にまとめる（マスは分けたまま） */
  function optRows(items) {
    var a = items.filter(function (i) { return i.s.trim(); })
      .sort(function (p, q) { return q.y - p.y || p.x - q.x; });
    var rows = [], cur = null;
    a.forEach(function (o) {
      if (!cur || Math.abs(cur.y - o.y) > 3) { cur = { y: o.y, cells: [] }; rows.push(cur); }
      cur.cells.push(o);
    });
    rows.forEach(function (r) { r.cells.sort(function (p, q) { return p.x - q.x; }); });
    return rows;
  }

  /* 品番の値段を探す。
     まず同じ行の右どなり。無ければ**すぐ下の行**の、真下あたりを見る。
     日立の表は「品番の行」と「金額の行」が上下に分かれていることがあり、
     前は同じ行しか見ていなかったので、その表の品目がまるごと落ちていた
     （2026-09-09、日立 p.88 てんつり BG-56NUP2／67,000円 で分かった）。 */
  function optPriceRightOrBelow(rows, r, i, o) {
    var money = false;
    for (var j = i + 1; j < r.cells.length; j++) {
      var t = r.cells[j].s.trim();
      if (OPT_CODE.test(t)) break;
      var mm = t.match(OPT_MONEY);
      if (mm) return { y: yen(mm[1]), x: r.cells[j].x };
    }
    // その行のどこかに金額があるなら、値段は同じ行に書く表。下の行は見ない（となりの品番の値段を取ってしまう）
    r.cells.forEach(function (c) { if (OPT_MONEY.test(c.s.trim())) money = true; });
    if (money) return null;

    var best = null, bd = 1e9;
    rows.forEach(function (q) {
      var dy = r.y - q.y;                     // y は下から上。dy>0 が「下の行」
      if (dy <= 0 || dy > 14) return;
      q.cells.forEach(function (c) {
        var m = c.s.trim().match(OPT_MONEY);
        if (!m) return;
        var dx = Math.abs(c.x - o.x);
        if (dx > 40) return;
        var d = dy * 2 + dx;
        if (d < bd) { bd = d; best = { y: yen(m[1]), x: c.x }; }
      });
    });
    return best;
  }

  /** 列の見出し（＝付く室内機）を集める */
  function optColumns(rows) {
    var cols = [];
    rows.forEach(function (r) {
      r.cells.forEach(function (c) {
        var s = c.s.replace(/\s/g, '');
        if (!OPT_HEAD.test(s)) return;
        var col = null;
        cols.forEach(function (k) { if (!col && Math.abs(k.x - c.x) < 40) col = k; });
        if (!col) { col = { x: c.x, heads: [], y: c.y }; cols.push(col); }
        if (col.heads.indexOf(s) < 0) col.heads.push(s);
        col.y = Math.max(col.y, c.y);
      });
    });
    return cols.sort(function (a, b) { return a.x - b.x; });
  }

  /* --------------------------------------------------------------------
     品名を組み立てる道具（5社で共通に使う）

     品名は左側に「大分類 ｜ 品名 ｜ 色」のように縦の列で並ぶ。
     しかも表のマスが縦につながっていて、**品名の文字がその行より下に
     置かれていることがある**（マスの中央に置かれるため）。
     だから「上の行から引き継ぐ」では取れない。

     ① 隙間で細かく切って、始まりの x を数え、列の位置を決める
     ② 断片を列に割り当て、同じ列のものはつなげる
     ③ 行ごとに、列（帯）ごとの「いちばん近い文字」を拾ってつなげる
     -------------------------------------------------------------------- */
  /* 品名として通してよい文字かどうか。

     狭い欄に折り返して書かれた注意書きが、品名の列に紛れ込む。

       右記以外のフレキ        ← 注意書きの1行目
       シブルダクト（丸ダク    ← 2行目。ここだけ拾うと品名が「シブルダクト（丸ダク」になる
       ト）関連部材につい
       てはP.204以降を

     途中で切れた行は**かっこの数が合わない**か、**助詞で終わる**。そこで見分ける。
     （2026-09-09、ダイキン K-SGRS18A2FF とキヤリア TCB-PCNT31TL で分かった） */
  function nameLike(s) {
    var t = String(s || '').trim();
    if (!t) return false;
    if (/[■●▲◆]/.test(t)) return false;                 // 紙面の飾り記号
    if (/P\.\s*\d/.test(t)) return false;                // 「P.204以降を」のような参照
    if (/[をにはがのてでと、]$/.test(t)) return false;     // 助詞で終わる＝文の途中
    if (/^(右記|左記|上記|下記|前記|同左|同上|その他の)/.test(t)) return false;  // 注意書きの書き出し
    var open = (t.match(/[（(]/g) || []).length;
    var close = (t.match(/[）)]/g) || []).length;
    if (open !== close) return false;                     // かっこが片方だけ＝行の途中で切れている
    return true;
  }

  function nameReader(rows, leftEnd, headY, mode) {
    function chops(cells) {
      var seg = [], cur = null;
      cells.filter(function (o) {
        if (o.x >= leftEnd) return false;
        // 紙面のいちばん端（x<25）に1文字ずつ縦に並んでいるのはページの見出し。
        // 品名の列ではないので入れない（「カセット形」が品名に混ざっていた）
        if (o.x < 25 && o.s.trim().length <= 1) return false;
        return true;
      })
        .sort(function (p, q) { return p.x - q.x; })
        .forEach(function (o) {
          if (!cur || o.x > cur.right + 4) { cur = { x: o.x, right: o.x + o.w, s: o.s }; seg.push(cur); }
          else { cur.s += o.s; cur.right = Math.max(cur.right, o.x + o.w); }
        });
      return seg;
    }

    var hist = {};
    rows.forEach(function (r) {
      if (r.y >= headY - 2) return;
      chops(r.cells).forEach(function (s) { hist[s.x] = (hist[s.x] || 0) + 1; });
    });
    var colX = [];
    Object.keys(hist).map(Number).sort(function (a, b) { return a - b; }).forEach(function (x) {
      var n = hist[x], near = null;
      colX.forEach(function (k) { if (!near && Math.abs(k.x - x) < 12) near = k; });
      if (near) { if (n > near.n) { near.x = x; near.n = n; } }
      else if (n >= 2) colX.push({ x: x, n: n });
    });
    colX.sort(function (a, b) { return a.x - b.x; });

    function words(cells) {
      var byCol = {};
      chops(cells).forEach(function (s) {
        var col = null, bd = 1e9;
        colX.forEach(function (k) { var d = Math.abs(k.x - s.x); if (d < bd) { bd = d; col = k; } });
        var key = col ? col.x : s.x;
        byCol[key] = (byCol[key] || '') + s.s;
      });
      return Object.keys(byCol).map(Number).sort(function (a, b) { return a - b; })
        .map(function (x) { return { x: x, s: byCol[x].replace(/注[\d,]+/g, '').replace(/※\d+/g, '').trim() }; })
        .filter(function (o) { return isJa(o.s) && o.s.length >= 2; });
    }

    var bands = [];
    rows.forEach(function (r) {
      if (r.y >= headY - 2) return;
      words(r.cells).forEach(function (w) {
        var b = null;
        bands.forEach(function (k) { if (!b && k.x === w.x) b = k; });
        if (!b) { b = { x: w.x, at: [] }; bands.push(b); }
        b.at.push({ y: r.y, s: w.s });
      });
    });
    bands.sort(function (a, b) { return a.x - b.x; });

    // mode が above のときは「その行より上」に置かれた見出しだけを見る。
    // 品名をマスの上端に書く社（パナソニック）は、これでないと1行ずれる。
    return function (y) {
      var parts = [];
      bands.forEach(function (b) {
        var best = null, bd = 1e9;
        b.at.forEach(function (l) {
          if (!l.s || l.s.length < 2) return;
          // 表の下や横に書かれた注記の文章は品名ではない
          // （「『エアーフィルター』は室内ユニットに標準で…です。」が品名に付いていた）
          if (l.s.length > 12 && /[。］」]/.test(l.s)) return;
          if (!nameLike(l.s)) return;
          if (mode === 'above' && l.y < y - 2) return;
          var d = Math.abs(l.y - y);
          if (d < bd) { bd = d; best = l; }
        });
        // vert（品番が縦に並ぶ表）は、品名がマスの先頭にしか書かれず離れているので広めに見る
        var far = (mode === 'above' ? 60 : (mode === 'vert' ? 60 : 30));
        if (best && bd <= far) parts.push(best.s);
      });
      var uniq = [];
      parts.forEach(function (s) {
        var dup = false;
        uniq.forEach(function (u) { if (u.indexOf(s) >= 0) dup = true; });
        if (!dup) uniq.push(s);
      });
      return uniq.join(' ')
        .replace(/[①-⑳]/g, ' ')     // 紙面の丸数字（①②③…）は品名ではない
        .replace(/[（(]\s*注\s*[\d,\s]+\s*[）)]?/g, ' ')   // （注 2 ）のような注記番号
        .replace(/^品名\s*/, '')                          // 見出しの「品名」を拾うことがある
        .replace(/(FIVE\s*STAR\s*ZEAS|Eco-?ZEAS|スゴ暖\s*ZEAS)\s*シリーズ(のみ)?に?適用?/g, ' ')
        .replace(/(FIVE\s*STAR\s*ZEAS|Eco-?ZEAS)\s*(および|シリーズ)?/g, ' ')
        .replace(/[\d,]{3,}\s*円?/g, ' ')
        .replace(/\b[A-Z][A-Z0-9\-]{3,}\b/g, ' ')
        .replace(/適用機種/g, ' ')
        .replace(/[ -]/g, ' ')
        .replace(/[（(]\s*[）)]/g, ' ')      // 注記を消したあとに残る空の（）
        .replace(/^[・、。\s]+|[・、。\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };
  }

  function optPage(items, page, out) {
    var rows = optRows(items);
    var cols0 = optColumns(rows);
    var common = !cols0.length;      // 列見出しの無いページは「各機種共通の別売品」
    var cols = common ? [{ x: 300, heads: [OPT_COMMON], y: -1e9 }] : cols0;
    var headY = common ? 1e9 : Math.max.apply(null, cols.map(function (k) { return k.y; }));
    var leftEnd = common ? 300 : cols[0].x - 20;

    // 品名は5社で同じ作りなので、共通の道具で組み立てる
    var nameAt = nameReader(rows, leftEnd, headY);

    rows.forEach(function (r) {
      if (r.y >= headY - 2) return;
      var name = nameAt(r.y);
      var marks = [];
      r.cells.forEach(function (o, i) {
        var s = o.s.trim();
        if (OPT_DASH.test(s)) { marks.push({ x: o.x, dash: true }); return; }
        if (!OPT_CODE.test(s)) return;
        var y2 = 0;
        for (var j = i + 1; j < r.cells.length; j++) {
          var t = r.cells[j].s.trim();
          if (OPT_CODE.test(t) || OPT_DASH.test(t)) break;   // 次のマスに入ったら打ち切り
          var mm = t.match(OPT_MONEY);
          if (mm) { y2 = yen(mm[1]); break; }
        }
        marks.push({ x: o.x, code: s, yen: y2 });
      });

      marks.forEach(function (mk) {
        if (mk.dash || !mk.code || !mk.yen) return;   // 「―」は付かない／値段の無いものは入れない
        var col = null, bd = 1e9;
        cols.forEach(function (k) { var d = Math.abs(k.x - mk.x); if (d < bd) { bd = d; col = k; } });
        if (!col || bd > 120) return;
        var fits = col.heads.map(function (h) { return h === OPT_COMMON ? { all: true } : { im: h }; });
        out.push({ page: page, name: name, code: mk.code, y: mk.yen, fits: fits });
      });
    });
  }

  /* --------------------------------------------------------------------
     パナソニックの別売品
     ダイキンと違い、**「適用室内ユニット」という列が1つ**ある。
       品名 ｜ 適用室内ユニット ｜ 品番 ｜ 希望小売価格
       天井パネル 標準パネル ホワイト ｜ 全機種 ｜ CZ-160KPU7C ｜ 71,000円
       自然気化式加湿器            ｜ P40〜P80 ｜ CZ-07ASU7 ｜ 141,000円
     どの機種タイプの表かは、ページの端に縦書きで書いてある（「４方向天井カセット形」）。
     -------------------------------------------------------------------- */
  function optPagePana(items, page, out, opt, ctx) {
    opt = opt || {};
    var codeWord = opt.codeWord || /品番|部品形名/;
    var priceWord = opt.priceWord || /希望小売価格|価格/;
    var types = opt.types || null;
    var rows = optRows(items);

    var head = null;
    rows.forEach(function (r) {
      if (head) return;
      var t = r.cells.map(function (o) { return o.s; }).join('');
      if (/適用室内ユニット/.test(t) && codeWord.test(t)) head = r;
    });
    if (!head) return;

    var xOf = function (word) {
      var x = null;
      head.cells.forEach(function (c) { if (x === null && c.s.indexOf(word) >= 0) x = c.x; });
      return x;
    };
    // 見出しのマスが「適用室内ユニッ」「ト」のように割れることがあるので、頭の数文字で探す
    var xFit = xOf('適用室内');
    var xCode = null, xPrice = null;
    head.cells.forEach(function (c) {
      if (xCode === null && codeWord.test(c.s)) xCode = c.x;
      if (xPrice === null && priceWord.test(c.s) && c.s.indexOf('適用') < 0) xPrice = c.x;
    });
    if (xFit == null || xCode == null) return;
    if (xPrice == null) xPrice = xCode + 80;

    /* この表がどの機種タイプのものかを決める。

       タイプの一覧をもらっているときは、**その名前が紙面にあるかどうか**で決める。
       まずページのノド（右端）を見て、無ければページ全体から探す。
       長い名前から先に見る（「高天井用1方向カセット形」を「1方向…」より先に当てる）。

       前はページの端の縦書きを先に使っていて、
       ・キヤリア……「70㎥/h以下、P112形」をタイプとして拾い、28品目がどこにも当たらない
       ・パナソニック……1方向天井カセット形のページを天井ビルトインカセット形と取り違え、
         18機種に別売品が出ない
       という取り違えが起きていた（2026-09-09）。 */
    var norm = function (t) {
      return String(t).replace(/[\s　]/g, '')
        .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    };
    var type = '';
    if (types) {
      var sorted = types.slice().sort(function (a, b) { return b.length - a.length; });

      /* ①「そのマスがタイプ名そのもの」を、ページのいちばん上から探す。
         これが節の見出し。ページの中の参照（「天井ビルトインカセット形はP.81」など）に
         引っかからないので、いちばん確か */
      var top = -1e9;
      items.forEach(function (o) {
        var t = norm(o.s);
        sorted.forEach(function (k) {
          if (norm(k) !== t) return;
          if (o.y > top) { top = o.y; type = k; }
        });
      });

      // ② ページのノド（端）に入っている小さな見出し
      if (!type) {
        var side = norm(items.filter(function (o) { return o.x > xPrice + 30 || o.x < 40; })
          .map(function (o) { return o.s; }).join(''));
        sorted.forEach(function (t) { if (!type && side.indexOf(norm(t)) >= 0) type = t; });
      }

      // ③ それでも決まらなければページ全体から。長い名前を先に見る
      if (!type) {
        var whole = norm(items.map(function (o) { return o.s; }).join(''));
        sorted.forEach(function (t) { if (!type && whole.indexOf(norm(t)) >= 0) type = t; });
      }
    }
    // タイプの一覧が無い社は、ページの端の縦書きを使う
    if (!type && !types) {
      items.forEach(function (o) {
        if (o.x > xPrice + 30 && /形$/.test(o.s) && o.s.length >= 4 && isJa(o.s)) type = o.s;
      });
    }
    // 機種データのページ番号から決めるのがいちばん確か（紙面に書いていない社があるため）
    if (ctx && ctx.pageTypes) {
      var byPage = typeAtPage(ctx.pageTypes, page);
      if (byPage) type = byPage;
    }

    // 品名は「大分類 ｜ 品名 ｜ 色」の縦の列。色だけの行でも品名を拾えるようにする
    var nameAt = nameReader(rows, xFit - 25, head.y, 'above');

    rows.forEach(function (r) {
      if (r.y >= head.y - 2) return;

      var code = '', price = 0, fitTxt = '';
      r.cells.forEach(function (c) {
        var s = c.s.trim();
        /* 品番のマスに注記がくっついていることがある。
           「TCB-KBCN60（オプション出力）」はマス全体では品番の形にならず、
           落としていた（キヤリア壁掛形の4品目のうち2つ）。頭から品番だけ取る */
        if (!code && Math.abs(c.x - xCode) < 40) {
          var mc = s.match(/^([A-Z][A-Z0-9]*-[A-Z0-9\-]{2,})/);
          if (mc) code = mc[1];
        }
        if (c.x >= xFit - 25 && c.x < xCode - 15) fitTxt += s;
        if (c.x >= xPrice - 25) { var m = s.match(OPT_MONEY); if (m && !price) price = yen(m[1]); }
      });
      var nm = nameAt(r.y);
      if (!code || !price) return;

      var fit;
      if (/全機種/.test(fitTxt)) fit = type ? { type: type } : { all: true };
      else {
        var cr = capRange(fitTxt);
        fit = cr ? (type ? { type: type, cap: cr } : { cap: cr }) : (type ? { type: type } : { all: true });
      }
      out.push({ page: page, name: nm, code: code, y: price, fits: [fit] });
    });
  }

  /* --------------------------------------------------------------------
     日本キヤリアの別売品
     **列の見出しがシリーズ**で、マスに入っているのは「能力ランク」。
       別売部品 ｜ ウルトラパワーエコ ｜ スーパーパワーエコゴールド ｜ … ｜ 部品形名 ｜ 希望小売価格
       吹出ガイド ｜ P40形〜P50形 ｜ P40形〜P63形 ｜ … ｜ TCB-G50 ｜ ¥14,000
     「―」はそのシリーズには付かない印。
     シリーズ名は2行に割れて書かれている（「ウルトラ」＋「パワーエコ®」）ので、
     見出しのまわり数行を x でまとめてから読む。
     -------------------------------------------------------------------- */
  /* --------------------------------------------------------------------
     キヤリアの「別売部品一覧、および組合せ可否」のページ（p.57 など）

       部品名                    部品形名           価格（税別）
       天井パネル（標準）          RBC-U43PG★       ¥67,000
       オートグリルパネル          RBC-UA43PG（W）   ¥100,000

     右半分は組合せの○×がびっしり並ぶが、そこは読まない。
     どの機種に付くかは、手前の価格ページから覚えたタイプで決める。

     **室内機に付く別売品（パネル・フィルター・リモコン）はここにしか無い。**
     前はこの表を読んでおらず、天井カセット形4方向の240機種には
     室外機の架台しか出ていなかった（2026-09-09）。
     -------------------------------------------------------------------- */
  /* --------------------------------------------------------------------
     キヤリアの別売品の品名（2026-09-10 作り直し）
     ----------------------------------------------------------------------
     前は nameReader（上下どちらでも近いものを採る・列ごとに拾ってつなぐ）で
     読んでいて、166品目中49件の品名が崩れていた。BIGBOSSの画面で
     「○1○2吹出ガイド」「御 ワイヤレスリモコン受信部 ワイヤードリモコン」と出た。

     紙面を見て分かったこと（57・127〜129ページ）
       ・丸数字は「①」ではなく「○」＋数字、または「12 高さ調整」の形で来る
       ・「受」「在」は受注生産・在庫限りのマーク。■も同じ。品名ではない
       ・「制御」「空質関連」は1文字ずつ縦に並んだ見出し。品名ではない
       ・■ があるだけで品名を「品名らしくない」とはねていたので、
         自分の行の品名が消え、となりの行の品名2つがつながっていた
         （TCB-TCU41L は「リモートセンサー」なのに「ワイヤレスリモコン受信部」になった）

     表の作りが2通りある。
       一覧の表（室内機用）……品名は品番と**同じ行**。2行にまたがるマスだけ
                              （「プラズマ空清」「ユニット」）はつなぐ
       室外機の表          ……品名は背の高いマスの**いちばん上**に1回だけ。
                              その下の品番は**上の見出し**を受け継ぐ
     -------------------------------------------------------------------- */

  /** 品名の列（leftEnd より左）の文字を、行ごとに「かたまり」にする */
  function carSegs(rows, leftEnd, headY, leftStart) {
    var out = [];
    var from = (leftStart == null) ? -1e9 : leftStart;
    rows.forEach(function (r) {
      if (r.y >= headY - 2) return;
      var cur = null;
      r.cells.filter(function (o) { return o.x < leftEnd && o.x >= from; })   // 表の左にある図の文字は見ない
        .sort(function (p, q) { return p.x - q.x; })
        .forEach(function (o) {
          /* 1文字のかけら（縦書き見出しの「制」、マークの「在」）は、となりの品名とつながない。
             すき間が4ポイントより狭いと、前は「制 ワイヤレスリモコン」とひとかたまりにしていた。
             1文字どうし（1文字ずつに割れて来た語）はつなぐ */
          var one = o.s.trim().length <= 1 && /[一-龥ぁ-んァ-ヶ]/.test(o.s);
          /* 1文字のかな・漢字は、ふつうは切り離す（縦書き見出しの「制」、マークの「在」）。
             ただし、前の語とのすき間がほとんど無い（1.5以内）ときは語の続き。
             pdf.js は「防護ネットセット」を「防護ネットセッ」＋「ト」に割ってよこすので、
             切り離すと「防護ネットセッ」になっていた（2026-09-10） */
          var tight = cur && (o.x - cur.right) <= 1.5;
          if (!cur || o.x > cur.right + 4 || (one !== cur.one && !tight) || Math.abs(o.y - cur.oy) > 2.5) {
            cur = { x: o.x, y: r.y, oy: o.y, right: o.x + (o.w || 0), s: o.s, one: one };
            out.push(cur);
          } else {
            cur.s += o.s;
            cur.right = Math.max(cur.right, o.x + (o.w || 0));
          }
        });
    });
    return out;
  }

  /** 丸数字・マーク・注記番号・くっついた品番を落とす */
  function carClean(s) {
    return String(s || '')
      .replace(/[\u2000-\u200b\u3000]/g, ' ')
      .replace(/[\u0600-\u06FF]/g, '')                    // pdf.js が記号の字形をアラビア文字に読み違えたかけら
      .replace(/[\u2460-\u24FF\u2776-\u2793\u3251-\u325F\u32B1-\u32BF]/g, ' ')
      .replace(/○\s*\d{1,2}/g, ' ')
      .replace(/○/g, ' ')                                  // 数字と離れて残った丸（「○壁取付架台」）
      /* 区分の語（縦書きの見出し）。pdf.js は横書きの1語でよこし、品名の頭に付くことがある。
         うしろにすき間か番号が続くときだけ外す（「吸込ハーフパネル」の「吸込」は品名なので外さない） */
      .replace(/^\s*(空質関連|施工関連|フィルターほか|リモコン・グリル|据\s*付|吸\s*込|吹\s*出|制\s*御|空\s*質|その他)(?=\s|\d|[\u2460-\u24FF\u2776-\u2793])\s*/, '')
      .replace(/^\s*\d{1,2}[a-z]?\s+(?=[^\d\s])/, '')    // 丸数字が「12 」「1a 」の形で来るとき
      .replace(/^\s*\d{1,2}[a-z]?(?=[ぁ-んァ-ヶ一-龥（(Ａ-Ｚａ-ｚ])(?![方形個本枚台])/, '')   // 「10高湿度対応キット」「1a天井パネル」「2Ｌ字配管キット」（丸数字の下に小さい番号）。「2方向」は数なので残す
      .replace(/^\s*[a-z](?=[ぁ-んァ-ヶ一-龥])/, '')      // 「bオートグリルパネル」
      .replace(/^\s*[一-龥]\s+[一-龥](?=[^\s\d])/, '')   // 「据 付ドレンアップキット」「吸 込下面吸込ボックス」（区分がくっついた）
      .replace(/※\s*\d+/g, ' ')
      .replace(/[■□◆◇●★☆]/g, ' ')
      .replace(/[A-Z][A-Z0-9]*-(?=[A-Z0-9\-]*\d)[A-Z0-9\-]{2,}/g, ' ')   // 品名にくっついた品番（品番には必ず数字がある。TCC-LINK は品名）
      .replace(/\s+/g, ' ').trim()
      .replace(/([^\s])\s*[受在]$/, '$1')                  // うしろの「受」「在」マーク
      .trim();
  }

  function carNumbered(raw) {
    return /^[\s\u2000-\u200b\u3000]*([\u2460-\u24FF\u2776-\u2793\u3251-\u325F\u32B1-\u32BF]|○\s*\d|\d{1,2}[\s\u2000-\u200b])/.test(raw);
  }

  /** 一覧の表：品名は品番と同じ行 */
  function carrierPartsNamer(rows, leftEnd, headY, codeYs, tableLeft) {
    if (!codeYs.length) return function () { return ''; };
    var lo = Math.min.apply(null, codeYs) - 8;
    var onCode = function (y) { return codeYs.some(function (c) { return Math.abs(c - y) <= 3.5; }); };
    var all = carSegs(rows, leftEnd, headY, tableLeft);
    var segs = all.filter(function (g) {
      if (g.y < lo) return false;                  // 表の下の注記
      if (/。/.test(g.s)) return false;
      var t = carClean(g.s);
      return t.length >= 2 && isJa(t);            // 縦書き見出しの1文字・「在」マークはここで落ちる
    });
    if (!segs.length) return function () { return ''; };
    /* 品名の列は、品番の行にいちばん多く出てくる列。
       その左の列は区分の見出し（「据　付」「吸込・吹出」「制御」）なので落とす（74ページ）。
       「P40形〜P160形」「全機種」のような適用の列は数えない。ほぼ全部の行にあるので、
       数えると品名の列より多くなってしまう（103ページ） */
    var CAPLIKE = /P\d+形|全機種|筐体/;
    var colsX = [];
    segs.forEach(function (g) {
      if (!onCode(g.y) || CAPLIKE.test(g.s)) return;
      var c = null;
      colsX.forEach(function (k) { if (!c && Math.abs(k.x - g.x) < 6) c = k; });
      if (!c) { c = { x: g.x, n: 0 }; colsX.push(c); }
      c.n++;
    });
    if (!colsX.length) return function () { return ''; };
    var mainX = colsX.reduce(function (a, b) { return b.n > a.n ? b : a; }).x;
    var subX0 = mainX + 35;
    var hasName = function (y) {
      return segs.some(function (h) { return Math.abs(h.y - y) <= 1 && h.x >= mainX - 6 && h.x < subX0; });
    };
    segs = segs.filter(function (g) {
      if (g.x >= mainX - 6) return true;
      return g.right > mainX + 4 && !hasName(g.y);
    });
    var subX = mainX + 35;                         // 右の列は「ハイタイプ」「P40形〜P71形」などの補足

    /* 1つの品名のマスに品番が何行もあり、2行目から下に注意書きが並ぶ表がある（67ページ）
         「交換の目安 2,500時間」「ご使用の際には必須です。」「オプションフィルター③〜⑤を」
       これは品名ではない。上の品名を受け継ぐ */
    var NOTE = /目安|必須|ご使用|使用時|突出|ご確|認ください|能力|条件|参照|します|です|加湿量|マンセル|\d\s*[〜～]\s*\d/;
    var ys = codeYs.slice().sort(function (a, b) { return b - a; });   // 上の行から
    var info = ys.map(function (y) {
      var own = segs.filter(function (g) { return Math.abs(g.y - y) <= 3.5; });
      var raw = own.filter(function (g) { return g.x < subX; }).map(function (g) { return g.s; }).join(' ');
      var marks = all.filter(function (g) {
        return Math.abs(g.y - y) <= 3.5 && g.x >= mainX - 12 && g.x < subX;
      });
      return {
        y: y,
        main: carClean(raw),
        numbered: carNumbered(raw) || marks.some(function (g) { return carNumbered(g.s) || /^[\u2460-\u24FF\u2776-\u2793\u3251-\u325F\u32B1-\u32BF★]$/.test(g.s.trim()); }),
        sub: carClean(own.filter(function (g) { return g.x >= subX; }).map(function (g) { return g.s; }).join(' '))
               .replace(/^全機種$/, '')
      };
    });

    info.forEach(function (it) {
      if (it.main && NOTE.test(it.main)) { it.main = ''; it.note = true; }
      else if (it.main && /^[（(]/.test(it.main)) { it.paren = it.main; it.main = ''; }
    });
    /* 自分の行に品名が無い＝品名が品番の行から少しずれて書いてある。
         2行で1つの品番の行を上下からはさむ（「オートグリル操作専用」「ワイヤレスリモコン」）
         2行ぶんのマスのまん中に1行（「高性能フィルター」）
       はさんでいる行を上からつないで、その行の品名にする。
       **つなぎ判定より先にやる。**57ページの「12 高さ調整」は品番の行から3.8ずれていて、
       後回しにすると、つなぐかどうか決める時点で品名が空のままになり、
       下の行の「スペーサー」とつながらなかった（「高さ調整」「スペーサー」に割れた）。
       ほかの品番の行に「ほぼ乗っている」（2以内）ものは、その品番の品名なので採らない。
       3.5 にすると、まん中より少し下にある品名を下の品番に取られていた（57ページ UFM1604UA） */
    info.forEach(function (it) {
      if (it.main || it.note || it.paren) return;
      var near = segs.filter(function (g) {
        if (g.x >= subX || Math.abs(g.y - it.y) > 7) return false;
        if (NOTE.test(g.s)) return false;
        return !codeYs.some(function (c) { return c !== it.y && Math.abs(c - g.y) <= 2; });
      }).sort(function (a, b) { return b.y - a.y; });
      if (!near.length) return;
      it.main = carClean(near.map(function (g) { return g.s; }).join(''));
      it.numbered = carNumbered(near[0].s);
    });

    // 2行にまたがるマス。補足のある行が続き、下の行の品名に番号が無ければ続き
    info.forEach(function (it, i) {
      var prev = info[i - 1];
      if (prev && prev.group && prev.sub && it.sub && it.main && !it.numbered &&
          /^[ァ-ヶー]{2,6}$/.test(it.main) && prev.main && prev.main.length <= 8) {
        it.group = prev.group;
        it.group.text += it.main;
      } else if (it.main) {
        it.group = { text: it.main };
      }
    });
    // 自分の行に品名が無い＝2行ぶんのマスのまん中に1行で書いてある（「高性能フィルター」）
    info.forEach(function (it, i) {
      if (it.group) return;
      /* 受け継ぐ先は、すぐ上にある品名らしい行。品番の無い行に書いた見出しもふくめる。
         83ページの「⑩気化式加湿器」は品番の無い行にあり、その下の3行（品名の欄は
         「加湿量（kg/h）…」という注記）が、品番のある行しか見ていなかったせいで
         さらに上の「⑨丸ダクト用フランジ」を受け継いでいた（2026-09-10） */
      var up = null;
      segs.forEach(function (g) {
        if (g.x >= subX || g.y <= it.y || g.y - it.y > 30) return;
        if (NOTE.test(g.s) || /^[（(]/.test(g.s.trim()) || carClean(g.s).length < 2) return;
        if (!up || g.y < up.y) up = g;
      });
      if (up) {
        // その行が品番のある行なら、その行の品名（つないだ・かっこを足した形）をそのまま使う
        var owner = null;
        info.forEach(function (o) { if (o.group && Math.abs(o.y - up.y) <= 2) owner = o; });
        var base = owner ? owner.group.text : carClean(up.s);
        it.group = it.paren ? { text: base + it.paren } : (owner ? owner.group : { text: base });
        return;
      }
      // マスの上端に品名を書く表では、すぐ上の行の品名を受け継ぐ。
      // かっこ書き（「（ロングライフフィルター付）」）は、その品名の続きとして付ける
      for (var k = i - 1; k >= 0; k--) {
        if (info[k].group && info[k].y - it.y < 45) {
          it.group = it.paren ? { text: info[k].group.text + it.paren } : info[k].group;
          break;
        }
      }
      if (!it.group && it.paren) it.group = { text: it.paren };
    });

    var by = {};
    info.forEach(function (it) {
      var name = it.group ? it.group.text : '';
      if (it.sub) name = name ? name + ' ' + it.sub : it.sub;
      by[it.y] = name;
    });
    return function (y) { return by[y] || ''; };
  }

  /** 「TCB-G50 ○」「TCB-G50 ①」のように、品番のうしろに丸数字が付いて来ても頭の品番を取る。
      pdf.js はこの形でよこす（PyMuPDF は分けてよこしていたので、前は気づかなかった）。
      「TCB-G802×2」（2台ぶんのセット）は本物の TCB-G802 とぶつかるので、品番とみなさない */
  function carCodeHead(s) {
    var m = String(s || '').trim().match(/^([A-Z][A-Z0-9]*-[A-Z0-9\-]{2,})(.*)$/);
    if (!m || /[×xX]\s*\d/.test(m[2])) return '';
    return OPT_CODE.test(m[1]) ? m[1] : '';
  }

  /** 室外機の表：品名はマスのいちばん上。下の品番は上の見出しを受け継ぐ */
  function carrierOutdoorNamer(rows, leftEnd, headY, codeYs) {
    var segs = carSegs(rows, leftEnd, headY);
    /* 見出しは列の左はしに立つ。絵の説明（「吸込フード（側面）」「①支柱」）は内側に寄っている。
       その左はしは、**丸数字つきの見出し（「①② 吹出ガイド」）の x** で決める。
       ページの端のつまみ（「室外」「別売部品」）は pdf.js では横書きの1語で来るので、
       名前らしい文字のいちばん左で決めると、つまみを左はしと取り違え、
       本物の見出しを内側の説明文として捨てていた（2026-09-10、128ページ。品名が全部空になった） */
    var edge = 1e9, edgeAny = 1e9;
    segs.forEach(function (g) {
      var t = carClean(g.s);
      if (t.length < 2 || !isJa(t)) return;
      edgeAny = Math.min(edgeAny, g.x);
      if (carNumbered(g.s)) edge = Math.min(edge, g.x);
    });
    if (edge === 1e9) edge = edgeAny;
    var heads = [];
    segs.forEach(function (g) {
      if (g.x > edge + 8 || g.x < edge - 8) return;      // つまみ（左はしより外）も見出しにしない
      var raw = g.s.replace(/[\u2000-\u200b\u3000]/g, ' ').trim();
      if (/^[（(〈<]|^[a-z]\s|、|。/.test(raw)) return;   // 「（深形）」「a 防雪フード」「上・下吹き、…」
      var t = carClean(raw);
      if (t.length < 2 || !isJa(t)) return;
      var onRow = codeYs.some(function (y) { return Math.abs(y - g.y) <= 3.5; });
      if (!carNumbered(raw) && !onRow) return;
      // すぐ下の「（深形）」「(ドレンパン付)」は品名の続き
      segs.forEach(function (h) {
        if (h.y < g.y - 14 || h.y > g.y - 4 || Math.abs(h.x - g.x) > 15) return;
        var hs = h.s.replace(/[\u2000-\u200b\u3000]/g, ' ').trim();
        if (/^[（(]/.test(hs) && hs.length <= 16) t += carClean(hs);
      });
      heads.push({ y: g.y, s: t });
    });
    return function (y) {
      var best = null;
      heads.forEach(function (h) {
        if (h.y >= y - 3.5 && (!best || h.y < best.y)) best = h;   // 上にあるもので、いちばん近いもの
      });
      return best ? best.s : '';
    };
  }

  /** その行の品番。品番の列にあるもの、または品名のうしろにくっついて来たもの */
  function carRowCode(r, xCode) {
    var code = '';
    r.cells.forEach(function (c) {
      var t = c.s.trim();
      if (!code && Math.abs(c.x - xCode) < 30) {
        var m = t.match(/^([A-Z][A-Z0-9]*-[A-Z0-9\-]{2,})/);
        if (m) code = m[1];
      }
    });
    // 「丸ダクト用フランジ（吹出し分ダクト用）TCB-FF151US」と品名にくっついて来る行がある
    if (!code) r.cells.forEach(function (c) {
      if (code || c.x >= xCode - 15) return;
      var m = c.s.trim().match(/([A-Z][A-Z0-9]*-(?=[A-Z0-9\-]*\d)[A-Z0-9\-]{2,})$/);
      if (m && isJa(c.s)) code = m[1];
    });
    return code;
  }

  /** ページから「品番 → 品名」を引く（一覧の表の読み方で）。
      103〜123ページの表は optPagePana（パナソニックと共用）が読むが、その品名は
      となりの行の品名や縦書きの区分をつないでいた（「制 御 アダプター™受」）。
      パナソニックには手を入れず、キヤリアだけ後から品名を付け直すのに使う */
  function carrierPageNames(items) {
    var rows = optRows(items);
    var head = null;
    rows.forEach(function (r) {
      if (head) return;
      var t = r.cells.map(function (o) { return o.s; }).join('');
      if (/部品形名/.test(t) && /価格/.test(t)) head = r;
    });
    if (!head) return null;
    /* 品番の列は、見出しの下で「品番の形をした文字」がいちばん多く並ぶ x。
       見出しの「部品形名」はマスのまん中寄せなので、列の幅が広い表では左寄せの品番から
       30以上離れ、品番が1つも見つからずに、品名を付け直さないままになっていた（83ページほか） */
    var xs = {};
    rows.forEach(function (r) {
      if (r.y >= head.y - 2) return;
      r.cells.forEach(function (c) {
        if (!carCodeHead(c.s)) return;
        var k = Math.round(c.x / 4) * 4;
        xs[k] = (xs[k] || 0) + 1;
      });
    });
    var xCode = null;
    Object.keys(xs).forEach(function (k) { if (xCode === null || xs[k] > xs[xCode]) xCode = k; });
    xCode = (xCode === null) ? null : Number(xCode);
    if (xCode === null) head.cells.forEach(function (c) { if (xCode === null && c.s.indexOf('部品形名') >= 0) xCode = c.x; });
    if (xCode === null) return null;
    var yOf = {}, codeYs = [];
    rows.forEach(function (r) {
      if (r.y >= head.y - 2) return;
      var code = carRowCode(r, xCode);
      if (!code) return;
      codeYs.push(r.y);
      if (!(code in yOf)) yOf[code] = r.y;
    });
    if (!codeYs.length) return null;
    var nameAt = carrierPartsNamer(rows, xCode - 15, head.y, codeYs);
    return function (code) {
      var y = yOf[code];
      if (y == null) {
        // 「RBC-US21PG（W）-1」のように後ろに付いた形でも引けるように
        Object.keys(yOf).forEach(function (k) { if (y == null && String(code).indexOf(k) === 0) y = yOf[k]; });
      }
      return y == null ? '' : nameAt(y);
    };
  }

  function optPageCarrierParts(items, page, out, ctx) {
    var rows = optRows(items);
    var head = null;
    rows.forEach(function (r) {
      if (head) return;
      var t = r.cells.map(function (o) { return o.s; }).join('');
      if (/部品形名/.test(t) && /価格/.test(t)) head = r;
    });
    if (!head) return;

    var type = (ctx && ctx.pageTypes) ? typeAtPage(ctx.pageTypes, page) : '';
    if (!type) return;

    var xCode = null, xPrice = null;
    head.cells.forEach(function (c) {
      if (xCode === null && c.s.indexOf('部品形名') >= 0) xCode = c.x;
      if (xPrice === null && c.s.indexOf('価格') >= 0) xPrice = c.x;
    });
    if (xCode === null) return;
    if (xPrice === null) xPrice = xCode + 45;

    // 品番のある行を先に集める（品名の読み方が、行どうしの並びを見るため）
    function partsCode(r) { return carRowCode(r, xCode); }
    var codeYs = [];
    rows.forEach(function (r) { if (r.y < head.y - 2 && partsCode(r)) codeYs.push(r.y); });
    var nameAt = carrierPartsNamer(rows, xCode - 15, head.y, codeYs);
    rows.forEach(function (r) {
      if (r.y >= head.y - 2) return;
      var code = partsCode(r), price = 0;
      r.cells.forEach(function (c) {
        var t = c.s.trim();
        if (!price && c.x >= xPrice - 20 && c.x < xPrice + 60) {
          var mm = t.match(/^[¥￥]?\s*([\d,]{4,})/);
          if (mm) price = yen(mm[1]);
        }
      });
      if (!code || !price) return;
      var nm = nameAt(r.y);
      if (!nm || nm.length < 2) return;
      out.push({ page: page, name: nm, code: code, y: price, fits: [{ type: type }] });
    });
  }

  function optPageCarrier(items, page, out) {
    var rows = optRows(items);

    // 見出し行（「部品形名」がある行）
    var head = null;
    rows.forEach(function (r) {
      if (head) return;
      var t = r.cells.map(function (o) { return o.s; }).join('');
      if (/部品形名/.test(t)) head = r;
    });
    if (!head) return;

    var xCode = null, xPrice = null;
    head.cells.forEach(function (c) {
      if (xCode === null && c.s.indexOf('部品形名') >= 0) xCode = c.x;
      if (c.s.indexOf('希望小売価格') >= 0) xPrice = c.x;
    });
    if (xCode === null) return;
    if (xPrice === null) xPrice = xCode + 70;

    // シリーズの列。見出しの上下3行ぶんの日本語を x でまとめる
    var band = {};
    rows.forEach(function (r) {
      if (Math.abs(r.y - head.y) > 16) return;
      r.cells.forEach(function (c) {
        if (c.x >= xCode - 20 || !isJa(c.s)) return;
        if (/別売部品|適用|能力ランク|希望小売|税別|部品形名|標準|オプション|価格|形名|注|※/.test(c.s)) return;
        var key = null;
        Object.keys(band).forEach(function (k) { if (key === null && Math.abs(Number(k) - c.x) < 30) key = k; });
        if (key === null) { band[c.x] = { x: c.x, s: c.s }; }
        else { band[key].s += c.s; band[key].x = Math.min(band[key].x, c.x); }
      });
    });
    /* 列の見出しは**シリーズ名**。キヤリアのシリーズは4つと決まっているので、
       それに合うものだけを列と認める。
       ゆるくすると注釈文（「音が大きく感じられる場合があります」など）を
       シリーズとして拾ってしまう。 */
    var known = [];
    Object.keys(CARRIER_SERIES).forEach(function (k) { known.push(CARRIER_SERIES[k]); });
    var cols = Object.keys(band).map(function (k) { return band[k]; })
      .map(function (b) {
        var raw = b.s.replace(/[®™\s]/g, '').replace(/［.*?］|\[.*?\]/g, '');
        var hit = '';
        known.forEach(function (s) { if (!hit && looseSame(s, raw)) hit = s; });
        return { x: b.x, series: hit };
      })
      .filter(function (b) { return b.series; })
      .sort(function (a, b) { return a.x - b.x; });
    if (!cols.length) return;

    var leftEnd = cols[0].x - 20;
    var codeYs = [];
    rows.forEach(function (r) {
      if (r.y >= head.y - 20) return;
      if (r.cells.some(function (c) {
        return c.x >= xCode - 25 && c.x < xPrice - 20 && carCodeHead(c.s);
      })) codeYs.push(r.y);
    });
    var nameAt = carrierOutdoorNamer(rows, leftEnd, head.y, codeYs);

    rows.forEach(function (r) {
      if (r.y >= head.y - 20) return;

      var code = '', price = 0;
      r.cells.forEach(function (c) {
        var s = c.s.trim();
        if (c.x >= xCode - 25 && c.x < xPrice - 20 && !code && carCodeHead(s)) code = carCodeHead(s);
        if (c.x >= xPrice - 30) { var m = s.match(OPT_MONEY); if (m && !price) price = yen(m[1]); }
      });
      if (!code || !price) return;

      // シリーズごとに、そのマスの能力ランクを読む
      var fits = [];
      cols.forEach(function (col, i) {
        var lo = col.x - 18;
        var hi = (i === cols.length - 1) ? xCode - 25 : cols[i + 1].x - 18;
        var txt = '', dash = false;
        r.cells.forEach(function (c) {
          if (c.x < lo || c.x >= hi) return;
          if (OPT_DASH.test(c.s.trim())) { dash = true; return; }
          txt += c.s;
        });
        if (dash || !txt) return;
        var cr = capRange(txt);
        if (cr) fits.push({ series: col.series, cap: cr });
      });
      if (!fits.length) return;

      out.push({ page: page, name: nameAt(r.y), code: code, y: price, fits: fits });
    });
  }

  /* --------------------------------------------------------------------
     日立の別売品（オプション一覧）
       ■ オプション一覧（ てんかせ 4方向）        ← ページの機種タイプ
       容量・型名（相当馬力）｜ 28型〜71型 ｜ 80型〜160型   ← 列＝容量の範囲
       品名 ｜ 基本パネル ｜ デザインパネル ｜ …
       高性能フィルター … F-71M-K3 24,300円 ｜ F-160M-K3 31,200円

     列の容量範囲は「本体の筐体サイズ」で決まっている（NotebookLM でも確認）。
     その列の品番は、その容量範囲の機種に付く。
     -------------------------------------------------------------------- */
  /* --------------------------------------------------------------------
     日立の別売品の品名（2026-09-11 作り直し）
     ----------------------------------------------------------------------
     前は nameReader（列ごとに、上下どちらでも近いものを採ってつなぐ）で読んでいて、
     201品目のほとんどの品名が崩れていた（「22注 NEW高湿度対応キット 分ダクトフランジ（φ ） 分ダクト 1m」）。
     キヤリアと同じ病気。となりの行の品名、左はしの縦書きの区分（補助・ダクト）、
     注記の番号がつながり、「φ150」の数字は値段と思って消していた。

     日立の表は、左から「区分（縦書き）」→「まとめ書き」→「品名」→「補足」の入れ子のマス。
       てんかせ4方向  F-71M-K3 ＝ ボックス方式 ＞ 抗菌加工高性能フィルター ＞ 比色法65%相当
       ビルトイン     FD-1A1   ＝ 吹き出し ＞ フレキシブルダクト（φ200） ＞ 分ダクト 1m
     読み方
       ・品番の行と同じ高さにある文字を左から読む
       ・いちばん右の文字より左で空いている欄は、そのすぐ右の欄で選んだ文字に
         いちばん近い、その欄のまとめ書きを受け継ぐ
       ・同じ欄で上下にくっついた2行（「ABS樹脂製」「グリル」）は1つのマス
       ・区分は縦書き（文字数のわりに幅がとても狭い）なので、それで落とす
     pdf.js は語を細かく割ってよこす（「ロ」「ングライ」「フ」「フ」「ィ」「ルター」）ので、
     確かめはブラウザと同じ pdf.js の文字でやった
     -------------------------------------------------------------------- */

  function hitClean(s) {
    return String(s || '')
      .replace(/[\u2000-\u200b\u3000]/g, ' ')
      .replace(/[（(]\s*注\s*[\d,\s]+[）)]/g, ' ')       // （注 12 ）
      .replace(/注\s*\d+/g, ' ')
      .replace(/※\s*\d*/g, ' ')
      .replace(/[（(［\[]\s*(受注対応品?|特注対応色?)\s*[）)］\]]/g, ' ')   // （受注対応品）［受注対応］
      .replace(/[［\[][^］\]]*寸法[^］\]]*[］\]]/g, ' ')                  // ［外形横寸法（mm）］は品名の下の注記
      .replace(/SEK|NEW|受注対応品?|特注対応色?|[★☆■●◆]/g, ' ')
      .replace(/[［\[]\s*[］\]]/g, ' ')
      .replace(/（\s+/g, '（').replace(/\s+）/g, '）')
      .replace(/［\s+/g, '［').replace(/\s+］/g, '］')
      .replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); })
      .replace(/[（(]\s*[）)]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // 日立の表の左はしの区分（縦書き）
  var CATEGORY_WORD = /^(補助|ダクト|フィルター|リモコン|グリル|その他)$/;
  var CATEGORY_HEAD = /^(補助|ダクト|フィルター|リモコン|グリル|その他)\s+/;

  function hitachiNamer(rows, nameRight, headY, endY, rowYs) {
    /* 高さは、行にそろえる前の本当の高さで測る。行のまとめ（optRows）は3ポイントまで寄せるので、
       88ページでは品番 678.5 の行が 681.0 になり、すぐ下の「脱臭フィルター」（674.8）が
       その品番の品名だと気づけなかった。呼ぶ側は行の高さ（rowYs）で名前を聞くので、対応を持っておく */
    var realOf = {};
    rowYs.forEach(function (ry) {
      var r = rows.filter(function (x) { return x.y === ry; })[0];
      var ys = r ? r.cells.filter(function (c) { return OPT_CODE.test(c.s.trim()); }).map(function (c) { return c.y; }) : [];
      realOf[ry] = ys.length ? ys.reduce(function (a, b) { return a + b; }, 0) / ys.length : ry;
    });
    var codeYs = rowYs.map(function (ry) { return realOf[ry]; });

    // その高さに近い品番の行（品名の文字は品番より5ポイントほどずれることがある）
    function codeYOf(y, tol) {
      var best = null, bd = tol;
      codeYs.forEach(function (c) { var d = Math.abs(c - y); if (d <= bd) { bd = d; best = c; } });
      return best;
    }
    var isLatin = function (t) { return /^[A-Z]{2,4}$/.test(t); };   // 「ABS」樹脂製グリル

    /* 注の番号「（注 11 ）」は、かたまりを作る前に抜いておく。
       品名とのすき間が狭いと1つにつながり、注を消した後もかたまりの左はしが注の位置のまま残る
       （60ページの「（注 11 ）ワイドパネル」が品名より左の欄になっていた）。
       ただし、注だけの行はマスの2行目（「抗菌加工高性能フィルター」の下の「（注1）（注2）」）なので、
       マスがどの行まで続くかを見るのに使う */
    var NOTE = /^[（(]?\s*注\s*[\d,\s]*[）)]?$/;
    var notes = [];
    var rows2 = rows.map(function (r) {
      return {
        y: r.y,
        cells: r.cells.filter(function (c) {
          if (!NOTE.test(c.s.replace(/\s/g, ''))) return true;
          if (c.x < nameRight && r.y < headY - 2 && r.y > endY) notes.push({ x: c.x, y: c.y });
          return false;
        })
      };
    });

    var segs = carSegs(rows2, nameRight, headY).filter(function (g) {
      if (g.y <= endY) return false;
      var raw = g.s.replace(/\s/g, '');
      /* 縦書き（区分・注記・ページのつまみ）は、文字数のわりに幅がとても狭い。
         横書きのかな・漢字は1文字あたり5.5ほど（小さい「ッ」が入ると4くらい）。2文字の縦書き「補助」は3.4だった */
      var ja = raw.replace(/[^ぁ-んァ-ヶー一-龥]/g, '');
      if (ja.length >= 2 && ja.length === raw.length && (g.right - g.x) / raw.length < 3.7) return false;
      if (raw.length >= 2 && (g.right - g.x) / raw.length < 3) return false;
      // 表の下の注記の文章（「「ロングライフフィルター」は化粧パネルに…」）と、見出しの語
      if (/[。「」]/.test(g.s)) return false;
      if (/^(品名|容量・型名|容量|型名)/.test(raw)) return false;
      g.t = hitClean(g.s);
      // 長さは注を消した後で見る（「空気清浄ユニット…（注28）（注30）」を文章と思って消していた）
      return g.t.length >= 2 && g.t.length <= 40 && (isJa(g.t) || isLatin(g.t));
    });
    segs.forEach(function (g) { g.y = g.oy; });

    /* 区分の語（「補助」）は、横書きの幅で来ることもある（96ページ）。
       品番の行に乗っている品名の、いちばん左より左にあるものは区分として落とす */
    var nameLeft = 1e9;
    segs.forEach(function (g) {
      if (!isLatin(g.t) && !CATEGORY_WORD.test(g.t) && codeYOf(g.y, 4) != null) nameLeft = Math.min(nameLeft, g.x);
    });
    if (nameLeft < 1e9) segs = segs.filter(function (g) { return g.x >= nameLeft - 5; });

    segs.forEach(function (g) {
      g.hasRight = segs.some(function (h) { return Math.abs(h.y - g.y) <= 4 && h.x > g.x + 8; });
    });

    // 欄（x でまとめる）。注は、すでにある欄にだけ入れる
    var cols = [];
    segs.forEach(function (g) {
      var c = null;
      cols.forEach(function (k) { if (!c && Math.abs(k.x - g.x) < 8) c = k; });
      if (!c) { c = { x: g.x, segs: [] }; cols.push(c); }
      c.segs.push(g);
    });
    cols.sort(function (a, b) { return a.x - b.x; });
    notes.forEach(function (n) {
      if (segs.some(function (g) { return Math.abs(g.y - n.y) <= 1 && g.x < n.x && g.right >= n.x - 8; })) return;
      var c = null;
      cols.forEach(function (k) { if (!c && Math.abs(k.x - n.x) < 8) c = k; });
      if (c) c.segs.push({ y: n.y, note: true });
    });

    /* 同じ欄で上下にくっついた2行は1つのマス（「化粧」「パネル用」）。
       品番の行どうし（「比色法65%」「比色法90%」）と、同じ文字のくり返しはつながない。
       ただし2行目がカタカナだけの切れはし（「抗菌加工高性能」＋「フィルター」）ならつなぐ。
       注だけの行は、文字は足さずにマスの下はしだけ延ばす */
    cols.forEach(function (c) {
      c.segs.sort(function (a, b) { return b.y - a.y; });
      var cells = [], cur = null;
      c.segs.forEach(function (g) {
        if (g.note) {
          if (cur && cur.lo - g.y <= 11 && cur.tlo - g.y <= 22) cur.lo = Math.min(cur.lo, g.y);
          return;
        }
        var cy = codeYOf(g.y, 2);
        var head = cur && cur.n === 1 && isLatin(cur.t);
        var frag = cur && /^[ァ-ヶー]{2,6}$/.test(g.t) && /[一-龥]$/.test(cur.t);
        var two = cur && cur.toy - g.oy <= 9.3 && cur.lastRight && g.hasRight;
        var nw = /^\s*NEW/.test(g.s);
        if (nw) cur = null;
        if (cur && !cur.nw && (cur.n < 2 || head) && cur.tlo - g.y <= 10 && (!(cur.code && cy != null) || frag || head || two) && cur.t.indexOf(g.t) < 0) {
          cur.t += (/用$/.test(cur.t) && /用$/.test(g.t) ? '・' : '') + g.t; cur.tlo = g.y; cur.toy = g.oy; cur.lo = Math.min(cur.lo, g.y); cur.lastRight = g.hasRight;
          cur.right = Math.max(cur.right, g.right);
          if (!head) cur.n++;
          if (cy != null) cur.code = true;
        } else {
          cur = { t: g.t, hi: g.y, tlo: g.y, toy: g.oy, lo: g.y, n: 1, code: cy != null, right: g.right, lastRight: g.hasRight, nw: nw };
          cells.push(cur);
        }
      });
      c.cells = cells.filter(function (cell) { return !isLatin(cell.t); });
    });

    /* その品番自身の品名のマス（品番の行にあって、右に何も続かない）＝「葉」。
       品番の行とは7ポイントまでずれてよい（「側面カバー」は4.9、「交換用フィルター（ろ材）」は6.3ずれている）。
       その品番の行のすぐそば（7以内）に、自分の文字が1つも無い品番の行があるときは、葉にしない。
       1つのマスに品番が2段で書いてある（「BPD-7WB+BPD-4WB」と「BPD-7WB」が6.3離れている）ところで、
       まとめ書きの「分ダクト部材」「ブラック」を、その行の品名と取り違えていた（51ページ） */
    cols.forEach(function (c) {
      c.cells.forEach(function (cell) {
        var cy = codeYOf(cell.hi, 7);
        if (cy == null) cy = codeYOf(cell.tlo, 7);
        cell.codeY = cy;
        cell.leaf = cy != null &&
          !codeYs.some(function (y2) {
            return y2 !== cy && Math.abs(y2 - cy) <= 7 && !segs.some(function (g) { return Math.abs(g.y - y2) <= 4; });
          }) &&
          !segs.some(function (g) {
            return g.x > c.x + 8 && g.y <= Math.max(cy, cell.hi) + 4 && g.y >= Math.min(cy, cell.tlo) - 4;
          });
        cell.mid = (cell.hi + cell.lo) / 2;
      });
    });

    function dist(cell, y) {
      if (y <= cell.hi && y >= cell.lo) return 0;
      return Math.min(Math.abs(y - cell.hi), Math.abs(y - cell.lo));
    }

    /* ここから、まとめ書きの割り当て（2026-09-11 作り直し）
       ----------------------------------------------------------------------
       前は「近いまとめ書きを受け継ぐ」だった。まとめ書きは何行ぶんものマスのまん中に
       書いてあるので、上の品物の名前のほうが近いことがある（51ページの
       「分ダクトフランジ」に、すぐ上の「高湿度対応キット」が付いていた）。
       いまは欄ごとに、左の欄から順に
         ・その行に自分の文字がある → それを採る。葉ならそこで区切り
         ・左で採った文字が、この欄の位置まで横に伸びている → この欄は空（区切り）
         ・その行の品名がこの欄より左で終わっている → 区切り
         ・それ以外 → 区切りと区切りの間の行を、間にあるまとめ書きに分ける。
           まとめ書きはマスのまん中にあるので、「分けた行のまん中」と
           「まとめ書きの高さ」がいちばん合う分け方を選ぶ（80ページの紙面で確かめた。
           「吹き出し」は角ダクトフランジの2行目から分ダクト 5m までのまん中にある）
       まとめ書きが無い区切りの間は、すぐ上の葉を受け継ぐ（上寄せのマス。
       「オイルガードフィルター」＞「交換用フィルター（ろ材）」、「ブラック」の2段目） */
    var R = rowYs.slice().sort(function (a, b) { return realOf[b] - realOf[a]; }).map(function (key) {
      var y = realOf[key];
      var own = cols.map(function (c) {
        var best = null, bd = 1e9;
        c.cells.forEach(function (cell) {
          var d = cell.codeY === y ? 0 : dist(cell, y);
          if (d <= 4 && d < bd) { bd = d; best = cell; }
        });
        return best;
      });
      var last = -1;
      own.forEach(function (o, ci) { if (o && o.leaf) last = ci; });
      return { y: y, key: key, own: own, last: last < 0 ? cols.length : last, pick: [], right: -1e9 };
    });

    function split(run, labels) {
      // run の行を labels（上から順）に、上から続けて分ける。空のまとめ書きは 8 の罰
      var n = run.length, k = labels.length, INF = 1e12;
      var f = [], from = [];
      for (var i = 0; i <= n; i++) { f.push([]); from.push([]); for (var j = 0; j <= k; j++) { f[i].push(INF); from[i].push(-1); } }
      f[0][0] = 0;
      function cost(a, b, L) {           // 行 a..b-1 を L に
        var sum = 0, bad = 0;
        for (var t = a; t < b; t++) { sum += run[t].y; if (run[t].lab && run[t].lab !== L) bad++; }
        return Math.abs(sum / (b - a) - L.mid) + bad * 1000;
      }
      for (var j2 = 1; j2 <= k; j2++) {
        for (var i2 = 0; i2 <= n; i2++) {
          if (f[i2][j2 - 1] + 8 < f[i2][j2]) { f[i2][j2] = f[i2][j2 - 1] + 8; from[i2][j2] = i2; }
          for (var p = 0; p < i2; p++) {
            if (f[p][j2 - 1] >= INF) continue;
            var v = f[p][j2 - 1] + cost(p, i2, labels[j2 - 1]);
            if (v < f[i2][j2]) { f[i2][j2] = v; from[i2][j2] = p; }
          }
        }
      }
      var out = [], i3 = n;
      for (var j3 = k; j3 >= 1; j3--) {
        var p3 = from[i3][j3];
        for (var t = p3; t < i3; t++) out[t] = labels[j3 - 1];
        i3 = p3;
      }
      return out;
    }

    cols.forEach(function (c, ci) {
      var st = R.map(function (r) {
        var o = r.own[ci];
        if (o) { r.pick[ci] = o; r.right = Math.max(r.right, o.right); return o.leaf ? 'bar' : 'lab'; }
        if (ci > r.last || r.right >= c.x - 2) return 'bar';
        return 'free';
      });
      var i = 0;
      while (i < R.length) {
        if (st[i] === 'bar') { i++; continue; }
        var a = i;
        while (i < R.length && st[i] !== 'bar') i++;
        var yA = a > 0 ? R[a - 1].y : 1e9, yB = i < R.length ? R[i].y : -1e9;
        var run = [];
        for (var t = a; t < i; t++) run.push({ y: R[t].y, lab: st[t] === 'lab' ? R[t].own[ci] : null, r: R[t] });
        var labels = c.cells.filter(function (cell) { return !cell.leaf && cell.mid < yA && cell.mid > yB; })
          .sort(function (p, q) { return q.mid - p.mid; });
        if (labels.length) {
          var got = split(run, labels);
          run.forEach(function (x, t2) {
            if (x.lab || !got[t2]) return;
            x.r.pick[ci] = got[t2]; x.r.right = Math.max(x.r.right, got[t2].right);
          });
        } else if (a > 0) {
          var up = R[a - 1].own[ci];
          if (up && up.leaf) run.forEach(function (x) {
            if (up.lo - x.y <= 20) { x.r.pick[ci] = up; x.r.right = Math.max(x.r.right, up.right); }
          });
        }
      }
    });

    var names = {};
    R.forEach(function (r) {
      var parts = [];
      r.pick.forEach(function (p) { if (p && parts.indexOf(p.t) < 0) parts.push(p.t); });
      names[r.key] = parts.join(' ').replace(CATEGORY_HEAD, '');
    });
    return function (y) { return names[y] || ''; };
  }

  function optPageHitachi(items, page, out) {
    var rows = optRows(items);

    var type = '', titleY = 0;
    rows.forEach(function (r) {
      if (type) return;
      var t = r.cells.map(function (o) { return o.s; }).join('').replace(/\s/g, '');
      var m = t.match(/オプション一覧[（(]([^）)]{2,20})[）)]/);
      if (m) { type = m[1]; titleY = r.y; }
    });
    if (!type) return;

    /* 列の見出し（容量の並び）は、「■ オプション一覧（…）」の**すぐ下**にある。

       ここを間違えていた。前は
       ・ページの中でいちばん最初の「容量・型名」の行を見出しにしていた
       ・「容量・型名（相当馬力）」だけが1行に置かれ、容量は次の行にあるページを読めなかった
       この2つで、10タイプ中6タイプがまるごと落ちていた
       （2026-09-09、BIGBOSSの「天吊型にもでないぞ」で分かった。
         てんかせ1方向のページは、先に「化粧パネル」の表が載っている） */
    /* 見出しの容量は**3行に割れていることがある**（てんうめのページ）。

         22型（0.8）〜        45型（1.8）〜
       品名                63型（2.5）〜90型（3.3）  112型（4.0）〜…
         40型（1.5）          56型（2.3）

       なので「見出しの行を1つ選ぶ」のではなく、
       見出しの帯にある容量の字をぜんぶ集めて、x（横の位置）でまとめる。
       「40型（1.5）」の形に書いてあるものだけを容量と見なす。数字だけで見ると
       「20,000円」の20や「F-160LB1」の160まで容量に見えてしまう。 */
    var hcells = [];
    rows.forEach(function (r) {
      if (r.y >= titleY || r.y < titleY - 40) return;
      r.cells.forEach(function (c) {
        if (/\d{2,3}\s*[型形]/.test(c.s) && capRange(c.s)) hcells.push(c);
      });
    });
    if (!hcells.length) return;
    var headY = 1e9;
    hcells.forEach(function (c) { if (c.y < headY) headY = c.y; });
    var head = { y: headY };

    // 表の終わりは、見出しより下にある次の「■」（次の節の始まり）
    var endY = -1e9;
    rows.forEach(function (r) {
      if (r.y >= head.y) return;
      var t = r.cells.map(function (o) { return o.s; }).join('').trim();
      if (t.charAt(0) === '■' && r.y > endY) endY = r.y;
    });

    // 集めた容量の字を x でまとめて、列（容量の範囲）にする
    hcells.sort(function (a, b) { return a.x - b.x || b.y - a.y; });
    var cols = [], cur = null;
    hcells.forEach(function (c) {
      if (!cur || c.x - cur.x > 30) { cur = { x: c.x, right: c.x, s: c.s }; cols.push(cur); }
      else { cur.s += c.s; cur.right = Math.max(cur.right, c.x); }
    });
    cols = cols.map(function (c) { return { x: c.x, cap: capRange(c.s) }; })
      .filter(function (c) { return c.cap; });
    if (!cols.length) return;

    // 品番のある行（品名の読み方が、行どうしの並びを見るため）
    var codeYs = [];
    rows.forEach(function (r) {
      if (r.y >= head.y - 2 || r.y <= endY) return;
      if (r.cells.some(function (c) { return OPT_CODE.test(c.s.trim()); })) codeYs.push(r.y);
    });
    var nameAt = hitachiNamer(rows, cols[0].x - 20, head.y, endY, codeYs);

    // 表ぜんぶにかかる容量（1行に品番が1つだけのときに使う）
    var wide = [1e9, 0];
    cols.forEach(function (k) {
      if (k.cap[0] < wide[0]) wide[0] = k.cap[0];
      if (k.cap[1] > wide[1]) wide[1] = k.cap[1];
    });

    rows.forEach(function (r) {
      if (r.y >= head.y - 2 || r.y <= endY) return;
      var name = nameAt(r.y);

      /* リモコンやドレンアップメカのように、**容量に関係なく1つだけ**の品番は、
         マスを何列もまたいで真ん中あたりに書かれている。
         前はいちばん近い列に押し込んでいたので、
         「かべかけ4馬力に多機能デザインリモコンが出ない」ことになっていた
         （2026-09-09、BIGBOSSの指摘で分かった）。1行に品番が1つなら表ぜんぶに付くとみなす */
      var nCode = 0;
      r.cells.forEach(function (c) { if (OPT_CODE.test(c.s.trim())) nCode++; });

      r.cells.forEach(function (o, i) {
        var s = o.s.trim();
        if (!OPT_CODE.test(s)) return;
        var price = optPriceRightOrBelow(rows, r, i, o);
        if (!price) return;
        // どの列かは**金額の位置**で決める。品番は長さがまちまちで、
        // 長い品番ほどマスの中で左に伸び、1つ左の列に取られてしまう
        // （2026-09-09、F-112LPK2-AGV が50〜63型の列に入っていた）
        var atX = price.x;
        var cap = wide;
        if (nCode > 1) {
          var col = null, bd = 1e9;
          cols.forEach(function (k) { var d = Math.abs(k.x - atX); if (d < bd) { bd = d; col = k; } });
          if (!col || bd > 110) return;
          cap = col.cap;
        }
        out.push({ page: page, name: name, code: s, y: price.y, fits: [{ type: type, cap: cap }] });
      });
    });
  }

  /* --------------------------------------------------------------------
     三菱電機の別売品
     ほかの4社と違い、**別売品だけの表が無い**。
     セット価格のページに、その機種の構成品として書かれている。

       1方向天井カセット形                    ← ページの機種タイプ
       P40形（1.5馬力） ｜ P45形 ｜ P50形 ｜ P56形   ← 4段組み
       セット価格 1,064,000円
       室内：PM-RP40FA22 352,000円
       室外：PUZ-ERMP40SKA16 599,000円
       ワイヤードリモコン：PAR-48MA 60,000円
       ムーブアイセンサーパネル：PMP-P80FWF11 53,000円   ← これが別売品

     「◯◯：品番 金額円」の形なので、ラベルがそのまま品名になる。
     室内機・室外機は本体なので別売品には入れない。
     -------------------------------------------------------------------- */
  function optPageMitsu(items, page, out) {
    var rows = optRows(items);

    // ページの機種タイプ（いちばん上の日本語）
    var type = '';
    var top = rows.slice(0, 3);
    top.forEach(function (r) {
      r.cells.forEach(function (c) {
        if (!type && isJa(c.s) && /形$/.test(c.s.trim()) && c.s.length >= 4) type = c.s.trim();
      });
    });
    if (!type) return;

    // 「セット価格」の x で段を割る
    var xs = [];
    items.forEach(function (i) { if (/セット/.test(i.s)) xs.push(i.x); });
    if (xs.length < 2) return;
    xs.sort(function (a, b) { return a - b; });
    var st = [];
    xs.forEach(function (x) { if (!st.length || x - st[st.length - 1] > 60) st.push(x); });

    st.forEach(function (s, i) {
      var lo = s - 62;
      var hi = (i === st.length - 1) ? 1e9 : st[i + 1] - 62;

      // その段の容量（P40形 など）
      var cap = 0;
      rows.forEach(function (r) {
        if (cap) return;
        var t = r.cells.filter(function (c) { return c.x >= lo && c.x < hi; })
          .map(function (c) { return c.s; }).join('');
        var m = t.match(/P(\d{2,3})\s*形/);
        if (m) cap = Number(m[1]);
      });
      if (!cap) return;

      rows.forEach(function (r) {
        // **文字をつなげない。** つなげると「PLP-P160HWF」＋「74,000」が
        // 「PLP-P160HWF7」＋「4,000」に化ける（ダイキンで踏んだのと同じ落とし穴）
        var cells = r.cells.filter(function (c) { return c.x >= lo && c.x < hi; });
        // 別売品の行は必ず「ラベル：品番 金額円」の形。
        // 「：」が無い行を通すと、室外機の品番の切れ端（KA16 など）を拾ってしまう
        var hasColon = false;
        cells.forEach(function (c) { if (/[：:]/.test(c.s)) hasColon = true; });
        if (!hasColon) return;

        // 三菱の別売品の品番は必ず「英字3〜4文字＋ハイフン」で始まる（25種すべてで確認）。
        // ハイフンを求めないと、室外機の品番の切れ端（KA16 など）を拾う
        var MITSU_CODE = /^[A-Z]{2,4}-[A-Z0-9]{3,}$/;
        var parts = [], code = '', price = 0;
        cells.forEach(function (c) {
          var s = c.s.trim();
          if (!code) {
            if (MITSU_CODE.test(s)) { code = s; return; }
            if (isJa(s)) parts.push(s);
            return;
          }
          if (!price) {
            var m = s.match(OPT_MONEY);
            if (m) price = yen(m[1]);
          }
        });
        /* 品名になる文字だけ残す。
           ・1文字だけのかけら … 段の左端に縦に並んだページの見出し。
             これを入れていたので「ワイヤードリモコン」が「ネワイヤードリモコン」になっていた
           ・数字の入ったもの … となりの段の金額。
             「21,000円ワイヤレスリモコン」になっていた
           （2026-09-09、BIGBOSSが画面を見て気づかせてくれた） */
        var label = parts.filter(function (t) {
          return t.length >= 2 && !/[0-9０-９]/.test(t);
        }).join('');
        label = label.replace(/[：:].*$/, '').replace(/\s/g, '');
        if (!code || !price || label.length < 2) return;
        if (/室内|室外|セット価格|合計/.test(label)) return;   // 本体は別売品ではない
        out.push({
          page: page, name: label, code: code, y: price,
          fits: [{ type: type, cap: [cap, cap] }]
        });
      });
    });
  }

  /* --------------------------------------------------------------------
     三菱電機の共通別売部品（分配管など・カタログ144ページ）

       共通別売部品オプション
       分配管（マルチディストリビュータ）
       ■同時ツイン用（適応機種：P80〜P280形）
       形名   SDD-50SR9    SDD-50WR9
       価格   22,000円     27,000円
       ＊SDD-50SR9（P80〜P160形用）・SDD-50WR9（P224・P280形用）

     **縦並びの表**（形名の行と価格の行が別）なので、x で対応づける。
     どの台数用か（同時ツイン／トリプル／フォー）は「■◯◯用」の見出しから、
     容量は注釈の「（P80〜P160形用）」から取る。
     分配管は同時マルチのときに必ず要る（BIGBOSS 2026-09-05 確認）。
     -------------------------------------------------------------------- */
  /* --------------------------------------------------------------------
     三菱の「オプション構成図」のページ（p.132〜142）

       室内ユニット　オプション
       4方向天井カセット形〈i-スクエアタイプ〉
       部品名                          形　名          価格
       ムーブアイセンサーパネル          PLP-P160HWF     74,000円

     **これが三菱でいちばん品数の多い別売品の表**。
     前はセット価格ページの構成品しか読んでいなかったので、
     いちばん台数の多い「4方向天井カセット形」のパネルが1つも入っていなかった
     （2026-09-09、361機種／1,097機種）。
     -------------------------------------------------------------------- */
  function optPageMitsuList(items, page, out) {
    var rows = optRows(items);
    if (rows.length < 6) return;

    // 上のほうに「オプション」と「部品名」が両方あるページだけ
    var top = rows.slice(0, 8).map(function (r) { return r.cells.map(function (c) { return c.s; }).join(''); }).join('');
    if (top.indexOf('オプション') < 0) return;
    var all = rows.map(function (r) { return r.cells.map(function (c) { return c.s; }).join(''); }).join('');
    if (all.indexOf('部品名') < 0) return;

    /* 室内機のタイプ。「4方向天井カセット形〈i-スクエアタイプ〉」のように
       〈〉の中がタイプ名のこともあれば、〈PL-RP・LA22〉のように品番のこともある。
       品番のほうは捨てる（機種データのタイプ名は品番を持っていない） */
    /* 1ページに表が2つ3つ載っていることがある。
       142ページは「壁掛形」「床置形」「厨房用天吊形」の3つが縦に並ぶ。
       前は最初に見つけた1つ（壁掛形）をページ全体に付けていたので、
       床置形の14機種には別売品が1つも出なかった（2026-09-09） */
    var heads = [];
    rows.forEach(function (r) {
      r.cells.forEach(function (c) {
        var t = c.s.trim();
        if (!/形[〈（(]|形$/.test(t)) return;
        if (!/カセット|天吊|壁掛|床置|ビルトイン|埋込|厨房/.test(t)) return;
        if (!/タイプ/.test(t)) t = t.replace(/[〈（(].*$/, '');
        heads.push({ y: r.y, type: t });
      });
    });
    if (!heads.length) return;
    heads.sort(function (a, b) { return b.y - a.y; });   // 紙面の上から順
    var headY = heads[0].y;

    /** その行がどの見出しの下にあるか（y は下から上なので、行より大きいいちばん近い見出し） */
    function typeAt(y) {
      var best = '', bd = 1e9;
      heads.forEach(function (h) {
        var d = h.y - y;
        if (d <= 0 || d >= bd) return;
        bd = d; best = h.type;
      });
      return best;
    }

    // 品名はいちばん左の列。形名と価格はその右
    var nameEnd = 250;
    rows.forEach(function (r) {
      if (r.y >= headY) return;
      var name = [], code = '', price = 0, at = -1;
      r.cells.forEach(function (c, i) {
        var t = c.s.trim();
        if (c.x < nameEnd && !/^[0-9]/.test(t)) { name.push(t); return; }
        if (!code) {
          var m = t.match(/^([A-Z][A-Z0-9]*-[A-Z0-9\-]{2,})/);
          if (m) { code = m[1]; at = i; return; }
        }
        if (code && !price && i > at) {
          var mm = t.match(OPT_MONEY);
          if (mm) price = yen(mm[1]);
        }
      });
      if (!code || !price) return;
      /* 1文字だけのかけら（縦書きの見出しの1文字）と、
         品名の列に入り込んだ品番は品名ではない */
      var nm = name.filter(function (t) {
        return t.length >= 2 && !/^[A-Z][A-Z0-9]*-[A-Z0-9\-]{2,}$/.test(t);
      }).join(' ')
        .replace(/[①-⓿]/g, ' ')          // 丸数字（①②③…）は品名ではない
        .replace(/[※注][\d,\s]*/g, ' ')
        .replace(/\s+/g, ' ').trim();
      if (nm.length < 2) return;
      var type = typeAt(r.y);
      if (!type) return;
      out.push({ page: page, name: nm, code: code, y: price, fits: [{ type: type }] });
    });
  }

  function optPageMitsuCommon(items, page, out) {
    var rows = optRows(items);
    var flat = items.map(function (o) { return o.s; }).join('').replace(/\s/g, '');
    if (flat.indexOf('共通別売部品') < 0) return;

    // 「＊SDD-50SR9（P80〜P160形用）」のような注釈から、品番ごとの容量を拾う
    var capOf = {};
    var re = /([A-Z]{2,4}-[A-Z0-9]{3,})\s*[（(]\s*P?(\d{2,3})\s*[形型]?\s*[～~〜・]\s*P?(\d{2,3})?\s*[形型]/g, m;
    var joined = items.map(function (o) { return o.s; }).join('');
    while ((m = re.exec(joined)) !== null) {
      capOf[m[1]] = [Number(m[2]), Number(m[3] || m[2])];
    }

    var tp = '';
    rows.forEach(function (r) {
      var t = r.cells.map(function (c) { return c.s; }).join('').replace(/\s/g, '');

      // 「■同時ツイン用（適応機種：P80〜P280形）」で、ここから下の表の台数が決まる
      var h = t.match(/[■●]?(同時[ツトリプルフォーン]{2,6})用/);
      if (h) tp = h[1];

      // 「形名」で始まる行の品番を拾い、次の「価格」の行と x で突き合わせる
      if (!/^形\s*名/.test(t.replace(/\s/g, '形名').slice(0, 4)) && t.indexOf('形名') !== 0) return;
      var codes = r.cells.filter(function (c) { return /^[A-Z]{2,4}-[A-Z0-9]{3,}$/.test(c.s.trim()); });
      if (!codes.length) return;

      // すぐ下の「価格」の行
      var idx = rows.indexOf(r), price = null;
      for (var k = idx + 1; k < Math.min(rows.length, idx + 4); k++) {
        var tt = rows[k].cells.map(function (c) { return c.s; }).join('');
        if (tt.indexOf('価') >= 0 && /[\d,]{5,}/.test(tt)) { price = rows[k]; break; }
      }
      if (!price) return;

      codes.forEach(function (c) {
        var best = null, bd = 1e9;
        price.cells.forEach(function (pc) {
          if (!OPT_MONEY.test(pc.s.trim())) return;
          var d = Math.abs(pc.x - c.x);
          if (d < bd) { bd = d; best = pc; }
        });
        // 同じ列（真下）の金額だけを採る。ゆるくすると隣の表の金額を拾う
        if (!best || bd > 40) return;
        var code = c.s.trim();
        var fit = { tp: tp || '同時ツイン' };
        if (capOf[code]) fit.cap = capOf[code];
        out.push({ page: page, name: '分配管（マルチディストリビュータ）', code: code, y: yen(best.s), fits: [fit] });
      });
    });
  }

  /* --------------------------------------------------------------------
     ダイキンの「縦並び」の表（吹出ユニットなど・204〜206ページ）

       品名        ｜ 2.5〜4.0 ｜ 4.0〜6.0 ｜ …      ← 列＝推奨風量
       フレッシュホワイト ｜ K-DGS4EFF ｜ K-DGS5EFF ｜ …
       ホワイト        ｜ K-DGS4EWW ｜ K-DGS5EWW ｜ …   ← 色ちがいで品番が5行
       接続ダクト径     ｜ φ150 ｜ φ150 ｜ …
       価格          ｜ 31,700円 ｜ 35,700円 ｜ …      ← 価格は1行だけ

     **同じ列の品番は全部同じ価格**。行の中に金額が無いので、
     ふつうの読み方では1件も取れない（292件を取りこぼしていた）。
     「価格」の行を見つけて、その上の品番の行と x で突き合わせる。

     2026-09-05、私は「このページには価格が載っていない」と判断した。
     LMに聞いたら「載っている」と返ってきて、間違いに気づいた。
     -------------------------------------------------------------------- */
  function optPageDaikinVert(items, page, out) {
    var rows = optRows(items);

    // 品名が品番と同じ行に無いことがある（表のマスが縦につながっているため）。
    // 品番の左端より左を品名の場所として、共通の道具で組み立てる
    var minCodeX = 1e9;
    rows.forEach(function (r) {
      r.cells.forEach(function (c) {
        if (OPT_CODE.test(c.s.trim()) && c.x < minCodeX) minCodeX = c.x;
      });
    });
    var nameAt = (minCodeX < 1e9) ? nameReader(rows, minCodeX - 20, 1e9, 'vert') : null;

    rows.forEach(function (r, idx) {
      var t = r.cells.map(function (c) { return c.s; }).join('').replace(/\s/g, '');
      if (t.indexOf('価格') !== 0) return;
      var prices = r.cells.filter(function (c) { return OPT_MONEY.test(c.s.trim()); });
      if (prices.length < 2) return;

      // その上にある品番の行をさかのぼって集める（色ちがいで何行もある）
      for (var k = idx - 1; k >= 0 && k >= idx - 8; k--) {
        var codes = rows[k].cells.filter(function (c) { return OPT_CODE.test(c.s.trim()); });
        if (!codes.length) continue;
        var left = codes[0].x - 20;
        var name = rows[k].cells.filter(function (c) { return c.x < left && isJa(c.s); })
          .map(function (c) { return c.s; }).join('').replace(/注\d+/g, '').trim();
        /* 「ホワイト」「ブラウン」だけの行は、色であって品名ではない。
           品名は上の行（縦につながったマス）にあるので、上下から拾い直す */
        var colorOnly = /^[（(]?(フレッシュ)?(ホワイト|ブラック|ブラウン|ベージュ|グレー|シルバー|アイボリー|ホワイ|ブラ)[）)]?(（単色）)?$/;
        if ((name.length < 2 || colorOnly.test(name.replace(/\s/g, ''))) && nameAt) {
          var n2 = nameAt(rows[k].y);
          if (n2 && n2.length > name.length) name = n2;
        }

        codes.forEach(function (c) {
          var best = null, bd = 1e9;
          prices.forEach(function (p) { var d = Math.abs(p.x - c.x); if (d < bd) { bd = d; best = p; } });
          if (!best || bd > 60) return;
          out.push({
            page: page, name: name, code: c.s.trim(), y: yen(best.s),
            fits: [{ all: true }]     // 吹出ユニットは風量で選ぶ共通部材（機種を選ばない）
          });
        });
      }
    });
  }

  /* --------------------------------------------------------------------
     三菱電機の室外ユニットオプション（143ページ前後）

       室外ユニット オプション
       形名 ｜ スリムZR ｜ ズバ暖スリム            ← 大きい区分（シリーズ）
            ｜ P28〜P63形 ｜ P80形 ｜ P112〜P160形 …  ← その下が容量
       部品名
       エアガイド ｜ PAC-SJ06AG 24,000円 ｜ PAC-SJ03AG 24,000円 ｜ …

     室外機に付くものなので、室内機のタイプでは決まらない。
     **シリーズと室外機の容量**で決まる（NotebookLM でも確認。スリムERにも付く）。
     -------------------------------------------------------------------- */
  function optPageMitsuOutdoor(items, page, out) {
    var flat = items.map(function (o) { return o.s; }).join('').replace(/\s/g, '');
    if (flat.indexOf('室外ユニット') < 0 || flat.indexOf('オプション') < 0) return;
    if (flat.indexOf('共通別売部品') >= 0) return;   // 分配管のページは別で読む

    var rows = optRows(items);
    var head = null;
    rows.forEach(function (r) {
      if (head) return;
      r.cells.forEach(function (c) { if (!head && c.s.indexOf('部品名') >= 0) head = r; });
    });
    if (!head) return;

    // 見出しの上（＝y が大きい）から、容量の列を拾う。
    // 「P224」「・」「P280形」のようにマスが割れるので、隣どうしはつなげる
    var caps = [];
    rows.forEach(function (r) {
      if (r.y <= head.y) return;
      var cur = null;
      r.cells.forEach(function (c) {
        var s = c.s.replace(/\s/g, '');
        if (/^[P\d～~〜・、,形型]+$/.test(s) && /\d/.test(s)) {
          if (cur && c.x - cur.right < 30) { cur.s += s; cur.right = c.x + (c.w || 10); }
          else { cur = { x: c.x, right: c.x + (c.w || 10), s: s }; caps.push(cur); }
        } else cur = null;
      });
    });
    var cols = caps.map(function (c) { return { x: c.x, cap: capRange(c.s) }; })
      .filter(function (c) { return c.cap; })
      .sort(function (a, b) { return a.x - b.x; });
    if (!cols.length) return;

    // シリーズの区分（大きい見出し）
    var sers = [];
    rows.forEach(function (r) {
      if (r.y <= head.y) return;
      r.cells.forEach(function (c) {
        var s = c.s.replace(/\s/g, '');
        if (/スリムZR|ズバ暖スリム|スリムER/.test(s)) sers.push({ x: c.x, s: s });
      });
    });
    sers.sort(function (a, b) { return a.x - b.x; });

    var nameAt = nameReader(rows, cols[0].x - 20, head.y + 1);

    rows.forEach(function (r) {
      if (r.y >= head.y) return;
      var name = nameAt(r.y);

      r.cells.forEach(function (o, i) {
        var s = o.s.trim();
        if (!/^[A-Z]{2,4}-[A-Z0-9]{3,}$/.test(s)) return;
        var price = 0;
        for (var j = i + 1; j < r.cells.length; j++) {
          var t = r.cells[j].s.trim();
          if (/^[A-Z]{2,4}-[A-Z0-9]{3,}$/.test(t)) break;
          var mm = t.match(OPT_MONEY);
          if (mm) { price = yen(mm[1]); break; }
        }
        if (!price) return;

        var col = null, bd = 1e9;
        cols.forEach(function (k) { var d = Math.abs(k.x - o.x); if (d < bd) { bd = d; col = k; } });
        if (!col || bd > 70) return;

        // その品番より左にある、いちばん近いシリーズ見出し
        var ser = '';
        sers.forEach(function (k) { if (k.x <= o.x + 40) ser = k.s; });

        var fit = { cap: col.cap };
        if (ser) fit.series = ser;
        out.push({ page: page, name: name, code: s, y: price, fits: [fit] });
      });
    });
  }

  /** 同じ品番をまとめ、付く機種を足し合わせる */
  function optFinish(list) {
    var map = {}, order = [];
    list.forEach(function (o) {
      if (!map[o.code]) { map[o.code] = { code: o.code, name: o.name, y: o.y, fits: [] }; order.push(o.code); }
      var v = map[o.code];
      if (!v.name && o.name) v.name = o.name;
      o.fits.forEach(function (f) {
        var key = JSON.stringify(f), dup = false;
        v.fits.forEach(function (g) { if (JSON.stringify(g) === key) dup = true; });
        if (!dup) v.fits.push(f);
      });
    });
    return order.map(function (c) { return map[c]; });
  }

  /** 別売品の読み取り結果を、空調王に渡す形にそろえる */
  function optResult(list, maker, brand) {
    return {
      rows: optFinish(list),
      pricePages: 0,
      head: {
        maker: maker,
        brand: brand,
        note: '希望小売価格・税抜。社内利用限定（第三者提供不可）。'
      }
    };
  }

  /* --------------------------------------------------------------------
     データファイル（.json）を読む
     -------------------------------------------------------------------- */
  function readJsonFile(file) {
    return file.text().then(function (t) {
      var data = null;
      try { data = JSON.parse(t); } catch (e) {
        throw new Error('データファイルとして読めませんでした。\n' +
                        'ページを「名前を付けて保存」で保存し直してから、もう一度選んでください。');
      }
      var list = Array.isArray(data) ? data : null;
      if (!list && data && typeof data === 'object') {
        // 入れ物の中に一覧が入っている形も受ける
        Object.keys(data).forEach(function (k) {
          if (!list && Array.isArray(data[k]) && data[k].length > 50) list = data[k];
        });
      }
      if (!list || !list.length) {
        throw new Error('中身が空でした。ファイルが途中までしか保存されていないかもしれません。');
      }
      return list;
    });
  }

  /* --------------------------------------------------------------------
     メーカーの一覧
     min＝これを下回ったら「読めていない」とみなす件数。
     2026-09-04 の実績（キヤリア870件・日立626件・パナ946件）の8割を目安にしてある。
     -------------------------------------------------------------------- */
  // パナソニックの室内機タイプ（機種データの呼び方にそろえてある）
  var PANA_TYPES = [
    '天吊形厨房用エアコン（高温吸込み対応）', '高温吸込み天吊形厨房用エアコン', '天吊形厨房用エアコン',
    '高天井用1方向カセット形', 'ビルトインオールダクト形', '天井ビルトインカセット形',
    '4方向天井カセット形', '2方向天井カセット形', '1方向天井カセット形',
    '天井吊形', '壁掛形', '床置形', '天井埋込形'
  ];

  /* ======================================================================
     材料メーカー（部材）
     ----------------------------------------------------------------------
     機器の5社とは入れ物が違う。読み取った中身は機種データでも別売品でもなく、
     **単価マスタの行**になる。だから run() は kind:'parts' のときだけ
     { parts: … } を返し、app.js 側でCSVと同じ道に流し込む。
     ====================================================================== */

  /* --------------------------------------------------------------------
     因幡電工
     ----------------------------------------------------------------------
     読むのは総合カタログではなく「価格改定表」。
     総合カタログは1,000ページ近くあって値段が紙面の絵の中に散っているが、
     価格改定表は品番と値段だけが並んだ表で、値上げのたびに必ず出る。
     しかも2種類とも公式サイトから直にPDFで落とせる。

     紙面は2段組。左の帯と右の帯を、別々に上から読む。

       ● スリムダクトＬＤ           ← シリーズ（分類になる）
       ・ウォールコーナー             ← 品名
       コード 型番 新標準単価 掲載      ← 見出し
       2302  LDW-70  ¥920  P 6      ← ここが1行

     **同じ行でも y が 0.1 ずれることがある。**行に分けたあと、
     必ず x の順に並べ直す。これをしないと、ずれた1語だけが行の末尾に回り、
     型番が空のまま「値段だけの行」ができる（2026-09-10、20件で分かった）。
     -------------------------------------------------------------------- */

  var INABA_HEAD = {
    'コード': 1, '型番': 1, '新標準単価': 1, '掲載': 1, '新標準価格': 1, '品番': 1
  };

  /** 位置つきの文字を「行」にまとめる。pdf.js の y は下から上なので、上の行＝y が大きい */
  function inabaLines(items, chain) {
    var live = items.filter(function (i) { return String(i.s).trim() !== ''; });
    live.sort(function (a, b) { return b.y - a.y; });
    var lines = [], cur = [], y = null;
    live.forEach(function (i) {
      if (y === null || Math.abs(i.y - y) < 2.5) {
        cur.push(i);
        // chain のときは、直前の文字と比べて次へつなぐ。
        // 1行の中で y が少しずつ下がっていく紙面（オーケー器材）は、
        // 行の頭とだけ比べていると、行の後ろのほうが2.5を超えて別の行にされる。
        // 品番と値段が別々の行になって丸ごと落ちる（2026-09-10、17件で分かった）
        if (y === null || chain) y = i.y;
      } else {
        lines.push(cur); cur = [i]; y = i.y;
      }
    });
    if (cur.length) lines.push(cur);
    lines.forEach(function (ln) { ln.sort(function (a, b) { return a.x - b.x; }); });
    return lines;
  }

  /** 「¥」と数字が別々に来ることがあるので、くっつけてから見る */
  function inabaTokens(line) {
    var raw = line.map(function (i) { return String(i.s).trim(); })
                  .filter(function (t) { return t !== ''; });
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      if ((raw[i] === '¥' || raw[i] === '￥') && i + 1 < raw.length && /^[\d,]+$/.test(raw[i + 1])) {
        out.push('¥' + raw[i + 1]); i++;
      } else out.push(raw[i]);
    }
    return out;
  }

  /* 段組みの数はページによって違う（最後のほうは1段）。
     そこで「段に切ってから読む」のをやめた。
     **1行の中に ¥ が出てくるたびに1件**と数える。これなら1段でも2段でも同じ手で読める。
     左右の端から真ん中を割る手では、1段のページで1つの段を2つに割ってしまい、
     品番と値段が別々になって丸ごと落ちた（2026-09-10、5件）。 */
  function inabaRecords(toks) {
    var isCode = function (t) { return /^\d{3,7}$/.test(t); };
    var recs = [], start = 0;
    for (var i = 0; i < toks.length; i++) {
      var hit = toks[i].match(/^[¥￥]([\d,]+)$/);
      if (!hit) continue;
      // 値段のついていない件（「オープン」価格など）が手前にあると、
      // その語がそのまま次の件の型番にくっつく。**いちばん近いコードから拾う**
      var from = start;
      for (var k = i - 1; k >= start; k--) { if (isCode(toks[k])) { from = k; break; } }
      var seg = toks.slice(from, i);
      // 値段のうしろは掲載ページ（「P 6」「オープン P32」など）。
      // **次の件の頭＝コードに当たるまで読み飛ばす。**
      // 「P とその次の1語」だけ飛ばす作りだと、「オープン」のような
      // 余分な語が次の件の型番にくっつく（2026-09-10）
      var j = i + 1, tail = [];
      while (j < toks.length && !isCode(toks[j])) { tail.push(toks[j]); j++; }
      var pm = tail.join('').match(/[PＰ]\s*([\dA-Za-z\-]+)/);
      recs.push({ seg: seg, price: Number(hit[1].replace(/,/g, '')), ref: pm ? 'P' + pm[1] : '' });
      i = j - 1;
      start = j;
    }
    return recs;
  }

  /** 品名の見出しは段の左端に立っている。件も同じ段の左端から始まる。
      だから x がいちばん近い見出しが、その件の品名。 */
  function inabaNearest(list, x, y) {
    var best = null, bestDx = 1e9;
    list.forEach(function (h) {
      if (h.y < y - 0.5) return;              // pdf.js の y は下から上。見出しは件より上（y が大きい）
      var dx = Math.abs(h.x - x);
      if (dx > 120) return;                   // となりの段の見出しは拾わない
      if (dx < bestDx || (dx === bestDx && h.y < best.y)) { best = h; bestDx = dx; }
    });
    return best ? best.name : '';
  }

  function inabaReadPage(items, pageNo, ctx) {
    if (!items.length) return [];
    ctx = ctx || {};
    var out = [], names = [];

    inabaLines(items).forEach(function (ln) {
      var toks = inabaTokens(ln);
      if (!toks.length) return;

      // 見出しは行の途中にも混じる（左の段が見出し、右の段が明細、という行がある）。
      // ● は紙面の大見出しなので、段にも行にも縛られず、そのまま次の件に効かせる
      ln.forEach(function (it, k) {
        var t = String(it.s).trim();
        if (t.charAt(0) === '●') {
          // 「●」だけで1つの文字として来ることがある。そのときは行の残りが見出し
          var nm = t.slice(1).trim();
          if (!nm) {
            // 行の残りをつなぐ。ただし**となりの段に入る手前で止める**。
            // 止めないと「スリムダクトＬＤ・ひねり90°エルボ」のように
            // 右の段の品名まで見出しに入ってしまう
            for (var q = k + 1; q < ln.length; q++) {
              var v = String(ln[q].s).trim();
              if (!v || INABA_HEAD[v]) continue;
              if (v.charAt(0) === '・' || v.charAt(0) === '●' || /^\d{3,7}$/.test(v)) break;
              nm += v;
            }
          }
          if (nm) ctx.inabaSeries = nm;
        } else if (t.charAt(0) === '・') {
          names.push({ x: it.x, y: it.y, name: t.slice(1).trim() });
        }
      });

      // 見出しと表の見出し語は、明細の並びから外す。
      // 外さないと「・スリムダクトＬＤ2314LDN-70」のように型番にくっつく
      var body = toks.filter(function (t) {
        return t.charAt(0) !== '●' && t.charAt(0) !== '・' && t.charAt(0) !== '（' && !INABA_HEAD[t];
      });

      // 件が紙面のどのあたりから始まるかは、品番の文字を行の中から探して x を取る
      inabaRecords(body).forEach(function (rec) {
        if (!rec.price || !rec.seg.length) return;
        var code = /^\d{3,7}$/.test(rec.seg[0]) ? rec.seg[0] : '';
        var model = rec.seg.slice(code ? 1 : 0).join('').replace(/\s+/g, '');
        if (!model) return;
        var x = 0;
        for (var k = 0; k < ln.length; k++) {
          if (String(ln[k].s).trim() === rec.seg[0]) { x = ln[k].x; break; }
        }
        var nm = inabaNearest(names, x, ln[0].y);
        var sr = ctx.inabaSeries || '';
        out.push({
          m: model, y: rec.price, code: code,
          name: nm || sr || model, series: sr, ref: rec.ref, page: pageNo
        });
      });
    });
    return out;
  }

  function inabaFinish(sets) {
    var rows = [], seen = {};
    sets.forEach(function (r) {
      // 総合とエアコン配管部材の2冊に同じ品番が出る。先に読んだほうを残す
      if (seen[r.m]) return;
      seen[r.m] = 1;
      rows.push(r);
    });
    return {
      head: {
        maker: '因幡電工',
        brand: '価格改定表',
        note: '新標準単価・税抜。工事費は含まず。カタログの価格改定表から読み取ったもの。'
      },
      rows: rows,
      pricePages: sets.length ? 1 : 0
    };
  }

  /* --------------------------------------------------------------------
     ユーシー産業（エバック）
     ----------------------------------------------------------------------
     総合カタログ76ページの、うしろのほうにある「単価表」だけを読む。
     1段の素直な表で、列がきれいにそろっている。

       品　名          品　番     ホース呼び径 ホース長 梱　包  単　価
       エバフリーAFP型  AFP-20     φ20         400mm   30本   ¥1,120

     **列の x は、紙面の見出し（品　番／単　価）から覚える。**
     見出しの無いページは単価表ではないので、まるごと読み飛ばす。
     こうしておくと、カタログの前半（写真と説明のページ）を
     値段だと読み違えることがない。
     -------------------------------------------------------------------- */

  function ucFlat(t) {
    return String(t == null ? '' : t).replace(/[\s\u3000]/g, '');
  }

  /** 全角の英数字を半角にそろえる。品番が「ＢＦＰ-30-1000Ｌ」で来ることがある */
  function ucHalf(t) {
    return String(t).replace(/[Ａ-Ｚａ-ｚ０-９－]/g, function (c) {
      if (c === '－') return '-';
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
  }

  /* pdf.js は見出しを1文字ずつに割ってよこす（「品」「 」「番」）。
     文字の幅（w）を見て、となりとくっついているものをつなぎ直す。
     これをしないと「品番」という見出しが永遠に見つからず、0件で終わる。 */
  function ucWords(ln) {
    var out = [], cur = null, GAP = 12;   // 文字1つぶんの幅。列と列のすき間は70以上ある
    ln.forEach(function (it) {
      var t = String(it.s);
      var blank = !t.trim();
      // **つなぐのは1文字ずつ来たものだけ。**
      // 見出しは「品」「 」「番」と1文字ずつ来るのでつなぐ必要があるが、
      // 明細の文字（「エバフリーAFP型」「LJH-25」）はまとまって来る。
      // 何でもつなぐと、品名の右はしと品番がくっついて品番が見つからなくなる
      var single = blank || t.length === 1;
      if (cur && single && cur.single && it.x - (cur.x + cur.w) < GAP) {
        if (!blank) cur.s += t;
        cur.w = (it.x + (it.w || 0)) - cur.x;
        return;
      }
      if (blank) { cur = null; return; }
      cur = { s: t, x: it.x, y: it.y, w: it.w || 0, single: single };
      out.push(cur);
    });
    return out;
  }

  /** 品名は数行ぶんの高さの真ん中に置かれている。上でも下でもなく、いちばん近いものを採る */
  function ucNearest(list, y) {
    var best = null, bestDy = 1e9;
    list.forEach(function (h) {
      var dy = Math.abs(h.y - y);
      if (dy < bestDy) { bestDy = dy; best = h; }
    });
    return best && bestDy < 90 ? best.name : '';
  }

  function ucReadPage(items, pageNo) {
    var cx = {}, near = 60;
    var lines = inabaLines(items).map(ucWords);

    // 1回目：紙面の見出しから、列の x を覚える
    lines.forEach(function (ws) {
      ws.forEach(function (it) {
        var t = ucFlat(it.s);
        if (t === '品番' && cx.code == null) { cx.code = it.x; cx.headY = it.y; }
        if (t === '単価' && cx.price == null) cx.price = it.x;
        if (t === '品名' && cx.name == null) cx.name = it.x;
      });
    });
    if (cx.code == null || cx.price == null) return [];   // 単価表ではないページ

    // 2回目：品名を先に全部ひろう。品名は行の真ん中に置かれていて、
    // 上から順に読んでいる途中では「まだ出てきていない」ことがある
    var names = [];
    if (cx.name != null) {
      lines.forEach(function (ws) {
        ws.forEach(function (it) {
          var t = ucFlat(it.s);
          if (!t || t === '品名') return;
          if (Math.abs(it.x - cx.name) > near) return;
          if (t.charAt(0) === '→') return;             // 「→P.05」は参照ページ
          if (t.charAt(0) === '■') return;             // 「■排水部材・産業資材」は章の見出し
          if (t.length < 3) return;                    // 割れて残った「・」などは品名ではない
          // 表の見出しより上にあるものは、章の題（「■排水部材・産業資材」）であって品名ではない
          if (cx.headY != null && it.y > cx.headY - 2) return;
          names.push({ x: it.x, y: it.y, name: t });
        });
      });
    }

    // 3回目：明細
    var out = [];
    lines.forEach(function (ws) {
      if (!ws.length) return;
      var price = 0, model = '';
      ws.forEach(function (it) {
        var t = ucFlat(it.s);
        var m = t.match(/^[¥￥]([\d,]+)$/);
        if (m && Math.abs(it.x - cx.price) < near) { price = Number(m[1].replace(/,/g, '')); return; }
        if (!model && Math.abs(it.x - cx.code) < near && /[A-Za-zＡ-Ｚａ-ｚ]/.test(t)) model = ucHalf(t);
      });
      if (!price || !model) return;

      out.push({
        m: model, y: price, code: '',
        name: ucNearest(names, ws[0].y) || model,
        series: 'ユーシー産業', ref: 'P' + pageNo, page: pageNo
      });
    });
    return out;
  }

  function ucFinish(sets) {
    // 同じ品番が「品番表」と「単価表」の両方に出る。値段は同じだが、
    // 品名が入っているのは単価表のほうだけ。**品名のあるほうを残す**
    var rows = [], at = {};
    sets.forEach(function (r) {
      var i = at[r.m];
      if (i == null) { at[r.m] = rows.length; rows.push(r); return; }
      if (rows[i].name === rows[i].m && r.name !== r.m) rows[i] = r;
    });
    return {
      head: {
        maker: 'ユーシー産業',
        brand: '単価表',
        note: '定価・税抜。総合カタログの単価表から読み取ったもの。'
      },
      rows: rows,
      pricePages: sets.length ? 1 : 0
    };
  }

  /* --------------------------------------------------------------------
     オーケー器材（ダイキン系の部材）
     ----------------------------------------------------------------------
     空調工事部材カタログ。612ページ・163MBある大物で、値段は製品の表の
     あちこちに「12,100円/本」の形で散っている。¥ は使わない。

     紙面の作り
       ・1ページに表が1〜4つ。縦に並ぶことも、左右に並ぶこともある
       ・列の位置は見出し「品　番」「希望小売価格」が教えてくれる
       ・**見出しの y は「品番」と「希望小売価格」で3ポイントほどずれる**（同じ行ではない）
       ・**品番と値段の y も1ポイントほどずれる**

     だから「行にまとめてから読む」をやめた。紙面のへり（縦書きの見出し）に
     引っぱられて、品番と値段が別の行に割れる。
     **値段のほうを起点にして、同じ列でいちばん y の近い品番を組にする。**
     -------------------------------------------------------------------- */

  var OK_PRICE = /^([\d,]+)円(?:\/(\S+))?$/;
  var OK_CODE  = /^[A-Z][A-Za-z0-9\-]{2,}$/;
  var OK_NEAR  = 45;      // 値段の列のずれ
  var OK_WIDE  = 90;      // 品番の列は見出しがまん中ぞろえで、実物より右に出る
  var OK_BAND  = 10;      // 見出しの y のずれ
  // 品番の形をしているが品番ではないもの。BIMは「BIMデータあり」の印
  var OK_NOT_CODE = { BIM: 1, NEW: 1, PDF: 1, CAD: 1 };

  /** 見出しを y でまとめ、品番と希望小売価格を左から順に組にする */
  function okBands(ws) {
    var marks = [];
    ws.forEach(function (w) {
      var t = ucFlat(w.s);
      if (t === '品番') marks.push({ kind: 'code', x: w.x, y: w.y });
      else if (t === '希望小売価格') marks.push({ kind: 'price', x: w.x, y: w.y });
    });
    marks.sort(function (a, b) { return b.y - a.y; });    // pdf.js の y は下から上。上の見出しから

    var bands = [], cur = [], y = null;
    marks.forEach(function (m) {
      if (y === null || Math.abs(m.y - y) < OK_BAND) {
        cur.push(m);
        if (y === null) y = m.y;
      } else { bands.push({ y: y, marks: cur }); cur = [m]; y = m.y; }
    });
    if (cur.length) bands.push({ y: y, marks: cur });

    var out = [];
    bands.forEach(function (b) {
      b.marks.sort(function (a, c) { return a.x - c.x; });
      var pairs = [];
      b.marks.forEach(function (m, i) {
        if (m.kind !== 'code') return;
        for (var j = i + 1; j < b.marks.length; j++) {
          if (b.marks[j].kind === 'price') { pairs.push({ cx: m.x, px: b.marks[j].x }); break; }
        }
      });
      if (pairs.length) out.push({ y: b.y, pairs: pairs });
    });
    return out;
  }

  var OK_GLUED = /^([A-Z][A-Za-z0-9\-]{2,})[\s　]+([\d,]+)$/;

  /** 値段の文字の来かたが3通りある。どれも1つの語にそろえる。
        「12,100円/本」……そのまま
        「13,700」＋「円/本」……数字のうしろに円が来る
        「KHR58S211 21,100」＋「円」……**品番と値段が1つの文字になっている**（分岐管のページ）
      3つ目は品番と値段に切り分ける。値段の x は、うしろに来る「円」の位置を使う */
  function okWords(ln) {
    var ws = ucWords(ln), out = [];
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i], nx = ws[i + 1];
      var yen = nx && nx.s.charAt(0) === '円' && nx.x - (w.x + w.w) < 6;
      var glued = w.s.match(OK_GLUED);
      if (glued && yen) {
        out.push({ s: glued[1], x: w.x, y: w.y, w: w.w / 2 });
        out.push({ s: glued[2] + nx.s, x: nx.x - 1, y: w.y, w: nx.w });
        i++;
      } else if (yen && /^[\d,]+$/.test(w.s)) {
        out.push({ s: w.s + nx.s, x: w.x, y: w.y, w: (nx.x + nx.w) - w.x });
        i++;
      } else out.push(w);
    }
    return out;
  }

  function okReadPage(items, pageNo) {
    if (!items.length) return [];
    // 見出しは1文字ずつ、値段は数字と「円/本」に割れて来る。つなぎ直してから見る
    var ws = [], byLine = [];
    inabaLines(items, true).forEach(function (ln) {
      var w = okWords(ln);
      byLine.push(w);
      ws = ws.concat(w);
    });

    var bands = okBands(ws);
    if (!bands.length) return [];

    /* ページのいちばん上の柱（「クイックパイパー」など）を、そのページの品名にする。
       **1語だけ採ると尻切れになる。**「スカイダクト」が「スカイダク」＋「ト」に
       割れて来るので、いちばん上の行をまるごとつなぐ（2026-09-10） */
    var top = '';
    for (var li = 0; li < byLine.length && !top; li++) {
      var t = byLine[li].map(function (w) { return ucFlat(w.s); })
                        .filter(function (v) { return v && !/^[\d,.\-]+$/.test(v); })
                        .join('');
      if (t.length >= 3) top = t;
    }

    var prices = [], codes = [];
    ws.forEach(function (w) {
      var t = ucFlat(w.s);
      var m = t.match(OK_PRICE);
      if (m) prices.push({ x: w.x, y: w.y, val: Number(m[1].replace(/,/g, '')), unit: m[2] || '' });
      else if (OK_CODE.test(t) && !OK_NOT_CODE[t]) codes.push({ x: w.x, y: w.y, s: t });
    });

    var out = [];
    prices.forEach(function (p) {
      // その値段より上にある見出しのうち、**値段の列が合うもので**いちばん近いもの。
      // 左右2つの表が縦にずれて並ぶページがあり、「いちばん近い見出し」だけで選ぶと
      // 右の表の見出しで左の表を読もうとして、列が合わず丸ごと落ちる
      var pair = null, all = null;
      bands.forEach(function (b) {
        if (b.y < p.y - 1) return;                 // 上＝y が大きい
        b.pairs.forEach(function (q) {
          if (Math.abs(p.x - q.px) < OK_NEAR) { pair = q; all = b.pairs; }
        });
      });
      if (!pair) return;

      var best = null, bestDy = 99;
      codes.forEach(function (c) {
        if (Math.abs(c.x - pair.cx) >= OK_WIDE) return;
        // 品番の列がいくつもあるページでは、いちばん近い列のものだけを採る
        var own = all[0];
        all.forEach(function (q) { if (Math.abs(c.x - q.cx) < Math.abs(c.x - own.cx)) own = q; });
        if (own.cx !== pair.cx) return;
        var dy = Math.abs(c.y - p.y);
        if (dy < bestDy) { bestDy = dy; best = c.s; }
      });
      if (best && bestDy < 4) {
        out.push({ m: best, y: p.val, code: '', name: top || best, series: top || '部材',
                   ref: 'P' + pageNo, unit: p.unit, page: pageNo });
      }
    });
    return out;
  }

  function okFinish(sets) {
    var rows = [], seen = {};
    sets.forEach(function (r) { if (!seen[r.m]) { seen[r.m] = 1; rows.push(r); } });
    return {
      head: {
        maker: 'オーケー器材',
        brand: '空調工事部材カタログ',
        note: '希望小売価格・税抜。カタログの表から読み取ったもの。'
      },
      rows: rows,
      pricePages: sets.length ? 1 : 0
    };
  }

  var MAKERS = [
    {
      id: 'carrier',
      name: '日本キヤリア（旧東芝）',
      catalog: '店舗・オフィス用カスタムエアコン',
      size: '212ページ・59MBほど。読み取りに1分ほどかかります。',
      howto: [
        '下のリンクからカタログを開く',
        'カタログの画面から、PDFを丸ごと保存する',
        '保存したPDFを「カタログPDFを選ぶ」で選ぶ'
      ],
      url: 'https://cjc.icata.net/iportal/oc.do?v=CJC00001&d=CJCD01&c=090_90_9999_1&p=1',
      min: 700,
      isPricePage: carrierIsPricePage,
      build: buildCarrier
    },
    {
      id: 'hitachi',
      name: '日立',
      catalog: '店舗・オフィス用パッケージエアコン総合カタログ',
      size: '286ページ・380MBほど。読み取りに6分ほどかかり、そのあいだパソコンが重くなります。',
      howto: [
        '下のリンクを押すと、カタログ1冊ぶんのPDFが落ちてくる（380MBあるので数分かかります）',
        '落ちてきたPDFを「カタログPDFを選ぶ」で選ぶ'
      ],
      url: 'https://www.hitachi-gls.co.jp/catalog/office/book/data/Target.pdf',
      min: 500,
      isPricePage: hitachiIsPricePage,
      build: buildHitachi
    },
    {
      id: 'panasonic',
      name: 'パナソニック',
      catalog: 'オフィス・店舗用エアコン総合カタログ',
      size: '236ページ・53MBほど。読み取りに1分ほどかかります。',
      howto: [
        '下のリンクからカタログの一覧を開く',
        '「オフィス・店舗用エアコン総合カタログ」を開いて、PDFを丸ごと保存する',
        '保存したPDFを「カタログPDFを選ぶ」で選ぶ'
      ],
      url: 'https://panasonic.icata.net/iportal/CatalogSearch.do?method=catalogSearchByAnyCategories&volumeID=PEWJ0001&categoryID=353090000',
      min: 750,
      layout: true,            // 3段組なので、文字を位置つきで読む
      readPage: panaReadPage,
      finish: panaFinish
    },
    {
      id: 'daikin',
      name: 'ダイキン',
      catalog: '店舗・オフィスエアコン スカイエア',
      size: '価格ページだけで130MBほど。読み取りに2分ほどかかります。',
      howto: [
        '下のリンクを押すと「52〜123ページ（価格の載っているところ）だけのPDF」を作る画面が出る',
        'その画面のボタンでPDFを保存する',
        '保存したPDFを「カタログPDFを選ぶ」で選ぶ'
      ],
      url: 'https://ec.daikinaircon.com/cgi-bin/ecatalog/bindPDF.cgi?C=CP26016AXX&S=52&E=123&CT=1&CV=1',
      min: 700,
      layout: true,            // 4段組。しかも行の文字をつなげてはいけない
      readPage: daikinReadPage,
      finish: daikinFinish
    },
    {
      id: 'daikin-room',
      name: 'ダイキン（ルームエアコン）',
      catalog: '住宅設備用カタログ（ルームエアコン・ハウジングエアコン）',
      size: '100ページ・96MBほど。読み取りに2分ほどかかります。',
      howto: [
        '下のリンクを押すと「全ページのPDF」を作る画面が出る',
        'その画面の［ダウンロード開始］でPDFを保存する',
        '保存したPDFを「カタログのファイルを選ぶ」で選ぶ'
      ],
      url: 'https://ec.daikinaircon.com/cgi-bin/ecatalog/bindPDF.cgi?C=CR25227BXX&S=0&E=99&CT=1&CV=1',
      urlNote: '壁掛形・天井埋込カセット・床置形・壁埋込形・ビルトイン形・マルチエアコン（マルチパック・ココタス・システムマルチの室外機と室内機）を読みます。パネル別売の形は「パネル込みの合計価格」で入ります。Eシリーズはオープン価格なので値段0で入ります。',
      min: 60,
      layout: true,
      readPage: dkRoomReadPage,
      finish: dkRoomFinish
    },
    {
      id: 'daikin-room-opt',
      name: 'ダイキン（ルームエアコン別売品）',
      catalog: '住宅設備用カタログ の別売品（69〜77ページ）',
      size: '機種と同じPDFでかまいません。100ページ・96MBほど。読み取りに2分ほどかかります。',
      kind: 'options',
      layout: true,
      howto: [
        '機種と同じPDFでかまいません',
        '下のリンクを押すと「全ページのPDF」を作る画面が出る。［ダウンロード開始］で保存する',
        '保存したPDFを「カタログのファイルを選ぶ」で選ぶ'
      ],
      url: 'https://ec.daikinaircon.com/cgi-bin/ecatalog/bindPDF.cgi?C=CR25227BXX&S=0&E=99&CT=1&CV=1',
      urlNote: '値段は紙面の税込価格を1.1で割った税抜きで入ります。業務用（スカイエア）の別売品とは別に入ります。',
      min: 150,
      readPage: dkRoomOptReadPage,
      finish: dkRoomOptFinish
    },
    {
      id: 'mitsubishi',
      name: '三菱電機',
      catalog: 'Mr.SLIM の機種データ（価格つき）',
      size: '1MBほど。読み取りはすぐ終わります。',
      kind: 'json',            // PDFではなくデータファイルを読む
      howto: [
        '下のリンクを押すと、文字がびっしり並んだ画面が出る（これで合っています）',
        'その画面で右クリック →「名前を付けて保存」で保存する',
        '保存したファイルを「カタログのファイルを選ぶ」で選ぶ'
      ],
      url: 'https://www.mitsubishielectric.co.jp/ldm/slim/search/data.json',
      min: 900,
      finish: mitsuFinish
    },
    {
      id: 'daikin-opt',
      name: 'ダイキン（別売品）',
      catalog: '店舗・オフィスエアコン スカイエア の別売品',
      size: '別売品のページだけで60MBほど。読み取りに2分ほどかかります。',
      kind: 'options',         // 機種データではなく別売品として入る
      layout: true,
      howto: [
        '下のリンクを押すと「180〜243ページ（別売品のところ）だけのPDF」を作る画面が出る',
        'その画面のボタンでPDFを保存する',
        '保存したPDFを「カタログのファイルを選ぶ」で選ぶ'
      ],
      url: 'https://ec.daikinaircon.com/cgi-bin/ecatalog/bindPDF.cgi?C=CP26016AXX&S=180&E=243&CT=1&CV=1',
      min: 500,
      readPage: function (items, page) {
        var txt = items.map(function (i) { return i.s; }).join('').replace(/\s/g, '');
        /* 耐塩害・耐重塩害の「機種の選び方」ページは別売品ではない。
           室外機の品番と本体価格が並んでいるので、放っておくと
           機種そのものが「どの機種にも付く別売品」として72件入ってしまう
           （2026-09-09、RZRP40CV 581,000円 などで分かった） */
        if (/耐重塩害仕様/.test(txt)) return [];
        var out = [];
        optPage(items, page, out);            // 列の見出しが室内機の表
        optPageDaikinVert(items, page, out); // 品番が縦に並び、価格が下に1行だけの表
        return out;
      },
      finish: function (list) { return optResult(list, 'ダイキン', 'スカイエア 別売品'); }
    },
    {
      id: 'panasonic-opt',
      name: 'パナソニック（別売品）',
      catalog: 'オフィス・店舗用エアコン総合カタログ の別売品',
      size: '236ページ・53MBほど。読み取りに5分ほどかかります。',
      kind: 'options',
      layout: true,
      howto: [
        '機種データと同じPDFでかまいません',
        'カタログを開いてPDFを保存し、「カタログのファイルを選ぶ」で選ぶ'
      ],
      url: 'https://panasonic.icata.net/iportal/CatalogSearch.do?method=catalogSearchByAnyCategories&volumeID=PEWJ0001&categoryID=353090000',
      min: 160,
      readPage: function (items, page, ctx) {
        var out = [];
        /* 別売品一覧表のページには機種タイプが書いていない。
           紙面のノドに入っている「54 ４方向天井カセット形」を手がかりにする。
           これが無いと、壁掛形にも天井パネルが出てしまう（2026-09-09） */
        optPagePana(items, page, out, { types: PANA_TYPES }, ctx);
        return out;
      },
      finish: function (list) { return optResult(list, 'パナソニック', 'オフィス・店舗用エアコン 別売品'); }
    },
    {
      id: 'carrier-opt',
      name: '日本キヤリア（別売品）',
      catalog: '店舗・オフィス用カスタムエアコン の別売品',
      size: '212ページ・59MBほど。読み取りに4分ほどかかります。',
      kind: 'options',
      layout: true,
      howto: [
        '機種データと同じPDFでかまいません',
        'カタログを開いてPDFを保存し、「カタログのファイルを選ぶ」で選ぶ'
      ],
      url: 'https://cjc.icata.net/iportal/oc.do?v=CJC00001&d=CJCD01&c=090_90_9999_1&p=1',
      min: 80,
      readPage: function (items, page, ctx) {
        var out = [];
        /* 別売品のページには機種タイプが書いていない（章立てで決まっているため）。
           手前の**価格ページの形名**からタイプを割り出して覚えておき、
           別売品のページはその続きとみなす。
           この覚え書き（ctx.pageTypes）は前から使うつもりで書いてあったのに、
           入れるほうを作っていなかった。そのため化粧パネルもリモコンも
           どの機種にも当たらず、室外機の架台しか出ていなかった（2026-09-09） */
        var flat = items.map(function (i) { return i.s; }).join(' ');
        if (ctx && carrierIsPricePageLoose(flat)) {
          var cnt = {}, re = /\b([A-Z]{4}\d{5}[A-Z0-9]*)\b/g, m;
          while ((m = re.exec(flat)) !== null) {
            var t = CARRIER_TYPE[m[1].charAt(1)];
            if (t) cnt[t] = (cnt[t] || 0) + 1;
          }
          var best = '', bn = 0;
          Object.keys(cnt).forEach(function (k) { if (cnt[k] > bn) { bn = cnt[k]; best = k; } });
          if (best) { ctx.pageTypes = ctx.pageTypes || {}; ctx.pageTypes[page] = best; }
        }
        // キヤリアは表が2種類ある。室内機用（適用室内ユニット列）と室外機用（列＝シリーズ）
        optPagePana(items, page, out, {
          codeWord: /部品形名/, priceWord: /価格/,
          types: ['天井カセット形4方向', '天井カセット形2方向', '天井カセット形1方向',
                  '天井吊形', '壁掛形', 'ビルトイン', 'ダクト', '床置形', '厨房用天井吊形']
        }, ctx);
        // 品名は一覧の表の読み方で付け直す（上の carrierPageNames の説明）
        if (out.length) {
          var carName = carrierPageNames(items);
          if (carName) out.forEach(function (o) { var nm = carName(o.code); if (nm && nm.length >= 2) o.name = nm; });
        }
        // 室内機用の表が無いページは、室外機用（列＝シリーズ）として読み直す
        if (!out.length) optPageCarrier(items, page, out);
        // 「別売部品一覧」の表（室内機に付くパネル・フィルターはここにしか無い）
        if (!out.length) optPageCarrierParts(items, page, out, ctx);
        return out;
      },
      finish: function (list) { return optResult(list, '日本キヤリア（旧東芝）', '店舗・オフィス用カスタムエアコン 別売品'); }
    },
    {
      id: 'hitachi-opt',
      name: '日立（別売品）',
      catalog: '店舗・オフィス用パッケージエアコン総合カタログ の別売品',
      size: '286ページ・380MBほど。読み取りに6分ほどかかり、そのあいだパソコンが重くなります。',
      kind: 'options',
      layout: true,
      howto: [
        '機種データと同じPDFでかまいません',
        '下のリンクからPDFを保存し、「カタログのファイルを選ぶ」で選ぶ'
      ],
      url: 'https://www.hitachi-gls.co.jp/catalog/office/book/data/Target.pdf',
      min: 75,
      readPage: function (items, page) { var out = []; optPageHitachi(items, page, out); return out; },
      finish: function (list) { return optResult(list, '日立', '店舗・オフィス用パッケージエアコン 別売品'); }
    },
    {
      id: 'mitsubishi-opt',
      name: '三菱電機（別売品）',
      catalog: 'Mr.SLIM 総合カタログ の別売品',
      size: '136MBほど。読み取りに4分ほどかかります。',
      kind: 'options',
      layout: true,
      howto: [
        '下のリンクからカタログのPDFを保存する',
        '保存したPDFを「カタログのファイルを選ぶ」で選ぶ'
      ],
      url: 'https://dl.mitsubishielectric.co.jp/dl/ldg/wink/wink_doc/contents/doc/WEB_CATA/S1794CB020E/data/target.pdf',
      min: 10,
      readPage: function (items, page) {
        var out = [];
        optPageMitsuList(items, page, out);      // オプション構成図のページ（132〜142ページ）
        optPageMitsu(items, page, out);          // 機種ページの構成品（パネル・リモコン）
        optPageMitsuCommon(items, page, out);   // 共通別売部品（分配管など・144ページ）
        optPageMitsuOutdoor(items, page, out);  // 室外ユニットオプション（143ページ）
        return out;
      },
      finish: function (list) { return optResult(list, '三菱電機', 'Mr.SLIM 別売品'); }
    },
    {
      id: 'inaba-parts',
      name: '因幡電工（部材）',
      catalog: '価格改定表（総合カタログ／エアコン配管部材カタログ）',
      size: '2冊で2MBほど。読み取りはすぐ終わります。',
      kind: 'parts',           // 機種データでも別売品でもなく、単価マスタに入る
      layout: true,
      howto: [
        '下のリンクを押すと「価格改定表」のPDFが落ちてくる（軽いのですぐ終わります）',
        'エアコンの配管部材だけでよければ、下のもう1本のほうが小さい',
        '落ちてきたPDFを「カタログのファイルを選ぶ」で選ぶ'
      ],
      url: 'https://www.inaba-denko.com/storage/files/202606_price.pdf',
      url2: 'https://www.inaba-denko.com/common/broadcast/feature/img/202606_aircon_price.pdf',
      urlNote: '因幡電工のデジタルカタログのページ（https://www.inaba-denko.com/ja/catalog）に、いつも最新の「価格改定表」が並んでいます。値上げがあったら、そこから取り直してください。',
      min: 200,
      readPage: inabaReadPage,
      finish: inabaFinish
    },
    {
      id: 'uc-parts',
      name: 'ユーシー産業（部材）',
      catalog: 'エバック 総合カタログ（うしろの単価表を読みます）',
      size: '76ページ・24MBほど。読み取りに20秒ほどかかります。',
      kind: 'parts',
      layout: true,
      howto: [
        '下のリンクを押すと、総合カタログのPDFが落ちてくる',
        '落ちてきたPDFを「カタログのファイルを選ぶ」で選ぶ'
      ],
      url: 'https://microbecms-microbe-cms-evuc-uploads.s3.ap-northeast-1.amazonaws.com/uploads/2026/05/1779965937194-70c95f460c37d093.pdf',
      urlNote: 'リンクが切れていたら、ユーシー産業のサイト（https://www.evuc.co.jp/e-catalog/）のWEBカタログから取り直してください。',
      min: 30,
      readPage: ucReadPage,
      finish: ucFinish
    },
    {
      id: 'okkizai-parts',
      name: 'オーケー器材（部材）',
      catalog: '空調工事部材カタログ 2026〜2027',
      size: '612ページ・163MBほど。読み取りに5〜8分かかり、そのあいだパソコンが重くなります。ほかのアプリを閉じてから始めてください。',
      kind: 'parts',
      layout: true,
      howto: [
        '下のリンクを押すと、カタログ1冊ぶんのPDFが落ちてくる（163MBあるので数分かかります）',
        '落ちてきたPDFを「カタログのファイルを選ぶ」で選ぶ'
      ],
      url: 'https://dcs.gamedios.com/webapi/v4.7/stream/get/file/data?appkey=JOSGCVAITEAWL&volumeid=OKK10001&id=22045240000&dg=30F7CC7E890BF5C045EDC2D9126960E5967CE365&age=orig',
      urlNote: 'リンクが切れていたら、オーケー器材のデジタルカタログ（https://ok-kizai.co.jp/system/catalog/index）の「空調工事部材カタログ」から取り直してください。',
      min: 800,
      readPage: okReadPage,
      finish: okFinish
    }
  ];

  /* --------------------------------------------------------------------
     PDFを読む
     pdf-parse（ブラウザ版）を使う。中身は pdf.js だが、紙面の段組みを
     復元してくれるところが値打ち。自前で並べ替えると 46個中6件しか
     取れない（2026-09-02 実測）。真似しようとしないこと。

     日本語のPDFは cMapUrl / cMapPacked を渡さないと文字が丸ごと消える。
     消えても例外は出ないので、渡し忘れると「価格が載っていない」と
     見誤る。ここは絶対に外さない。
     -------------------------------------------------------------------- */
  var CHUNK = 8;   // 何ページずつ読むか（進み具合を出すため小分けにする）

  function readPages(file, maker, onProgress) {
    var PP = window.PdfParse && window.PdfParse.PDFParse;
    if (!PP) return Promise.reject(new Error('PDFを読む部品が読み込めませんでした'));
    PP.setWorker('vendor/pdfparse/pdf.worker.mjs?v=' + (window.KUCHOO_APP_VERSION || ''));

    // 読み方は大きさで変える。
    // ・ふつうの大きさ（キヤリア59MB）は丸ごとメモリに載せる。212ページを41秒。
    // ・大きいもの（日立は1冊380MB）を丸ごと載せると端末が落ちる。
    //   blobのURLを渡すと、要るところだけ読みに行くのでメモリは要らない。
    //   ただし読み込みは10倍ほど遅い（実測。だから小さいものには使わない）。
    var big = file.size > 150 * 1024 * 1024;
    var blobUrl = big ? URL.createObjectURL(file) : '';

    return (big ? Promise.resolve(null) : file.arrayBuffer()).then(function (buf) {
      var parser = new PP(big
        ? { url: blobUrl, cMapUrl: 'vendor/pdfparse/cmaps/', cMapPacked: true,
            disableAutoFetch: true, verbosity: 0 }
        : { data: new Uint8Array(buf), cMapUrl: 'vendor/pdfparse/cmaps/', cMapPacked: true,
            verbosity: 0 });
      return parser.getInfo().then(function (info) {
        var total = info.total || info.numpages || 0;
        if (!total) throw new Error('ページ数が読み取れませんでした。PDFが壊れていないか確かめてください');
        var pages = {}, at = 1;

        function step() {
          if (at > total) return Promise.resolve();
          var part = [];
          for (var n = at; n < at + CHUNK && n <= total; n++) part.push(n);
          at += CHUNK;
          return parser.getText({ partial: part }).then(function (r) {
            (r.pages || []).forEach(function (pg, i) {
              var num = pg.num != null ? pg.num : part[i];
              var text = pg.text || '';
              // 値段の載っていないページの文字は、その場で捨てる。
              // 日立は286ページある。全部ためておくとメモリを無駄に食う。
              // （ページ番号は残すので「何ページ読んだか」は分かる）
              pages[num] = (!maker.isPricePage || maker.isPricePage(text)) ? text : '';
            });
            if (onProgress) onProgress(Math.min(at - 1, total), total);
            // 画面を固まらせない
            return new Promise(function (ok) { setTimeout(ok, 0); }).then(step);
          });
        }

        return step().then(function () {
          return parser.destroy().then(function () { return pages; },
                                       function () { return pages; });
        });
      });
    }).then(function (pages) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      return pages;
    }, function (e) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      throw e;
    });
  }

  /* --------------------------------------------------------------------
     位置つきで読む（段組みのある紙面用）

     pdf-parse の部品を読み込むと、その中の pdf.js 本体が
     window.pdfjsLib として一緒に出てくる。だから追加の部品は要らない。

     1ページ読むごとに、その場で機種の塊にしてしまう。
     ページの文字は残さない（286ページぶん残すとメモリを食う）。
     -------------------------------------------------------------------- */
  function readLayout(file, maker, onProgress, ctx) {
    var PP = window.PdfParse && window.PdfParse.PDFParse;
    if (!PP) return Promise.reject(new Error('PDFを読む部品が読み込めませんでした'));
    PP.setWorker('vendor/pdfparse/pdf.worker.mjs?v=' + (window.KUCHOO_APP_VERSION || ''));

    var pdfjs = window.pdfjsLib;
    if (!pdfjs || !pdfjs.getDocument) {
      return Promise.reject(new Error('PDFを読む部品（pdf.js）が見つかりませんでした'));
    }

    var big = file.size > 150 * 1024 * 1024;
    var blobUrl = big ? URL.createObjectURL(file) : '';

    return (big ? Promise.resolve(null) : file.arrayBuffer()).then(function (buf) {
      var opt = big ? { url: blobUrl, disableAutoFetch: true } : { data: new Uint8Array(buf) };
      opt.cMapUrl = 'vendor/pdfparse/cmaps/';   // 渡さないと日本語が丸ごと消える
      opt.cMapPacked = true;
      opt.verbosity = 0;

      return pdfjs.getDocument(opt).promise.then(function (doc) {
        var total = doc.numPages, sets = [], at = 1;
        if (!total) throw new Error('ページ数が読み取れませんでした。PDFが壊れていないか確かめてください');

        function step() {
          if (at > total) return Promise.resolve();
          var n = at++;
          return doc.getPage(n).then(function (pg) {
            return pg.getTextContent().then(function (c) {
              var items = [];
              (c.items || []).forEach(function (i) {
                // w（文字の幅）は別売品の品名を組み立てるときに使う
                if (i.str) items.push({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0 });
              });
              var got = maker.readPage(items, n, ctx);
              if (got && got.length) sets.push.apply(sets, got);
              pg.cleanup();
              if (onProgress) onProgress(n, total);
              // 画面を固まらせない
              return new Promise(function (ok) { setTimeout(ok, 0); }).then(step);
            });
          });
        }

        return step().then(function () {
          return doc.destroy().then(function () { return sets; }, function () { return sets; });
        });
      });
    }).then(function (sets) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      return sets;
    }, function (e) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      throw e;
    });
  }

  /* --------------------------------------------------------------------
     読み取った行を、空調王が読む形（辞書＋番号）に詰め直す
     -------------------------------------------------------------------- */
  var FIELDS = ['m', 'hp', 'y', 'u', 's', 'i', 'ab', 'pw', 'rc', 'tp', 'opt', 'om', 'im', 'pm', 'rm'];
  var DICT_FIELDS = ['s', 'i', 'ab', 'pw', 'rc', 'tp', 'opt', 'om', 'im', 'pm', 'rm'];

  function pack(head, rows) {
    var dict = {}, idx = {};
    DICT_FIELDS.forEach(function (f) {
      var vals = [], seen = {};
      rows.forEach(function (r) {
        var v = r[f];
        if (!(v in seen)) { seen[v] = vals.length; vals.push(v); }
      });
      dict[f] = vals; idx[f] = seen;
    });
    var d = new Date(), p2 = function (x) { return String(x).length < 2 ? '0' + x : String(x); };
    return {
      maker: head.maker, brand: head.brand, source: head.source, note: head.note,
      fetched: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()),
      seriesOrder: head.seriesOrder, typeOrder: head.typeOrder, urlBase: head.urlBase,
      fields: FIELDS, dictFields: DICT_FIELDS, dict: dict,
      rows: rows.map(function (r) {
        return FIELDS.map(function (f) {
          return DICT_FIELDS.indexOf(f) >= 0 ? idx[f][r[f]] : r[f];
        });
      })
    };
  }

  /* --------------------------------------------------------------------
     読み取りの点検
     少なすぎ・空っぽを黙って通さない。何を疑えばいいかまで出す。
     -------------------------------------------------------------------- */
  function inspect(maker, res) {
    var rows = res.rows;
    if (!rows.length) {
      var bad = ['1件も読み取れませんでした。'];
      if (!res.pricePages) bad.push('価格の載ったページが1枚も見つかりませんでした。');
      bad.push('確かめること：① そのメーカーのカタログか ② 値段の載っている総合カタログか（技術資料ではないか） ③ カタログが新しくなって書き方が変わっていないか');
      return { ok: false, msg: bad.join('\n') };
    }
    var noPrice = rows.filter(function (r) { return !r.y; }).length;
    if (noPrice === rows.length) {
      return { ok: false, msg: '品番は読めましたが、金額が1件も取れませんでした。金額の書き方（¥・円・全角）が変わった可能性があります。' };
    }
    if (rows.length < maker.min) {
      return {
        ok: false, warn: true,
        msg: '読み取れたのは ' + rows.length + ' 件でした。ふだんは ' + maker.min + ' 件以上あります。\n' +
             'カタログが新しくなって書き方が変わったのかもしれません。このまま使うと機種が抜けます。'
      };
    }
    return { ok: true, noPrice: noPrice };
  }

  /* --------------------------------------------------------------------
     入口
     run(file, makerId, onProgress) → { pack, count, … }
     -------------------------------------------------------------------- */
  function run(file, makerId, onProgress, ctx) {
    ctx = ctx || {};          // ページ→機種タイプの覚え書きを入れる場所
    var maker = null;
    MAKERS.forEach(function (mk) { if (mk.id === makerId) maker = mk; });
    if (!maker) return Promise.reject(new Error('メーカーが選ばれていません'));

    // 読み方は3通り。
    //  ・データファイル（三菱）……そのまま読む
    //  ・段組みのある紙面（パナ・ダイキン）……文字を位置つきで読む
    //  ・ふつうの紙面（キヤリア・日立）……つないだ文字で読む
    var job = maker.kind === 'json'
      ? readJsonFile(file).then(function (list) { return maker.finish(list); })
      : (maker.layout
          ? readLayout(file, maker, onProgress, ctx).then(function (sets) { return maker.finish(sets); })
          : readPages(file, maker, onProgress).then(function (pages) { return maker.build(pages); }));

    return job.then(function (res) {
      var chk = inspect(maker, res);
      if (!chk.ok) {
        var e = new Error(chk.msg);
        e.soft = !!chk.warn;
        e.rows = res.rows.length;
        // 「少なすぎる」で止めた場合だけは、中身も渡す。
        // 本当に機種が減った年かもしれないので、人が見て決められるようにする。
        if (chk.warn && res.rows.length) e.pack = pack(res.head, res.rows);
        throw e;
      }
      // 部材は単価マスタに入る。機種データの形（pack）には通さない
      if (maker.kind === 'parts') {
        return {
          parts: { maker: res.head.maker, brand: res.head.brand, note: res.head.note, rows: res.rows },
          count: res.rows.length,
          pricePages: res.pricePages,
          noPrice: chk.noPrice
        };
      }

      // 別売品は機種データとは別の入れ物にする
      if (maker.kind === 'options') {
        var d = new Date(), p2 = function (x) { return String(x).length < 2 ? '0' + x : String(x); };
        return {
          options: {
            maker: res.head.maker,
            brand: res.head.brand,
            note: res.head.note,
            fetched: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()),
            items: res.rows
          },
          count: res.rows.length,
          pricePages: res.pricePages,
          noPrice: chk.noPrice
        };
      }

      return {
        pack: pack(res.head, res.rows),
        count: res.rows.length,
        pricePages: res.pricePages,
        noPrice: chk.noPrice
      };
    });
  }

  /* ====================================================================
     別売品が、その機種に付くかどうかを見分ける
     --------------------------------------------------------------------
     **適用機種の書かれ方は5社で全部ちがう。** 紙面を見て確かめた。

       ダイキン    列の見出しが室内機の品番（FHCP40〜71GA）
       パナソニック「適用室内ユニット」列（「全機種」「P40〜P80」）＋ページの機種タイプ
       日本キヤリア列の見出しがシリーズ、マスが能力ランク（P40形〜P50形）
       日立        ページの機種タイプ（てんかせ4方向）＋列の見出しが容量（28型〜71型）

     そこで、どの社の書き方も次の形に直してから比べる。
       { all:true }                        …… 全機種に付く
       { im:'FHCP40～71GA' }               …… 室内機の品番の範囲
       { type:'てんかせ4方向', cap:[28,71] } …… 機種タイプ＋容量の範囲
       { series:'ウルトラパワーエコ', cap:[40,50] } …… シリーズ＋容量の範囲
     ==================================================================== */
  // 日立には28型・32型など小さいものがある。ここに無い数字は容量とみなさないので、
  // 抜けていると「28型〜71型」が「71型だけ」になってしまう
  var CAPS = [20, 22, 25, 28, 32, 36, 40, 45, 50, 56, 63, 71, 80, 90, 100, 112, 125, 140, 160,
              180, 200, 224, 250, 280, 335, 400, 450, 500, 560];

  /** 機種データの1行から容量（40・112 など）を取る。
      **室内機の品番を先に見る。**
      別売品（パネル・フィルター・グリル）は室内機に付くもので、
      表の列も室内機の容量で並んでいる。
      ab（224型＝8馬力相当）はシステム全体＝室外機の容量なので、
      ツイン・トリプルのときに実物より何倍も大きくなり、
      **どの列にも当たらず別売品が1つも出なくなる**
      （2026-09-09、RAS-GP224RGH2／RPK-GP56KA×4 で分かった。室内機は56型） */
  function capOfModel(x) {
    if (!x) return 0;
    var im = String(x.im || '').replace(/×\s*\d+\s*$/, '');
    var m = im.match(/(\d{2,3})/);
    if (m && CAPS.indexOf(Number(m[1])) >= 0) return Number(m[1]);
    m = String(x.ab || '').match(/(\d{2,3})\s*[形型]/);
    if (m) return Number(m[1]);
    m = String(x.m || '').match(/(\d{2,3})/);
    return m ? Number(m[1]) : 0;
  }

  /** ゆるく比べる（「てんかせ4方向」と「てんかせ4方向（Jr.除く）」を同じとみなす） */
  function looseSame(a, b) {
    if (!a || !b) return false;
    var s = function (t) {
      return String(t).replace(/[\s　・（）()［］\[\]【】〈〉<>《》]/g, '')
        .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
        // 「天井ビルトインカセット（Eco）」は「天井ビルトインカセット形」と同じ形。
        // 後ろのグレード名だけを外す（形そのものは外さない。
        // 外すと「天井埋込形」と「天井埋込ダクト形」が同じになってしまう）
        .replace(/(Eco|Premium|沖縄専用|沖縄)$/i, '');
    };
    var x = s(a), y = s(b);
    return x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
  }

  /** 室内機の品番のまとめ書き（FHCP40〜71GA）に、その品番が入るか */
  function imInRange(head, imCode) {
    var h = String(head).replace(/\s/g, '');
    var im = String(imCode || '').replace(/\s/g, '').replace(/×\d+$/, '');
    var mh = h.match(/^([A-Z]+)([\d～~〜・,、]+)([A-Z]+)$/);
    var mi = im.match(/^([A-Z]+)(\d{2,3})([A-Z]+)$/);
    if (!mh || !mi) return false;
    if (mh[1] !== mi[1] || mh[3] !== mi[3]) return false;
    var cap = Number(mi[2]), mid = mh[2];
    if (/[～~〜]/.test(mid)) {
      var ab = mid.split(/[～~〜]/);
      return cap >= Number(ab[0]) && cap <= Number(ab[1]) && CAPS.indexOf(cap) >= 0;
    }
    return mid.split(/[・,、]/).map(Number).indexOf(cap) >= 0;
  }

  /* ルームエアコンの別売品の「付く機種」。紙面の見出しは「S22～406ATRS」「S40・566ATRP」「C22～563ATSV」「MP40・453AV」。
     頭（S・C・2M・MP）＋能力＋うしろ（6ATRS）に分けて持つ。機種の品番・室外機・室内機のどれかが入れば付く。
     うしろの字のあとに色の W・K が付く品番（C223ATSVW）も同じ機種として見る */
  function roomCodeIn(f, code) {
    code = String(code || '').replace(/×\d+$/, '');
    if (!f.p || code.indexOf(f.p) !== 0) return false;
    var rest = code.slice(f.p.length);
    if (rest.slice(-f.t.length) !== f.t) {
      if (/[WK]$/.test(rest) && rest.slice(0, -1).slice(-f.t.length) === f.t) rest = rest.slice(0, -1);
      else return false;
    }
    var cap = rest.slice(0, rest.length - f.t.length);
    if (!/^\d{2,3}$/.test(cap)) return false;
    cap = Number(cap);
    return f.r ? (cap >= f.c[0] && cap <= f.c[1]) : f.c.indexOf(cap) >= 0;
  }
  function roomCodeIs(mc, code) {
    code = String(code || '').replace(/×\d+$/, '');
    return code === mc || code === mc + 'W' || code === mc + 'K';
  }

  function optFits(fit, model) {
    if (!fit || !model) return false;
    if (fit.all) return true;
    if (fit.rm) return [model.m, model.om, model.im].some(function (c) { return roomCodeIn(fit.rm, c); });
    if (fit.mc) return [model.m, model.om, model.im].some(function (c) { return roomCodeIs(fit.mc, c); });
    if (fit.im) return imInRange(fit.im, model.im);
    if (fit.type && !looseSame(fit.type, model.i)) return false;
    if (fit.series && !looseSame(fit.series, model.s)) return false;
    if (fit.tp && !looseSame(fit.tp, model.tp)) return false;   // 同時ツイン用の分配管など
    if (fit.cap) {
      var c = capOfModel(model);
      if (!c || c < fit.cap[0] || c > fit.cap[1]) return false;
    }
    return !!(fit.type || fit.series || fit.cap || fit.tp);
  }

  /* --------------------------------------------------------------------
     別売品の仲間分け
     1台の機種に700品目も出ると、現場では選べない。品名で仲間に分ける。
     上から順に見て、最初に当たったものをその品目の仲間とする
     （「化粧パネル用フィルター」はフィルターではなくパネルに入れたくないので、
       フィルターを先に置いてある）
     -------------------------------------------------------------------- */
  var OPT_CATS = [
    ['フィルター', /フィルタ|ろ材|集塵|エレメント/],
    ['パネル・グリル', /パネル|グリル|化粧|ルーバー|吹出口閉鎖/],
    ['リモコン・制御', /リモコン|コントロ|アダプタ|基板|センサ|集中|タイマ|通信|端子|遠方|ケーブル/],
    ['ドレン', /ドレン/],
    ['ダクト・吹出', /ダクト|吹出|チャンバ|フランジ|ガイド|パンカ|ノズル|ホース|エルボ/],
    ['屋外・防雪', /防雪|架台|防振|フード|屋根|network|安全ネット|凍結|ヒータ|散水|背面/],
    ['空気清浄・加湿', /ストリーマ|除菌|脱臭|加湿|空気清浄|UV|イオン|クリーン/],
    ['分岐・分配', /分岐|分配|ディストリビュータ/],
    ['取付・工事部材', /取付|キット|金具|バンド|カバー|スペーサ|延長|接続/]
  ];

  /* 画面に並べる順。仕事でよく使うものから出す。
     （上の OPT_CATS は「どれに入れるか」を決める順で、こちらは「どう並べるか」） */
  var OPT_CAT_ORDER = ['パネル・グリル', 'リモコン・制御', 'フィルター', 'ドレン', '分岐・分配',
                       '空気清浄・加湿', 'ダクト・吹出', '屋外・防雪', '取付・工事部材', 'その他'];

  function optCategory(name) {
    var s = String(name || '');
    for (var i = 0; i < OPT_CATS.length; i++) {
      if (OPT_CATS[i][1].test(s)) return OPT_CATS[i][0];
    }
    return 'その他';
  }

  /** その機種に付く別売品を返す。model は［機器を選ぶ］で選んだ1行 */
  function optionsFor(store, model) {
    var out = [];
    ((store && store.items) || []).forEach(function (o) {
      var ok = false;
      (o.fits || []).forEach(function (f) { if (!ok && optFits(f, model)) ok = true; });
      if (ok) out.push(o);
    });
    return out;
  }

  /* --------------------------------------------------------------------
     別売品のページが「どの機種タイプの別売品か」を決める

     キヤリアのように、別売品のページに機種タイプが書いていない社がある
     （章立てで決まっているので、紙面には書く必要がない）。
     そこで**機種データのページ番号**を使う。機種データはどの価格ページから
     読んだかを持っているので、別売品のページの手前にある価格ページの
     機種タイプが、その別売品の相手になる。

     2026-09-05、キヤリア p.67 の別売品（RBC-UW283PG など）が
     機種データでは天井カセット形2方向の機種にしか使われていないことで確かめた。
     （ページの端の文字から拾う方法は「ダクト」を誤って拾って失敗した）
     -------------------------------------------------------------------- */
  function typeAtPage(pageTypes, page) {
    if (!pageTypes) return '';
    var best = 0, type = '';
    Object.keys(pageTypes).forEach(function (k) {
      var n = Number(k);
      if (n <= page && n > best) { best = n; type = pageTypes[k]; }
    });
    return type;
  }

  /** 「P40形〜P80形」「28型（1.0）〜160型（6.0）」から容量の範囲を取る */
  function capRange(s) {
    var t = String(s || '').replace(/（[^）]*）|\([^)]*\)/g, '').replace(/\s/g, '');
    var nums = (t.match(/\d{2,3}/g) || []).map(Number).filter(function (n) { return CAPS.indexOf(n) >= 0; });
    if (!nums.length) return null;
    if (/[～~〜]/.test(t)) return [Math.min.apply(null, nums), Math.max.apply(null, nums)];
    return [Math.min.apply(null, nums), Math.max.apply(null, nums)];
  }

  window.KUCHOO_CATALOG = { makers: MAKERS, run: run, yen: yen, optionsFor: optionsFor, optFits: optFits, typeAtPage: typeAtPage, optCategory: optCategory, catOrder: OPT_CAT_ORDER,
                            _readPage: { ok: okReadPage, inaba: inabaReadPage, uc: ucReadPage } };
})();
