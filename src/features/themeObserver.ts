export function initThemeObserver() {
  function updateTheme() {
    // Gemini typically sets data-theme on body or html
    const isDarkHtml = document.documentElement.getAttribute('data-theme') === 'dark' || document.documentElement.classList.contains('dark-theme') || document.documentElement.classList.contains('dark');
    const isDarkBody = document.body.getAttribute('data-theme') === 'dark' || document.body.classList.contains('dark-theme') || document.body.classList.contains('dark');
    
    // We only rely on attributes/classes to avoid layout thrashing.
    if (isDarkHtml || isDarkBody) {
      document.body.classList.remove('mgh-light-theme');
    } else {
      document.body.classList.add('mgh-light-theme');
    }
  }

  // Initial check
  updateTheme();

  // Observe attributes on body and html
  const observer = new MutationObserver((mutations) => {
    let shouldUpdate = false;
    for (const mutation of mutations) {
      if (mutation.attributeName === 'class' || mutation.attributeName === 'data-theme') {
        shouldUpdate = true;
        break; 
      }
    }
    if (shouldUpdate) {
      // Disconnect temporarily to prevent our own classList changes from triggering an infinite loop
      observer.disconnect();
      updateTheme();
      // Re-observe
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }
  });

  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
}

