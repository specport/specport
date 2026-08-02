(() => {
  const buttons = document.querySelectorAll('[data-copy]');
  for (const button of buttons) {
    button.addEventListener('click', async () => {
      const value = button.getAttribute('data-copy');
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        button.textContent = 'copied';
        button.classList.add('is-copied');
        window.setTimeout(() => {
          button.textContent = 'copy';
          button.classList.remove('is-copied');
        }, 1400);
      } catch {
        button.textContent = 'select manually';
        window.setTimeout(() => { button.textContent = 'copy'; }, 1800);
      }
    });
  }
})();
