// ==========================================================================
// BREEZEAIR - Interactive Scripts
// ==========================================================================

// ---------- Auto-trim logo via Canvas ----------
function renderTrimmedLogo(canvasId, opts) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.LOGO_B64) return;
  opts = opts || {};
  const transparentWhite = !!opts.transparentWhite;

  const img = new Image();
  img.onload = () => {
    const off = document.createElement('canvas');
    off.width = img.width;
    off.height = img.height;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0);

    let imgData;
    try {
      imgData = octx.getImageData(0, 0, img.width, img.height);
    } catch (e) {
      return;
    }
    const data = imgData.data;

    let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
    const w = img.width, h = img.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const a = data[i + 3];
        if (a < 20) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const isWhite = (r > 235 && g > 235 && b > 235);
        if (isWhite) {
          if (transparentWhite) data[i + 3] = 0;
          continue;
        }
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (minX >= maxX || minY >= maxY) return;

    if (transparentWhite) {
      // soften remaining near-white halo by lowering alpha proportionally
      for (let p = 0; p < data.length; p += 4) {
        if (data[p + 3] === 0) continue;
        const r = data[p], g = data[p + 1], b = data[p + 2];
        const minC = Math.min(r, g, b);
        if (minC > 200) {
          // very light pixel — reduce alpha
          data[p + 3] = Math.round(data[p + 3] * (1 - (minC - 200) / 55));
        }
      }
      octx.putImageData(imgData, 0, 0);
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;

    const cssH = canvas.clientHeight || 100;
    const cssW = Math.round((bw / bh) * cssH);
    const dpr = window.devicePixelRatio || 1;
    const ratio = dpr * 2;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = cssW * ratio;
    canvas.height = cssH * ratio;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const source = transparentWhite ? off : img;
    ctx.drawImage(source, minX, minY, bw, bh, 0, 0, canvas.width, canvas.height);
  };
  img.src = 'data:image/png;base64,' + window.LOGO_B64;
}

function renderAllLogos() {
  renderTrimmedLogo('logoCanvas');
  renderTrimmedLogo('logoCanvasFooter', { transparentWhite: true });
}

document.addEventListener('DOMContentLoaded', () => {
  renderAllLogos();
  window.addEventListener('resize', () => {
    clearTimeout(window.__logoResizeT);
    window.__logoResizeT = setTimeout(renderAllLogos, 200);
  });


  // ---------- Header scroll effect ----------
  const header = document.getElementById('site-header');
  let lastScroll = 0;

  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    if (currentScroll > 20) {
      header.style.boxShadow = '0 2px 16px rgba(26, 29, 33, 0.06)';
    } else {
      header.style.boxShadow = 'none';
    }
    lastScroll = currentScroll;
  });

  // ---------- Hamburger menu ----------
  const hamburger = document.getElementById('hamburger');
  const nav = document.getElementById('global-nav');

  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    nav.classList.toggle('active');
    document.body.style.overflow = nav.classList.contains('active') ? 'hidden' : '';
  });

  // Close menu on nav link click
  nav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('active');
      nav.classList.remove('active');
      document.body.style.overflow = '';
    });
  });

  // ---------- Service tabs ----------
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${target}`).classList.add('active');
    });
  });

});

// ---------- Google Form submission ----------
// 1) Googleフォームを作成し、各設問の「entry.XXXXXXXX」IDをここに貼ってください
// 2) FORM_ID は https://docs.google.com/forms/d/e/{ここ}/viewform の中央部分
const GOOGLE_FORM = {
  formId: '1FAIpQLSdD_BU7LCAuMbhaxTQ_nsnS86GZIN2RZRSZdTEQ4NxhGVQgUA',
  entries: {
    name:    'entry.818911504',   // お名前
    company: 'entry.2096773733',  // 会社名・屋号
    email:   'entry.1551612412',  // メールアドレス
    service: 'entry.935337703',   // ご希望のサービス
    message: 'entry.1328524443'   // ご要望・ご質問
  }
};

function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const toast = document.getElementById('toast');
  const selectedService = form.service ? form.service.value : '';

  const data = new FormData();
  data.append(GOOGLE_FORM.entries.name,    form.name.value || '');
  data.append(GOOGLE_FORM.entries.company, form.company.value || '');
  data.append(GOOGLE_FORM.entries.email,   form.email.value || '');
  data.append(GOOGLE_FORM.entries.service, selectedService);
  data.append(GOOGLE_FORM.entries.message, form.message.value || '');

  const url = `https://docs.google.com/forms/d/e/${GOOGLE_FORM.formId}/formResponse`;

  // GoogleフォームはCORSを返さないので no-cors で投げる（レスポンス内容は読めないが送信は成功する）
  fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    body: data
  }).finally(() => {
    trackContactEvent('form', selectedService || 'contact_form');
    toast.classList.add('show');
    form.reset();
    setTimeout(() => toast.classList.remove('show'), 3500);
  });
}

// ---------- Contact conversion tracking (GA4) ----------
// tel / LINE / メールフォームの問い合わせ行動を GA4 に記録
function trackContactEvent(method, label, extra) {
  if (typeof gtag !== 'function') return;
  try {
    const params = Object.assign({
      method: method,
      contact_method: method,
      event_category: 'contact',
      event_label: label || method,
      page_path: location.pathname
    }, extra || {});
    // 標準推奨イベント名（GA4 で自動的にコンバージョン化しやすい）
    gtag('event', 'generate_lead', params);
    // 手法別の詳細イベント（フィルタリング用）
    gtag('event', 'contact_' + method + '_click', params);
  } catch (_) {
    // no-op — 計測失敗はサイト機能を止めない
  }
}

// クリック委譲: すべての a[href] を監視
document.addEventListener('click', function (e) {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (href.indexOf('tel:') === 0) {
    trackContactEvent('tel', href.replace('tel:', '').trim());
  } else if (/lin\.ee\//i.test(href) || /line\.me\//i.test(href)) {
    trackContactEvent('line', 'friend_add');
  }
});
