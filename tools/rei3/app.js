/* ==========================================================================
   冷凍王｜第三種冷凍機械 過去問
   --------------------------------------------------------------------------
   問題データは、この端末のブラウザの中（localStorage）にだけ置く。
   このファイルにも、GitHubにも、問題文は一切入っていない。
   KHKが公開した試験問題を自分の勉強に使うためのもので、
   公開の場に置くと転載になるため、あえてこの作りにしている。
   ========================================================================== */
(function () {
  'use strict';

  var KEY_Q  = 'rei3_questions_v1';   // 問題そのもの
  var KEY_P  = 'rei3_progress_v1';    // 1問ごとの成績
  var KEY_M  = 'rei3_memo_v1';        // 自分で書いたメモ
  var EXAM   = '2026-11-08';          // 試験日（残り日数の表示に使う）

  var $  = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function load(key, dflt) {
    try { var v = localStorage.getItem(key); return v == null ? dflt : JSON.parse(v); }
    catch (e) { return dflt; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast('保存できませんでした。ブラウザの空きが足りないかもしれません'); return false; }
  }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-show'); }, 2400);
  }

  /* ======================================================================
     データ
     ====================================================================== */
  var questions = load(KEY_Q, []);
  var progress  = load(KEY_P, {});
  var memos     = load(KEY_M, {});

  /** その問題の成績。無ければ空の形を返す */
  function prog(id) {
    return progress[id] || { seen: 0, ok: 0, ng: 0, lastWrong: false };
  }

  function saveProgress() { save(KEY_P, progress); }

  var memoTimer;
  function saveMemos() {
    clearTimeout(memoTimer);
    memoTimer = setTimeout(function () { save(KEY_M, memos); }, 400);
  }

  /* ======================================================================
     残り日数
     ====================================================================== */
  function renderCountdown() {
    var today = new Date();
    var exam = new Date(EXAM + 'T00:00:00');
    var days = Math.ceil((exam - today) / 86400000);
    var box = $('#countdown');
    if (days > 0) {
      box.innerHTML = '';
      box.appendChild(el('span', null, '試験まで'));
      box.appendChild(el('b', null, days + '日'));
    } else if (days === 0) {
      box.textContent = '今日が試験日です';
    } else {
      box.textContent = '';
    }
  }

  /* ======================================================================
     画面の切り替え
     ====================================================================== */
  function show(name) {
    $$('.view').forEach(function (v) { v.classList.remove('is-active'); });
    $('#view-' + name).classList.add('is-active');
    window.scrollTo(0, 0);
  }

  /* ======================================================================
     ホーム
     ====================================================================== */
  function renderHome() {
    var has = questions.length > 0;
    $('#card-empty').style.display = has ? 'none' : '';
    $('#card-start').style.display = has ? '' : 'none';
    if (!has) return;

    // 成績のならび
    var seen = 0, weak = 0;
    questions.forEach(function (q) {
      var p = prog(q.id);
      if (p.seen) seen++;
      if (isWeak(q)) weak++;
    });
    var box = $('#stat-row');
    box.innerHTML = '';
    box.appendChild(stat(questions.length, '問題', ''));
    box.appendChild(stat(seen, '解いた', seen === questions.length ? 'good' : ''));
    box.appendChild(stat(weak, '要復習', weak ? 'warm' : 'good'));
    box.appendChild(stat(Object.keys(memos).length, 'メモ', ''));

    $('#mode-weak-n').textContent = weak + '問';
    $('#mode-all-n').textContent = questions.length + '問';

    fillFilter('#f-subject', 'subject');
    fillFilter('#f-year', 'year');
  }

  function stat(n, label, cls) {
    var d = el('div', 'stat' + (cls ? ' ' + cls : ''));
    d.appendChild(el('b', null, String(n)));
    d.appendChild(el('span', null, label));
    return d;
  }

  function fillFilter(sel, field) {
    var node = $(sel);
    var keep = node.value;
    var vals = [];
    questions.forEach(function (q) {
      if (q[field] && vals.indexOf(q[field]) < 0) vals.push(q[field]);
    });
    vals.sort();
    node.innerHTML = '';
    node.appendChild(new Option('ぜんぶ', ''));
    vals.forEach(function (v) { node.appendChild(new Option(labelOf(field, v), v)); });
    if (vals.indexOf(keep) >= 0) node.value = keep;
  }

  /** R7 のような略号を、読める形にする */
  function labelOf(field, v) {
    if (field !== 'year') return v;
    var m = String(v).match(/^R(\d+)$/);
    return m ? '令和' + m[1] + '年度' : v;
  }

  /**
   * 「要復習」の判定。
   * まだ解いていない問題と、直近で間違えた問題を対象にする。
   * 一度正解しても、その前に間違えていれば、しばらくは対象に残す。
   */
  function isWeak(q) {
    var p = prog(q.id);
    if (!p.seen) return true;
    if (p.lastWrong) return true;
    return p.ng > 0 && p.ok < 2;   // 間違えた履歴があり、まだ2回続けて正解していない
  }

  /* ======================================================================
     出題
     ====================================================================== */
  var quiz = null;   // { list, at, answers[] }

  function filtered() {
    var s = $('#f-subject').value;
    var y = $('#f-year').value;
    return questions.filter(function (q) {
      if (s && q.subject !== s) return false;
      if (y && q.year !== y) return false;
      return true;
    });
  }

  function shuffle(a) {
    var r = a.slice();
    for (var i = r.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = r[i]; r[i] = r[j]; r[j] = t;
    }
    return r;
  }

  function start(list, mode) {
    if (!list.length) { toast('出せる問題がありません'); return; }
    quiz = { list: list, at: 0, answers: [], mode: mode };
    show('quiz');
    renderQuestion();
  }

  function renderQuestion() {
    var q = quiz.list[quiz.at];

    $('#q-pos').textContent = (quiz.at + 1) + ' / ' + quiz.list.length;
    $('#q-tag').textContent = labelOf('year', q.year) + '　' + q.subject + ' 問' + q.no;
    $('#q-stem').textContent = q.stem;

    var ul = $('#q-items');
    ul.innerHTML = '';
    (q.items || []).forEach(function (t) { ul.appendChild(el('li', null, t)); });

    var box = $('#q-choices');
    box.className = 'choices';
    box.innerHTML = '';
    (q.choices || []).forEach(function (c, i) {
      var b = el('button', 'choice');
      b.type = 'button';
      b.appendChild(el('span', 'n', String(i + 1)));
      b.appendChild(el('span', null, c));
      b.addEventListener('click', function () { answer(i + 1); });
      box.appendChild(b);
    });

    var v = $('#q-verdict');
    v.className = 'verdict';
    v.innerHTML = '';
    $('#q-memo').style.display = 'none';
    $('#q-memo').innerHTML = '';
    $('#btn-next').style.display = 'none';
  }

  function answer(picked) {
    var q = quiz.list[quiz.at];
    var box = $('#q-choices');
    if (box.classList.contains('is-done')) return;
    box.classList.add('is-done');

    var correct = Number(q.answer);
    var right = picked === correct;

    Array.prototype.forEach.call(box.children, function (b, i) {
      if (i + 1 === correct) b.classList.add('is-answer');
      else if (i + 1 === picked) b.classList.add('is-wrong');
    });

    // 成績を記録する
    var p = prog(q.id);
    p.seen++;
    if (right) { p.ok++; p.lastWrong = false; }
    else { p.ng++; p.ok = 0; p.lastWrong = true; }
    progress[q.id] = p;
    saveProgress();

    quiz.answers.push({ q: q, picked: picked, right: right });

    var v = $('#q-verdict');
    v.className = 'verdict show ' + (right ? 'ok' : 'ng');
    v.textContent = right ? '正解' : '不正解　正しくは (' + correct + ')';
    if (!right) {
      var s = el('small', null, '答えは「' + (q.choices[correct - 1] || '') + '」です');
      v.appendChild(s);
    }

    renderMemo(q);

    var btn = $('#btn-next');
    btn.style.display = '';
    btn.textContent = (quiz.at + 1 >= quiz.list.length) ? '結果を見る' : '次の問題へ';
  }

  /**
   * 自分メモ。答え合わせのあとだけ出す（先に見えると答えが分かってしまう）。
   * 解説をこちらで書くと法令の読み違いを教えてしまう恐れがあるので、
   * 自分の言葉で書いてもらう形にしている。書くこと自体が覚えることにもなる。
   */
  function renderMemo(q) {
    var box = $('#q-memo');
    box.innerHTML = '';
    box.style.display = '';

    var has = (memos[q.id] || '').trim();
    var head = el('div', 'memo-head');
    head.appendChild(el('span', null, has ? '前に書いたメモ' : 'メモ（なぜそうなるか、自分の言葉で）'));
    box.appendChild(head);

    var ta = el('textarea', 'memo-input');
    ta.rows = has ? 3 : 2;
    ta.value = memos[q.id] || '';
    ta.placeholder = '例：35度で1MPa以上になるなら、今の圧力が低くても高圧ガス';
    ta.addEventListener('input', function () {
      var v = ta.value;
      if (v.trim()) memos[q.id] = v; else delete memos[q.id];
      saveMemos();
    });
    box.appendChild(ta);
  }

  $('#btn-next').addEventListener('click', function () {
    quiz.at++;
    if (quiz.at >= quiz.list.length) { renderResult(); show('result'); }
    else renderQuestion();
  });

  $('#btn-quit').addEventListener('click', function () {
    if (quiz && quiz.answers.length && !confirm('やめますか？ここまでの成績は残ります。')) return;
    quiz = null;
    renderHome();
    show('home');
  });

  /* ======================================================================
     結果
     ====================================================================== */
  function renderResult() {
    var a = quiz.answers;
    var ok = a.filter(function (x) { return x.right; }).length;
    var rate = a.length ? Math.round((ok / a.length) * 100) : 0;

    var s = $('#r-score');
    s.className = 'score ' + (rate >= 60 ? 'pass' : 'fail');
    s.innerHTML = '';
    s.appendChild(el('b', null, ok + ' / ' + a.length));
    s.appendChild(el('span', null, '正答率 ' + rate + '％　（合格は各科目60％）'));

    var d = $('#r-detail');
    d.innerHTML = '';

    // 本番と同じ形のときは、科目ごとに合否を出す
    if (quiz.mode === 'exam') {
      var row = el('div', 'subject-score');
      ['法令', '保安管理技術'].forEach(function (sub) {
        var list = a.filter(function (x) { return x.q.subject === sub; });
        if (!list.length) return;
        var n = list.filter(function (x) { return x.right; }).length;
        var pass = (n / list.length) >= 0.6;
        var c = el('div', 's ' + (pass ? 'pass' : 'fail'));
        c.appendChild(el('b', null, n + '/' + list.length));
        c.appendChild(el('span', null, sub + '　' + (pass ? '合格' : '不合格')));
        row.appendChild(c);
      });
      d.appendChild(row);
    }

    var wrong = a.filter(function (x) { return !x.right; });
    if (wrong.length) {
      d.appendChild(el('h3', 'card-title', '間違えた ' + wrong.length + '問'));
      var ul = el('ul', 'rlist');
      wrong.forEach(function (x) {
        var li = el('li');
        li.appendChild(el('b', null, labelOf('year', x.q.year) + '　' + x.q.subject + ' 問' + x.q.no));
        li.appendChild(document.createTextNode(x.q.stem));
        ul.appendChild(li);
      });
      d.appendChild(ul);
    }

    $('#btn-again').style.display = wrong.length ? '' : 'none';
    $('#btn-again').onclick = function () {
      start(shuffle(wrong.map(function (x) { return x.q; })), 'weak');
    };
  }

  $('#btn-home').addEventListener('click', function () {
    quiz = null;
    renderHome();
    show('home');
  });

  /* ======================================================================
     モードのボタン
     ====================================================================== */
  $('#mode-weak').addEventListener('click', function () {
    start(shuffle(filtered().filter(isWeak)), 'weak');
  });

  $('#mode-all').addEventListener('click', function () {
    start(shuffle(filtered()), 'all');
  });

  $('#mode-exam').addEventListener('click', function () {
    // 年度を1つ選んで、法令→保安の順に本番と同じ並びで出す
    var y = $('#f-year').value;
    var years = [];
    questions.forEach(function (q) { if (years.indexOf(q.year) < 0) years.push(q.year); });
    if (!y) y = years.sort().reverse()[0];
    var list = questions
      .filter(function (q) { return q.year === y; })
      .sort(function (p, q) {
        if (p.subject !== q.subject) return p.subject === '法令' ? -1 : 1;
        return p.no - q.no;
      });
    if (!list.length) { toast('その年度の問題がありません'); return; }
    toast(labelOf('year', y) + ' を通しで出します');
    start(list, 'exam');
  });

  /* ======================================================================
     問題の取り込み
     ====================================================================== */
  function adopt(data, mode) {
    var incoming = Array.isArray(data) ? data : (data && data.questions);
    if (!Array.isArray(incoming) || !incoming.length) {
      toast('問題の形式が違います'); return;
    }
    var bad = incoming.filter(function (q) {
      return !q.id || !q.stem || !Array.isArray(q.choices) || !q.answer;
    });
    if (bad.length) { toast('中身が足りない問題が ' + bad.length + '件あります'); return; }

    if (mode === 'add') {
      var have = {};
      questions.forEach(function (q) { have[q.id] = true; });
      var add = incoming.filter(function (q) { return !have[q.id]; });
      if (!add.length) { toast('新しい問題はありませんでした'); return; }
      questions = questions.concat(add);
      if (!save(KEY_Q, questions)) return;
      toast(add.length + '問を足しました（合計 ' + questions.length + '問）');
    } else {
      questions = incoming;
      if (!save(KEY_Q, questions)) return;
      toast(questions.length + '問を入れました');
    }
    renderHome();
  }

  function readFile(input, mode) {
    var f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    var r = new FileReader();
    r.onerror = function () { toast('ファイルを読み込めませんでした'); };
    r.onload = function () {
      var data;
      try { data = JSON.parse(r.result); }
      catch (e) { toast('ファイルの形式が違います（JSONではありません）'); return; }
      adopt(data, mode);
    };
    r.readAsText(f);
  }

  $('#file-import').addEventListener('change', function (ev) { readFile(ev.target, 'replace'); });
  $('#file-add').addEventListener('change', function (ev) { readFile(ev.target, 'add'); });

  $('#btn-paste').addEventListener('click', function () {
    var t = $('#paste-area').value.trim();
    if (!t) { toast('貼り付けてから押してください'); return; }
    var data;
    try { data = JSON.parse(t); }
    catch (e) { toast('形式が違います（JSONではありません）'); return; }
    adopt(data, 'replace');
    $('#paste-area').value = '';
  });

  $('#btn-reset').addEventListener('click', function () {
    if (!confirm('成績を消します。問題そのものは残ります。よろしいですか？')) return;
    progress = {};
    saveProgress();
    renderHome();
    toast('成績を消しました（メモは残してあります）');
  });

  /* ======================================================================
     はじめ
     ====================================================================== */
  renderCountdown();
  renderHome();
  show('home');
})();
