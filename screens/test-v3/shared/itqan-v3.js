/**
 * ITQAN ACADEMIC SUITE v3 — Interactive Core Engine
 * Bilingual Synchronization, Modal Controller, Mobile Drawer, and State Simulation
 */

(function () {
  'use strict';

  // --- 1. Bilingual RTL/LTR Synchronization ---
  const LANG_KEY = 'itqan_lang_v3';

  function applyLanguage(lang) {
    const isEn = lang === 'en';
    document.documentElement.lang = isEn ? 'en' : 'ar';
    document.documentElement.dir = isEn ? 'ltr' : 'rtl';

    // Update text elements with data-en
    document.querySelectorAll('[data-en]').forEach((el) => {
      if (!el.dataset.ar) {
        el.dataset.ar = el.innerHTML;
      }
      el.innerHTML = isEn ? el.dataset.en : el.dataset.ar;
    });

    // Update language toggle buttons
    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.textContent = isEn ? 'العربية' : 'English';
      btn.setAttribute('aria-label', isEn ? 'التبديل إلى العربية' : 'Switch to English');
    });

    // Page title translation
    const pageTitleEn = document.body.dataset.titleEn;
    if (pageTitleEn) {
      if (!document.body.dataset.titleAr) {
        document.body.dataset.titleAr = document.title;
      }
      document.title = isEn ? pageTitleEn : document.body.dataset.titleAr;
    }

    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {}
  }

  // --- 2. Mobile Drawer Navigation ---
  function initMobileDrawer() {
    const toggleBtn = document.querySelector('.mobile-nav-toggle');
    const drawer = document.querySelector('.mobile-nav-drawer');

    if (!toggleBtn || !drawer) return;

    // Create backdrop if not already created
    let backdrop = document.querySelector('.drawer-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'drawer-backdrop';
      document.body.appendChild(backdrop);
    }

    function openDrawer() {
      drawer.classList.add('open');
      backdrop.classList.add('active');
      document.body.style.overflow = 'hidden';
      toggleBtn.setAttribute('aria-expanded', 'true');
    }

    function closeDrawer() {
      drawer.classList.remove('open');
      backdrop.classList.remove('active');
      document.body.style.overflow = '';
      toggleBtn.setAttribute('aria-expanded', 'false');
    }

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = drawer.classList.contains('open');
      if (isOpen) closeDrawer();
      else openDrawer();
    });

    backdrop.addEventListener('click', closeDrawer);

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) {
        closeDrawer();
      }
    });

    // Close drawer when clicking any link inside
    drawer.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeDrawer);
    });
  }

  // --- 3. Modal System ---
  function initModals() {
    document.addEventListener('click', (e) => {
      const openBtn = e.target.closest('[data-modal-open]');
      if (openBtn) {
        e.preventDefault();
        const modalId = openBtn.getAttribute('data-modal-open');
        const modal = document.getElementById(modalId);
        if (modal) {
          modal.classList.add('open');
          document.body.style.overflow = 'hidden';
          const firstInput = modal.querySelector('input, textarea, button');
          if (firstInput) firstInput.focus();
        }
      }

      const closeBtn = e.target.closest('[data-modal-close]');
      if (closeBtn) {
        e.preventDefault();
        const modal = closeBtn.closest('.modal-overlay');
        if (modal) {
          modal.classList.remove('open');
          document.body.style.overflow = '';
        }
      }

      // Close when clicking directly on overlay backdrop
      if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('open');
        document.body.style.overflow = '';
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openModal = document.querySelector('.modal-overlay.open');
        if (openModal) {
          openModal.classList.remove('open');
          document.body.style.overflow = '';
        }
      }
    });
  }

  // --- 4. Toast Feedback Notification ---
  function showToast(message) {
    let toast = document.querySelector('.toast-notice');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast-notice';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  // --- 5. Copy to Clipboard ---
  function initCopyButtons() {
    document.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('[data-copy]');
      if (copyBtn) {
        const text = copyBtn.getAttribute('data-copy');
        navigator.clipboard.writeText(text).then(() => {
          showToast(`تم نسخ المعادلة بنجاح: ${text}`);
          const original = copyBtn.innerText;
          copyBtn.innerText = 'تم النسخ ✓';
          setTimeout(() => {
            copyBtn.innerText = original;
          }, 1800);
        });
      }
    });
  }

  // --- 6. Demo Toolbar Runtime State Simulator ---
  function initDemoToolbar() {
    const toolbar = document.querySelector('.demo-toolbar');
    if (!toolbar) return;

    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('.demo-btn');
      if (!btn) return;

      const state = btn.getAttribute('data-state');
      document.body.setAttribute('data-state', state);

      toolbar.querySelectorAll('.demo-btn').forEach((b) => {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });

      showToast(`تم التبديل إلى الحالة: ${btn.textContent.trim()}`);
    });
  }

  // --- Initialize Everything on DOM Ready ---
  document.addEventListener('DOMContentLoaded', () => {
    // Check saved language
    let savedLang = 'ar';
    try {
      savedLang = localStorage.getItem(LANG_KEY) || 'ar';
    } catch (e) {}
    applyLanguage(savedLang);

    // Language switch click listener
    document.addEventListener('click', (e) => {
      const langBtn = e.target.closest('.lang-btn');
      if (langBtn) {
        const currentLang = document.documentElement.lang === 'en' ? 'en' : 'ar';
        const nextLang = currentLang === 'ar' ? 'en' : 'ar';
        applyLanguage(nextLang);
      }
    });

    initMobileDrawer();
    initModals();
    initCopyButtons();
    initDemoToolbar();
  });

  window.ItqanV3 = {
    applyLanguage,
    showToast
  };
})();
