import { readLocalStorage, STORAGE_KEYS, writeLocalStorage } from '../shared/storage';
import { normalizeText } from '../shared/text';

type PinnedModel = {
  label: string;
  updatedAt: number;
};

// Gemini changes model menu markup often, so selectors are intentionally broad
// but filtered by visible text that looks like a model name.
function cleanModelLabel(text: string) {
  return normalizeText(text)
    .replace(/\b(expand_more|arrow_drop_down|keyboard_arrow_down)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyModelText(text: string) {
  return /\b(Gemini|Flash|Pro|Thinking|Deep Research|Advanced|Fast)\b|快捷|快速|模型|進階|專業|思考/i.test(text);
}

function isVisibleElement(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

function findModelButton(): HTMLElement | null {
  const selectors = [
    'button[data-test-id*="model"]',
    'button[data-test-id*="mode"]',
    '[role="button"][data-test-id*="model"]',
    '[role="button"][data-test-id*="mode"]',
    'button[aria-label*="model" i]',
    '[role="button"][aria-label*="model" i]',
    'button[aria-label*="模型"]',
    '[role="button"][aria-label*="模型"]',
    '.bard-mode-list-button',
    'button:has(.bard-mode-title), [role="button"]:has(.bard-mode-title)',
    'button:has([class*="model"]), [role="button"]:has([class*="model"])',
    'button:has([class*="mode"]), [role="button"]:has([class*="mode"])',
  ];

  for (const selector of selectors) {
    const button = document.querySelector<HTMLElement>(selector);
    if (button && isVisibleElement(button) && isLikelyModelText(cleanModelLabel(button.textContent || button.getAttribute('aria-label') || ''))) {
      return button;
    }
  }

  return Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]')).find(button => {
    if (!isVisibleElement(button)) return false;
    const text = cleanModelLabel(button.textContent || button.getAttribute('aria-label') || '');
    const rect = button.getBoundingClientRect();
    return isLikelyModelText(text) && rect.top < 180 && rect.left < window.innerWidth * 0.72;
  }) || null;
}

function getCurrentModelLabel() {
  const button = findModelButton();
  return button ? cleanModelLabel(button.textContent || button.getAttribute('aria-label') || '') : '';
}

function findModelMenuItem(label: string): HTMLElement | null {
  const needle = label.toLowerCase();
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.cdk-overlay-pane button, .cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane [role="option"], .cdk-overlay-pane [role="button"], .mat-mdc-menu-panel button'
    )
  );

  return candidates.find(item => {
    const text = cleanModelLabel(item.textContent || item.getAttribute('aria-label') || '').toLowerCase();
    return text.includes(needle) || needle.includes(text);
  }) || null;
}

export function cleanupPinnedModelUi() {
  document.querySelectorAll('.mgh-model-option-pin, #mgh-model-pin-notice').forEach(node => node.remove());
  document.querySelectorAll<HTMLElement>('.mgh-model-option-with-pin').forEach(node => {
    node.classList.remove('mgh-model-option-with-pin');
  });
}

