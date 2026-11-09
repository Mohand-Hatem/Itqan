// Itqan test screens: language switch, password peek, fake form submit, preview states.
(() => {
  const html = document.documentElement;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  // ---- language: Arabic lives in the markup, English in data-en* attributes ----
  function setLang(lang) {
    const en = lang === 'en';
    html.lang = en ? 'en' : 'ar';
    html.dir = en ? 'ltr' : 'rtl';
    document.querySelectorAll('[data-en]').forEach((el) => {
      if (el.dataset.ar === undefined) el.dataset.ar = el.textContent;
      el.textContent = en ? el.dataset.en : el.dataset.ar;
    });
    for (const attr of ['placeholder', 'aria-label', 'title']) {
      document.querySelectorAll(`[data-en-${attr}]`).forEach((el) => {
        const key = `ar${attr.replace(/-/g, "")}`; // dataset keys cannot hold "-x"
        if (el.dataset[key] === undefined) el.dataset[key] = el.getAttribute(attr) || '';
        el.setAttribute(attr, en ? el.getAttribute(`data-en-${attr}`) : el.dataset[key]);
      });
    }
    if (document.body.dataset.titleEn) {
      if (!document.body.dataset.titleAr) document.body.dataset.titleAr = document.title;
      document.title = en ? document.body.dataset.titleEn : document.body.dataset.titleAr;
    }
    document.querySelectorAll('.lang').forEach((b) => {
      b.textContent = en ? 'العربية' : 'English';
      b.setAttribute('aria-label', en ? 'التبديل إلى العربية' : 'Switch to English');
    });
    store.set('itqan-lang', lang);
  }
  document.querySelectorAll('.lang').forEach((b) =>
    b.addEventListener('click', () => setLang(html.lang === 'en' ? 'ar' : 'en')));
  if (store.get('itqan-lang') === 'en') setLang('en');

  // ---- show / hide password ----
  document.querySelectorAll('.peek').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.querySelector('.eye-open').style.display = show ? 'none' : '';
      btn.querySelector('.eye-shut').style.display = show ? '' : 'none';
    });
  });

  // ---- access-code input: uppercase, group as XXXX-XXXX-XXXX ----
  document.querySelectorAll('input.code').forEach((input) => {
    input.addEventListener('input', () => {
      const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      input.value = raw.match(/.{1,4}/g)?.join('-') ?? '';
    });
  });

  // ---- fake submit: validate, show errors under each field, then flip page state ----
  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  function check(input) {
    const v = input.value.trim();
    let bad = false;
    if (input.type === 'checkbox') bad = input.required && !input.checked;
    else if (input.required && !v) bad = true;
    else if (input.type === 'email' && !isEmail(v)) bad = true;
    else if (input.minLength > 0 && v.length < input.minLength) bad = true;
    else if (input.dataset.match) bad = v !== document.getElementById(input.dataset.match).value;
    const err = document.getElementById(input.getAttribute('aria-describedby')?.split(' ').find((id) => id.startsWith('err-')));
    input.setAttribute('aria-invalid', String(bad));
    err?.classList.toggle('show', bad);
    return !bad;
  }
  document.querySelectorAll('form[data-fake]').forEach((form) => {
    form.noValidate = true;
    form.querySelectorAll('input').forEach((i) =>
      i.addEventListener('blur', () => { if (i.getAttribute('aria-invalid')) check(i); }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const inputs = [...form.querySelectorAll('input[required], input[minlength], input[data-match]')];
      const results = inputs.map(check);
      const firstBad = inputs[results.indexOf(false)];
      if (firstBad) { firstBad.focus(); return; }
      const btn = form.querySelector('button[type="submit"]');
      btn.setAttribute('aria-busy', 'true');
      setTimeout(() => {
        btn.removeAttribute('aria-busy');
        if (form.dataset.fake) setState(form.dataset.fake);
      }, 1100);
    });
  });

  // ---- preview states (body[data-state] drives CSS) ----
  function setState(state) {
    document.body.dataset.state = state;
    document.querySelectorAll('.demo [data-state]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.state === state)));
    document.dispatchEvent(new CustomEvent('itqan:state', { detail: state }));
  }
  document.querySelectorAll('.demo [data-state]').forEach((b) =>
    b.addEventListener('click', () => setState(b.dataset.state)));
  window.itqanSetState = setState;
})();
