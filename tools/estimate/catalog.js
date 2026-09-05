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
    ['RPK', 'かべかけ'], ['RPFI', 'ゆかおき（埋込形）'], ['RPF', 'ゆかおき'], ['RPV', '外気処理']
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
        opt: x.br ? '別売分岐管 ' + x.br : '',
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
  function nameReader(rows, leftEnd, headY, mode) {
    function chops(cells) {
      var seg = [], cur = null;
      cells.filter(function (o) { return o.x < leftEnd; })
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
          if (mode === 'above' && l.y < y - 2) return;
          var d = Math.abs(l.y - y);
          if (d < bd) { bd = d; best = l; }
        });
        if (best && bd <= (mode === 'above' ? 60 : 30)) parts.push(best.s);
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

    // ページの端の縦書きが、その表の機種タイプ
    var type = '';
    items.forEach(function (o) {
      if (o.x > xPrice + 30 && /形$/.test(o.s) && o.s.length >= 4 && isJa(o.s)) type = o.s;
    });
    // 機種データのページ番号から決めるのがいちばん確か（紙面に書いていない社があるため）
    if (ctx && ctx.pageTypes) {
      var byPage = typeAtPage(ctx.pageTypes, page);
      if (byPage) type = byPage;
    }
    if (!type && types) {
      // ページのどこかに書いてある機種タイプを拾う（キヤリアは端の縦書きが無い）
      var flat = items.map(function (o) { return o.s; }).join('').replace(/s/g, '');
      types.forEach(function (t) { if (!type && flat.indexOf(t.replace(/s/g, '')) >= 0) type = t; });
    }

    // 品名は「大分類 ｜ 品名 ｜ 色」の縦の列。色だけの行でも品名を拾えるようにする
    var nameAt = nameReader(rows, xFit - 25, head.y, 'above');

    rows.forEach(function (r) {
      if (r.y >= head.y - 2) return;

      var code = '', price = 0, fitTxt = '';
      r.cells.forEach(function (c) {
        var s = c.s.trim();
        if (Math.abs(c.x - xCode) < 40 && OPT_CODE.test(s)) code = s;
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
    var nameAt = nameReader(rows, leftEnd, head.y);

    rows.forEach(function (r) {
      if (r.y >= head.y - 20) return;

      var code = '', price = 0;
      r.cells.forEach(function (c) {
        var s = c.s.trim();
        if (c.x >= xCode - 25 && c.x < xPrice - 20 && OPT_CODE.test(s) && !code) code = s;
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
  function optPageHitachi(items, page, out) {
    var rows = optRows(items);

    var type = '';
    rows.forEach(function (r) {
      if (type) return;
      var t = r.cells.map(function (o) { return o.s; }).join('').replace(/\s/g, '');
      var m = t.match(/オプション一覧[（(]([^）)]{2,20})[）)]/);
      if (m) type = m[1];
    });
    if (!type) return;

    var head = null;
    rows.forEach(function (r) {
      if (head) return;
      var t = r.cells.map(function (o) { return o.s; }).join('').replace(/\s/g, '');
      if (/容量[・･]型名/.test(t)) head = r;
    });
    if (!head) return;

    // 見出しの行を x のすき間で切って、列（容量の範囲）にする
    var cols = [], cur = null;
    head.cells.forEach(function (c) {
      if (/容量|型名|相当馬力/.test(c.s)) return;
      if (!cur || c.x - cur.right > 60) { cur = { x: c.x, right: c.x, s: c.s }; cols.push(cur); }
      else { cur.s += c.s; cur.right = c.x; }
    });
    cols = cols.map(function (c) { return { x: c.x, cap: capRange(c.s) }; })
      .filter(function (c) { return c.cap; });
    if (!cols.length) return;

    var nameAt = nameReader(rows, cols[0].x - 20, head.y);

    rows.forEach(function (r) {
      if (r.y >= head.y - 2) return;
      var name = nameAt(r.y);

      r.cells.forEach(function (o, i) {
        var s = o.s.trim();
        if (!OPT_CODE.test(s)) return;
        var price = 0;
        for (var j = i + 1; j < r.cells.length; j++) {
          var t = r.cells[j].s.trim();
          if (OPT_CODE.test(t)) break;
          var mm = t.match(OPT_MONEY);
          if (mm) { price = yen(mm[1]); break; }
        }
        if (!price) return;
        var col = null, bd = 1e9;
        cols.forEach(function (k) { var d = Math.abs(k.x - o.x); if (d < bd) { bd = d; col = k; } });
        if (!col || bd > 110) return;
        out.push({ page: page, name: name, code: s, y: price, fits: [{ type: type, cap: col.cap }] });
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
        var label = '', code = '', price = 0;
        cells.forEach(function (c) {
          var s = c.s.trim();
          if (!code) {
            if (MITSU_CODE.test(s)) { code = s; return; }
            if (isJa(s)) label += s;
            return;
          }
          if (!price) {
            var m = s.match(OPT_MONEY);
            if (m) price = yen(m[1]);
          }
        });
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
      readPage: function (items, page, ctx) { var out = []; optPagePana(items, page, out, null, ctx); return out; },
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
        // キヤリアは表が2種類ある。室内機用（適用室内ユニット列）と室外機用（列＝シリーズ）
        optPagePana(items, page, out, {
          codeWord: /部品形名/, priceWord: /価格/,
          types: ['天井カセット形4方向', '天井カセット形2方向', '天井カセット形1方向',
                  '天井吊形', '壁掛形', 'ビルトイン', 'ダクト', '床置形', '厨房用天井吊形']
        }, ctx);
        // 室内機用の表が無いページは、室外機用（列＝シリーズ）として読み直す
        if (!out.length) optPageCarrier(items, page, out);
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
        optPageMitsu(items, page, out);          // 機種ページの構成品（パネル・リモコン）
        optPageMitsuCommon(items, page, out);   // 共通別売部品（分配管など・144ページ）
        return out;
      },
      finish: function (list) { return optResult(list, '三菱電機', 'Mr.SLIM 別売品'); }
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

  /** 機種データの1行から容量（40・112 など）を取る */
  function capOfModel(x) {
    if (!x) return 0;
    var m = String(x.ab || '').match(/(\d{2,3})\s*[形型]/);
    if (m) return Number(m[1]);
    m = String(x.im || '').match(/(\d{2,3})/);
    if (m) return Number(m[1]);
    m = String(x.m || '').match(/(\d{2,3})/);
    return m ? Number(m[1]) : 0;
  }

  /** ゆるく比べる（「てんかせ4方向」と「てんかせ4方向（Jr.除く）」を同じとみなす） */
  function looseSame(a, b) {
    if (!a || !b) return false;
    var s = function (t) {
      return String(t).replace(/[\s　・（）()［］\[\]【】]/g, '')
        .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
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

  function optFits(fit, model) {
    if (!fit || !model) return false;
    if (fit.all) return true;
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

  window.KUCHOO_CATALOG = { makers: MAKERS, run: run, yen: yen, optionsFor: optionsFor, optFits: optFits, typeAtPage: typeAtPage };
})();