// Adds star controls to Gemini's native model menu and reselects the saved model
// on page load when the option can be found.
export async function initPinnedModel() {
  let pinned = await readLocalStorage<PinnedModel | null>(STORAGE_KEYS.pinnedModel, null);

  const notice = document.createElement('div');
  notice.id = 'mgh-model-pin-notice';
  notice.setAttribute('role', 'status');

  function showNotice(message: string) {
    notice.textContent = message;
    notice.classList.add('is-visible');
    window.setTimeout(() => notice.classList.remove('is-visible'), 1600);
  }

  function isPinnedLabel(label: string) {
    return Boolean(pinned?.label && label.toLowerCase() === pinned.label.toLowerCase());
  }

  function getModelOptionLabel(option: HTMLElement) {
    const clone = option.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.mgh-model-option-pin').forEach(node => node.remove());
    return cleanModelLabel(clone.textContent || option.getAttribute('aria-label') || '');
  }

  function renderModelMenuPins() {
    cleanupPinnedModelUi();

    const menuContents = Array.from(
      document.querySelectorAll<HTMLElement>('.cdk-overlay-pane .mat-mdc-menu-content, .gds-mode-switch-menu, [role="listbox"], [role="menu"]')
    ).filter(menu => {
      const text = cleanModelLabel(menu.textContent || '');
      const hasModelOptions = Array.from(menu.querySelectorAll<HTMLElement>('button, [role="option"], [role="menuitem"], [role="button"], .bard-mode-list-button'))
        .filter(item => isLikelyModelText(cleanModelLabel(item.textContent || item.getAttribute('aria-label') || '')))
        .length >= 2;
      return hasModelOptions || Boolean(menu.querySelector('.bard-mode-list-button')) || isLikelyModelText(text);
    });

    menuContents.forEach(menu => {
      const optionSelector = [
        'button',
        '[role="option"]',
        '[role="menuitem"]',
        '[role="button"]',
        '.bard-mode-list-button',
      ].join(', ');

      const rawOptions = Array.from(menu.querySelectorAll<HTMLElement>(optionSelector))
        .filter(item => {
          if (item.classList.contains('mgh-model-option-pin')) return false;
          if (!isVisibleElement(item)) return false;
          const parentOption = item.parentElement?.closest(optionSelector);
          if (parentOption && parentOption !== item && menu.contains(parentOption)) return false;
          const text = getModelOptionLabel(item);
          return isLikelyModelText(text) && text.length > 1 && text.length < 160;
        });

      const labels = new Set<string>();
      const options = rawOptions.filter(option => {
        const label = getModelOptionLabel(option).toLowerCase();
        if (labels.has(label)) return false;
        labels.add(label);
        return true;
      }).slice(0, 12);

      options.forEach(option => {
        const label = getModelOptionLabel(option);
        if (!label) return;

        option.classList.add('mgh-model-option-with-pin');

        const pin = document.createElement('span');
        pin.className = 'mgh-model-option-pin';
        pin.setAttribute('role', 'button');
        pin.setAttribute('tabindex', '0');
        pin.setAttribute('aria-label', `Pin ${label}`);
        pin.title = `Pin ${label}`;
        pin.textContent = isPinnedLabel(label) ? '★' : '☆';

        const pinModel = async (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          if (isPinnedLabel(label)) {
            await clearPinnedModel();
          } else {
            await savePinnedModel(label);
          }
          renderModelMenuPins();
        };

        pin.addEventListener('click', pinModel);
        pin.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            void pinModel(event);
          }
        });
        option.appendChild(pin);
      });
    });
  }

  // Model options render inside Angular CDK overlays after the click, so scan a
  // few times instead of observing the full page forever.
  function scheduleModelMenuPins() {
    [80, 180, 320, 520, 800].forEach(delay => {
      window.setTimeout(renderModelMenuPins, delay);
    });
  }

  function observeModelOverlayOnce() {
    const overlayContainer = document.querySelector('.cdk-overlay-container');
    if (!overlayContainer) return false;

    const observer = new MutationObserver(mutations => {
      const openedMenu = mutations.some(mutation =>
        Array.from(mutation.addedNodes).some(node =>
          node instanceof HTMLElement &&
          (node.classList.contains('cdk-overlay-pane') || Boolean(node.querySelector('.cdk-overlay-pane')))
        )
      );
      if (openedMenu) scheduleModelMenuPins();
    });

    observer.observe(overlayContainer, { childList: true });
    return true;
  }

  async function savePinnedModel(label: string) {
    pinned = { label, updatedAt: Date.now() };
    await writeLocalStorage(STORAGE_KEYS.pinnedModel, pinned);
    showNotice(`Pinned ${label}`);
  }

  async function clearPinnedModel() {
    pinned = null;
    await writeLocalStorage(STORAGE_KEYS.pinnedModel, null);
    showNotice('Pinned model cleared');
  }

  async function applyPinnedModel() {
    if (!pinned?.label) return false;

    const current = getCurrentModelLabel();
    if (current && (current.includes(pinned.label) || pinned.label.includes(current))) {
      return true;
    }

    const button = findModelButton();
    if (!button) return false;

    button.click();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 80));
      const item = findModelMenuItem(pinned.label);
      if (item) {
        item.click();
        showNotice(`Selected ${pinned.label}`);
        return true;
      }
    }

    return false;
  }

  document.body.appendChild(notice);

  if (!observeModelOverlayOnce()) {
    window.setTimeout(observeModelOverlayOnce, 1000);
    window.setTimeout(observeModelOverlayOnce, 3000);
  }

  document.addEventListener(
    'click',
    event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const trigger = target.closest('button, [role="button"], .bard-mode-list-button, [aria-haspopup="menu"]');
      if (!(trigger instanceof HTMLElement)) return;
      const label = cleanModelLabel(trigger.textContent || trigger.getAttribute('aria-label') || '');
      const rect = trigger.getBoundingClientRect();
      if (rect.top > 180 || rect.left > window.innerWidth * 0.72) return;
      if (!isLikelyModelText(label) && !trigger.matches('[aria-haspopup="menu"]')) return;
      scheduleModelMenuPins();
    },
    true
  );

  window.setTimeout(() => void applyPinnedModel(), 1200);
  window.setTimeout(() => void applyPinnedModel(), 3500);
}
