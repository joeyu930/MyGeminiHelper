import { normalizeText, truncate } from '../shared/text';

// Builds the right-side prompt rail from the prompts currently visible in Gemini.
// Nothing here is persisted; it is only a page navigation aid.
export function initPromptHistoryRail() {
  const userTurnSelectors = [
    '.user-query-bubble-with-background',
    '.user-query-bubble-container',
    '.user-query-container',
    '[data-testid="user-query"]',
  ];

  const sidebar = document.createElement('div');
  sidebar.className = 'mgh-prompt-history-rail';
  sidebar.setAttribute('aria-label', 'Prompt history');
  document.body.appendChild(sidebar);

  let cachedSignature = '';

  function cleanPromptText(text: string) {
    return normalizeText(text)
      .replace(/^(你說了|你說|您說了|You said)\s*[:：]?\s*/i, '')
      .replace(/^"(.*)"$/, '$1')
      .trim();
  }

  function getPromptElements() {
    let queryElements: Element[] = [];
    for (const selector of userTurnSelectors) {
      const els = Array.from(document.querySelectorAll(selector));
      if (els.length > 0) {
        queryElements = els;
        break;
      }
    }

    return queryElements.filter((el, index, all) => {
      const text = cleanPromptText(el.textContent || '');
      if (!text) return false;
      return all.findIndex(other => cleanPromptText(other.textContent || '') === text) === index;
    });
  }

  // Markers are distributed by prompt scroll position, so long answers naturally
  // create larger gaps before the next prompt marker.
  function positionTimeline(elements: Element[]) {
    const markers = Array.from(sidebar.querySelectorAll<HTMLElement>('.mgh-history-marker'));
    const promptTops = elements.map(el => window.scrollY + el.getBoundingClientRect().top);
    const firstTop = promptTops[0] ?? 0;
    const lastTop = promptTops[promptTops.length - 1] ?? firstTop;
    const promptRange = Math.max(lastTop - firstTop, 1);

    elements.forEach((_, index) => {
      const marker = markers[index];
      if (!marker) return;

      const ratio = elements.length === 1
        ? 0.5
        : 0.04 + ((promptTops[index] - firstTop) / promptRange) * 0.92;
      marker.style.top = `${ratio * 100}%`;
    });
  }

  function updateTimeline() {
    const queryElements = getPromptElements();
    const signature = queryElements
      .map((el, index) => `${index}:${cleanPromptText(el.textContent || '').slice(0, 80)}`)
      .join('|');

    if (signature !== cachedSignature) {
      cachedSignature = signature;
      renderTimeline(queryElements);
    } else {
      positionTimeline(queryElements);
    }
  }

  // Rebuild only when the prompt set changes; otherwise just update positions.
  function renderTimeline(elements: Element[]) {
    sidebar.innerHTML = '';
    sidebar.classList.toggle('is-empty', elements.length === 0);

    elements.forEach((el, index) => {
      const marker = document.createElement('button');
      marker.className = 'mgh-history-marker';
      marker.type = 'button';
      marker.title = `Prompt ${index + 1}`;
      marker.setAttribute('aria-label', `Scroll to prompt ${index + 1}`);
      marker.addEventListener('click', () => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        marker.classList.add('is-active');
        window.setTimeout(() => marker.classList.remove('is-active'), 900);
      });

      const indexEl = document.createElement('span');
      indexEl.className = 'mgh-history-index';
      indexEl.textContent = String(index + 1);

      const tooltip = document.createElement('div');
      tooltip.className = 'mgh-history-tooltip';
      const text = truncate(cleanPromptText(el.textContent || ''), 120);
      tooltip.textContent = text || `Prompt ${index + 1}`;

      marker.appendChild(indexEl);
      marker.appendChild(tooltip);
      sidebar.appendChild(marker);
    });

    positionTimeline(elements);
  }

  const observer = new MutationObserver(updateTimeline);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.setInterval(updateTimeline, 2000);
  updateTimeline();
}
