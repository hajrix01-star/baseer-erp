(() => {
  const options = [
    { id: 'emerald-light', ar: 'أخضر هادئ', en: 'Calm green' },
    { id: 'emerald-dark', ar: 'أخضر داكن', en: 'Executive dark' },
    { id: 'architectural-light', ar: 'معماري مضيء', en: 'Architectural light' },
  ];
  let active = localStorage.getItem('baseer-launcher-background') || options[0].id;

  const label = () => options.find((option) => option.id === active) ?? options[0];
  const update = () => {
    document.body.dataset.launcherBackground = active;
    document.querySelectorAll('[data-background-label]').forEach((element) => {
      const option = label();
      element.textContent = document.documentElement.lang === 'en' ? option.en : option.ar;
    });
    document.querySelectorAll('[data-background-option]').forEach((element) => {
      const selected = element.dataset.backgroundOption === active;
      element.classList.toggle('is-selected', selected);
      element.setAttribute('aria-pressed', String(selected));
    });
  };
  const close = () => document.querySelectorAll('[data-background-menu]').forEach((menu) => menu.classList.remove('is-open'));

  window.BaseerLauncherBackgrounds = {
    toggleMenu(trigger) {
      const menu = trigger?.closest('.theme-control')?.querySelector('[data-background-menu]') || document.querySelector('[data-background-menu]');
      if (!menu) return;
      const wasOpen = menu.classList.contains('is-open');
      close();
      const isOpen = !wasOpen;
      menu.classList.toggle('is-open', isOpen);
      trigger?.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) menu.querySelector('button')?.focus();
    },
    select(id) {
      if (!options.some((option) => option.id === id)) return;
      active = id;
      localStorage.setItem('baseer-launcher-background', active);
      update();
      close();
    },
    refresh: update,
    close,
  };

  document.querySelectorAll('[data-background-option]').forEach((button) => {
    button.addEventListener('click', () => window.BaseerLauncherBackgrounds.select(button.dataset.backgroundOption));
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.theme-control')) close();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  update();
})();
