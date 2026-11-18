// Itqan staff dashboard shell: icon sprite, side nav, collapse, phone drawer, dropdowns.
// Load before ../test/shared/itqan.js so the language switch also covers what this file injects.
(() => {
  // Lucide icons (lucide-static 0.469.0, ISC licence), the set shadcn/ui ships with
  const icons = {
    'award': '<path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/>',
    'bell': '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
    'book-open': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    'check': '<path d="M20 6 9 17l-5-5"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'clipboard-check': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    'clipboard-pen-line': '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-.5"/><path d="M16 4h2a2 2 0 0 1 1.73 1"/><path d="M8 18h1"/><path d="M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
    'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    'languages': '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
    'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    'library-big': '<rect width="8" height="18" x="3" y="3" rx="1"/><path d="M7 3v18"/><path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z"/>',
    'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    'menu': '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
    'monitor-x': '<path d="m14.5 12.5-5-5"/><path d="m9.5 12.5 5-5"/><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M12 17v4"/><path d="M8 21h8"/>',
    'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    'smartphone': '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
    'user-round-cog': '<path d="M2 21a8 8 0 0 1 10.434-7.62"/><circle cx="10" cy="8" r="5"/><circle cx="18" cy="18" r="3"/><path d="m19.5 14.3-.4.9"/><path d="m16.9 20.8-.4.9"/><path d="m21.7 19.5-.9-.4"/><path d="m15.2 16.9-.9-.4"/><path d="m21.7 16.5-.9.4"/><path d="m15.2 19.1-.9.4"/><path d="m19.5 21.7-.4-.9"/><path d="m16.9 15.2-.4-.9"/>',
    'user-round-plus': '<path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="M19 16v6"/><path d="M22 19h-6"/>',
    'user-round': '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    'users-round': '<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/>',
    'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'zoom-in': '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
    'zoom-out': '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>',
    'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    'inbox': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    'megaphone': '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    'reply': '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
    'send': '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    'pause': '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    'play': '<polygon points="6 3 20 12 6 21 6 3"/>',
    'check-check': '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
    'log-in': '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/>',
    'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    'key-round': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'mail': '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    'monitor': '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    'palette': '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
    'panels-top-left': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
    'phone': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    'save': '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
    'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    'globe': '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    'archive': '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'book-marked': '<path d="M10 2v8l3-3 3 3V2"/><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'clock-3': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16.5 12"/>',
    'cloud-upload': '<path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    'ellipsis': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    'file-question': '<path d="M12 17h.01"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3"/>',
    'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    'folder-open': '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    'folder': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    'grip-vertical': '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
    'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    'list-tree': '<path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/>',
    'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'notebook-text': '<path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5"/><path d="M9.5 12H16"/><path d="M9.5 16H14"/>',
    'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    'presentation': '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
    'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    'square-play': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 8 6 4-6 4Z"/>',
    'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  };
  const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${
    Object.entries(icons).map(([id, d]) => `<symbol id="i-${id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</symbol>`).join('')
  }</svg>`;
  const icon = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const ar = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  window.itqanIcon = icon;
  window.itqanAr = ar;

  // brand mark: the graduation cap of reference 06 (black cap, gold band and tassel), drawn in the ink line style
  const capMark = `<svg class="brand-mark" viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="13" fill="#FFC22E" stroke="#1A1712" stroke-width="2.5"/><path d="M13.5 20.5v6.2c0 3.6 17 3.6 17 0v-6.2L22 24.3z" fill="#1A1712" stroke="#1A1712" stroke-width="1.6" stroke-linejoin="round"/><path d="M13.8 24.6c3.2 2.4 13.2 2.4 16.4 0" fill="none" stroke="#FFC22E" stroke-width="2.2"/><path d="M22 9.5 37.5 16 22 22.5 6.5 16z" fill="#1A1712" stroke="#1A1712" stroke-width="1.6" stroke-linejoin="round"/><path d="M22 16l11.5 3.4v6.4" fill="none" stroke="#FFC22E" stroke-width="1.8" stroke-linecap="round"/><path d="M32 25.6h3l.9 6h-4.8z" fill="#FFC22E" stroke="#1A1712" stroke-width="1.4" stroke-linejoin="round"/><circle cx="22" cy="16" r="1.6" fill="#FFC22E"/></svg>`;

  // the 7 dashboard screens; pages not built yet still hold their place in the nav
  const pages = [
    ['analytics', 'layout-dashboard', 'نظرة عامة', 'Overview'],
    ['courses', 'library-big', 'الكورسات والمحتوى', 'Courses & content'],
    ['quizzes', 'clipboard-check', 'الاختبارات', 'Quizzes'],
    ['requests', 'inbox', 'الطلبات', 'Requests', '8'],
    ['questions', 'message-square', 'أسئلة الطلاب', 'Students’ questions', '4'],
    ['announcements', 'megaphone', 'الإعلانات', 'Announcements'],
    ['accounts', 'users-round', 'الحسابات', 'Accounts'],
    ['notifications', 'bell', 'الإشعارات والسجل', 'Notifications & log'],
    ['profile', 'user-round-cog', 'الملف والإعدادات', 'Profile & settings'],
  ];
  const current = document.body.dataset.page;
  const unread = document.body.dataset.unread || '';

  const side = `
  <aside class="side" id="side" aria-label="القائمة الرئيسية" data-en-aria-label="Main menu">
    <a class="brand" href="analytics.html">${capMark}
      <span><span class="brand-name" data-en="Physics with Mr. Karim">الفيزياء مع أ. كريم</span><span class="brand-sub" data-en="Staff dashboard">لوحة الإدارة</span></span>
    </a>
    <button class="collapse" type="button" aria-controls="side" aria-expanded="true" aria-label="القائمة الجانبية" data-en-aria-label="Side menu">${icon('chevron-left')}</button>
    <a class="new-student" href="create-student.html" title="طالب جديد" data-en-title="New student"${current === 'create-student' ? ' aria-current="page"' : ''}><span class="plus">${icon('user-round-plus')}</span><span class="label" data-en="New student">طالب جديد</span></a>
    <nav aria-label="أقسام اللوحة" data-en-aria-label="Dashboard sections">
      <ul class="nav">${pages.map(([id, ic, a, e, n]) => { const c = id === 'notifications' ? unread : n; return `
        <li><a href="${id}.html"${id === current ? ' aria-current="page"' : ''} title="${a}" data-en-title="${e}">${icon(ic)}<span class="label" data-en="${e}">${a}</span>${
          c ? `<span class="count num" data-count="${id}" data-en="${c}">${ar(c)}</span>` : ''}</a></li>`; }).join('')}
      </ul>
    </nav>
    <div class="side-foot nav">
      <a href="guide.html"${current === 'guide' ? ' aria-current="page"' : ''} title="كيف تعمل اللوحة" data-en-title="How the dashboard works">${icon('info')}<span class="label" data-en="How it works">كيف تعمل اللوحة</span></a>
      <a href="login.html" title="تسجيل الخروج" data-en-title="Sign out">${icon('log-out')}<span class="label" data-en="Sign out">تسجيل الخروج</span></a>
    </div>
  </aside>
  <div class="scrim" data-close></div>`;

  const app = document.querySelector('.app');
  document.body.insertAdjacentHTML('afterbegin', sprite);
  window.itqanCapMark = capMark;
  if (!app) { // pages without the dashboard shell (sign-in): icons only
    document.querySelectorAll('i[data-i]').forEach((el) => { el.outerHTML = icon(el.dataset.i); });
    return;
  }
  app.insertAdjacentHTML('afterbegin', side);

  // the signed-in person's avatar: teacher by default, assistant in the "as assistant" preview
  const meAvatars = () => document.querySelectorAll('.me .avatar, .dd-head .avatar, [data-who-av]');
  meAvatars().forEach((el) => el.classList.add('av-teacher'));
  document.addEventListener('itqan:state', (e) => meAvatars().forEach((el) => {
    el.classList.toggle('av-assistant', e.detail === 'assistant'); el.classList.toggle('av-teacher', e.detail !== 'assistant');
  }));

  // icons written as <i data-i="name"> in page markup
  document.querySelectorAll('i[data-i]').forEach((el) => { el.outerHTML = icon(el.dataset.i); });

  // collapse to icons on desktop, remembered per browser
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
  const collapse = app.querySelector('.collapse');
  // 'is-collapsed', not 'mini': pages use .mini for their own small rows (guide.html)
  const setMini = (on) => { app.classList.toggle('is-collapsed', on); collapse.setAttribute('aria-expanded', String(!on)); store.set('itqan-dash-mini', on ? '1' : '0'); };
  collapse.addEventListener('click', () => setMini(!app.classList.contains('is-collapsed')));
  if (store.get('itqan-dash-mini') === '1') { // start collapsed without replaying the animation
    app.classList.add('no-anim'); setMini(true);
    requestAnimationFrame(() => requestAnimationFrame(() => app.classList.remove('no-anim')));
  }

  // phone and tablet: the side nav becomes a drawer
  const menuBtn = document.querySelector('.menu-btn');
  const setOpen = (on) => { app.classList.toggle('open', on); menuBtn?.setAttribute('aria-expanded', String(on)); if (on) app.querySelector('.nav a')?.focus(); };
  menuBtn?.addEventListener('click', () => setOpen(!app.classList.contains('open')));
  app.querySelector('[data-close]').addEventListener('click', () => setOpen(false));

  // ---- the bell: a dropdown with the latest notifications (GET /notifications?limit=4, live over SSE)
  const latest = [
    ['smartphone', 'i-dev', 'يوسف أحمد يطلب تغيير جهازه', 'Youssef Ahmed asks to change his device', 'منذ ١٢ دقيقة', '12 min ago', true, 'accounts.html'],
    ['monitor-x', 'i-out', 'مريم خالد تطلب الخروج من جهاز آخر', 'Mariam Khaled asks to sign out of another device', 'منذ ٤٠ دقيقة', '40 min ago', true, 'accounts.html'],
    ['message-square', 'i-qa', 'سؤال جديد على «المحاضرة ٢: قانون أوم»', 'New question on “Lecture 2: Ohm’s law”', 'منذ ساعة', '1 hour ago', true, 'courses.html'],
    ['clipboard-check', 'i-quiz', 'أُغلق «امتحان شامل: الترم الأول»', '“Full exam: term 1” closed', 'أمس', 'Yesterday', false, 'quizzes.html'],
  ];
  const oldBell = document.querySelector('.dash-bar a.round[href="notifications.html"]');
  if (oldBell) {
    const dot = oldBell.querySelector('.dot');
    oldBell.outerHTML = `
    <div class="dd bell-dd">
      <button class="round dd-trigger" type="button" aria-haspopup="menu" aria-expanded="false" ${oldBell.id ? `id="${oldBell.id}"` : ''} aria-label="الإشعارات: ${ar(unread)} غير مقروءة" data-en-aria-label="Notifications: ${unread} unread">${icon('bell')}${unread ? `<span class="dot num" ${dot?.id ? `id="${dot.id}"` : ''} data-en="${unread}">${ar(unread)}</span>` : ''}</button>
      <div class="dd-menu bell-menu" role="menu" hidden aria-label="آخر الإشعارات" data-en-aria-label="Latest notifications">
        <div class="bell-head"><b data-en="Notifications">الإشعارات</b><button class="bell-read" type="button" data-bell-read data-en="Mark all as read">علّم الكل مقروءًا</button></div>
        ${latest.map(([ic, cls, a, e, ta, te, un, href]) => `
        <a class="bell-item${un ? ' unread' : ''}" role="menuitem" href="${href}">
          <span class="bell-ico ${cls}">${icon(ic)}</span>
          <span class="bell-txt"><b data-en="${e}">${a}</b><small data-en="${te}">${ta}</small></span>
          <span class="bell-dot" aria-hidden="true"></span>${un ? '<span class="sr-only" data-en="unread">غير مقروء</span>' : ''}
        </a>`).join('')}
        <div class="dd-sep"></div>
        <a class="dd-item bell-all" role="menuitem" href="notifications.html">${icon('bell')}<span data-en="See all notifications">عرض كل الإشعارات</span>${icon('chevron-left')}</a>
      </div>
    </div>`;
    document.querySelector('[data-bell-read]').addEventListener('click', () => {
      document.querySelectorAll('.bell-item.unread').forEach((x) => { x.classList.remove('unread'); x.querySelector('.sr-only')?.remove(); });
      document.querySelectorAll('.bell-dd .dot, [data-count="notifications"]').forEach((x) => { x.hidden = true; });
      const b = document.querySelector('.bell-dd .dd-trigger');
      b.setAttribute('aria-label', 'الإشعارات: لا جديد'); b.setAttribute('data-en-aria-label', 'Notifications: nothing new');
      if (document.documentElement.lang === 'en') b.setAttribute('aria-label', 'Notifications: nothing new');
    });
  }

  // ---- dropdowns: <div class="dd"><button class="dd-btn">…</button><div class="dd-menu" hidden>…</div></div>
  // a listbox (role="option") keeps a value and fires "dd:change"; a menu (role="menuitem") holds links
  const items = (dd) => [...dd.querySelectorAll('[role="option"], [role="menuitem"]')];
  const close = (dd, focusBtn) => {
    const btn = dd.querySelector('.dd-trigger');
    dd.querySelector('.dd-menu').hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focusBtn) btn.focus();
  };
  const closeAll = (except) => document.querySelectorAll('.dd').forEach((d) => d !== except && close(d));
  document.querySelectorAll('.dd').forEach((dd) => {
    const btn = dd.querySelector('.dd-trigger'), menu = dd.querySelector('.dd-menu');
    btn.addEventListener('click', () => {
      const open = menu.hidden;
      closeAll(dd);
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) (dd.querySelector('[aria-selected="true"]') || items(dd)[0])?.focus();
    });
    menu.addEventListener('keydown', (e) => {
      const list = items(dd), i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus(); }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); list[e.key === 'Home' ? 0 : list.length - 1].focus(); }
      if (e.key === 'Tab') close(dd);
    });
    dd.querySelectorAll('[role="option"]').forEach((opt) => opt.addEventListener('click', () => {
      dd.querySelectorAll('[role="option"]').forEach((o) => o.setAttribute('aria-selected', String(o === opt)));
      const val = btn.querySelector('.dd-val'), label = opt.querySelector('.dd-label');
      val.dataset.ar = label.dataset.ar ?? label.textContent;
      val.dataset.en = label.dataset.en;
      val.textContent = document.documentElement.lang === 'en' ? val.dataset.en : val.dataset.ar;
      btn.classList.toggle('is-set', opt.dataset.value !== 'all');
      close(dd, true);
      dd.dispatchEvent(new CustomEvent('dd:change', { detail: opt.dataset.value }));
    }));
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dd')) return closeAll();
    const item = e.target.closest('[role="menuitem"]');
    if (item) close(item.closest('.dd'), false); // a picked menu item closes its menu
  });

  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const openDd = [...document.querySelectorAll('.dd')].find((d) => !d.querySelector('.dd-menu').hidden);
    if (openDd) { close(openDd, true); return; }
    if (app.classList.contains('open')) { setOpen(false); menuBtn?.focus(); }
  });
})();
