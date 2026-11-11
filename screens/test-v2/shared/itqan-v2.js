// Itqan v2.1: Classic Modern Academic Interactive Controller
(() => {
  const html = document.documentElement;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  // Language switch
  function setLanguage(lang) {
    const isEn = lang === 'en';
    html.lang = isEn ? 'en' : 'ar';
    html.dir = isEn ? 'ltr' : 'rtl';
    
    document.querySelectorAll('[data-en]').forEach((el) => {
      if (el.dataset.ar === undefined) el.dataset.ar = el.textContent;
      el.textContent = isEn ? el.dataset.en : el.dataset.ar;
    });

    for (const attr of ['placeholder', 'aria-label', 'title']) {
      document.querySelectorAll(`[data-en-${attr}]`).forEach((el) => {
        const key = `ar${attr.replace(/-/g, "")}`;
        if (el.dataset[key] === undefined) el.dataset[key] = el.getAttribute(attr) || '';
        el.setAttribute(attr, isEn ? el.getAttribute(`data-en-${attr}`) : el.dataset[key]);
      });
    }

    if (document.body.dataset.titleEn) {
      if (!document.body.dataset.titleAr) document.body.dataset.titleAr = document.title;
      document.title = isEn ? document.body.dataset.titleEn : document.body.dataset.titleAr;
    }

    document.querySelectorAll('.lang-btn').forEach((b) => {
      b.textContent = isEn ? 'العربية' : 'English';
      b.setAttribute('aria-label', isEn ? 'التبديل إلى اللغة العربية' : 'Switch to English');
    });

    store.set('itqan-v2-lang', lang);
  }

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setLanguage(html.lang === 'en' ? 'ar' : 'en');
    });
  });

  if (store.get('itqan-v2-lang') === 'en') {
    setLanguage('en');
  }

  // Mobile Navigation Toggle
  const mobToggle = document.querySelector('.mobile-nav-toggle');
  const mobDrawer = document.querySelector('.mobile-nav-drawer');
  if (mobToggle && mobDrawer) {
    mobToggle.addEventListener('click', () => {
      const active = mobDrawer.classList.toggle('active');
      mobToggle.setAttribute('aria-expanded', String(active));
      mobToggle.textContent = active ? '✕' : '☰';
    });
  }

  // Password Visibility Toggle
  document.querySelectorAll('.peek-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.textContent = show ? '🙈' : '👁️';
    });
  });

  // Modal Open/Close System
  document.querySelectorAll('[data-modal-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-modal-open');
      const target = document.getElementById(targetId);
      if (target) target.classList.add('active');
    });
  });

  document.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      if (modal) modal.classList.remove('active');
    });
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  });

  // Copy-to-clipboard button with visual feedback
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy');
      try {
        await navigator.clipboard.writeText(text);
        const orig = btn.innerHTML;
        btn.innerHTML = '<span style="color:var(--mint); font-weight:800;">تم النسخ ✓</span>';
        setTimeout(() => btn.innerHTML = orig, 1800);
      } catch (err) {
        alert('تم النسخ: ' + text);
      }
    });
  });

  // Preview States Manager
  function setPreviewState(state) {
    document.body.dataset.state = state;
    document.querySelectorAll('.demo-actions [data-state]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.state === state));
    });
    document.dispatchEvent(new CustomEvent('itqan:state-change', { detail: state }));
  }

  document.querySelectorAll('.demo-actions [data-state]').forEach((btn) => {
    btn.addEventListener('click', () => setPreviewState(btn.dataset.state));
  });

  // Fake Form submit
  document.querySelectorAll('form[data-fake]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (btn) {
        const origText = btn.innerHTML;
        btn.innerHTML = 'جاري التحقق والمصادقة...';
        btn.disabled = true;
        setTimeout(() => {
          btn.innerHTML = origText;
          btn.disabled = false;
          if (form.dataset.fake) setPreviewState(form.dataset.fake);
        }, 900);
      }
    });
  });
})();
