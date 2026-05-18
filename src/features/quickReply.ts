import { ICONS, svgIcon } from '../shared/icons';
import { insertTextIntoGeminiInput } from '../shared/geminiDom';

export function initQuickReply() {
  const btn = document.createElement('button');
  btn.id = 'mgh-quick-reply-btn';
  btn.type = 'button';
  btn.title = 'Reply to selected text';
  btn.setAttribute('aria-label', 'Reply to selected text');
  btn.innerHTML = `<span>${svgIcon(ICONS.reply, 16)}</span>Reply`;
  btn.hidden = true;
  document.body.appendChild(btn);

  let hideTimeout: number;

  function hideButton() {
    btn.classList.remove('is-visible');
    hideTimeout = window.setTimeout(() => {
      btn.hidden = true;
    }, 200); // Wait for opacity transition
  }

  function showButton(rect: DOMRect) {
    window.clearTimeout(hideTimeout);
    btn.hidden = false;
    
    // Position slightly above the selection
    const top = rect.top + window.scrollY - 40;
    const left = rect.left + window.scrollX + (rect.width / 2);
    
    btn.style.top = `${Math.max(10, top)}px`;
    btn.style.left = `${Math.max(10, left)}px`;
    
    // Force reflow before adding class for transition
    void btn.offsetWidth;
    btn.classList.add('is-visible');
  }

  document.addEventListener('mouseup', (e) => {
    // Ignore clicks on the button itself
    if (btn.contains(e.target as Node)) return;

    window.setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        hideButton();
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        hideButton();
        return;
      }

      // Check if selection is inside an input/textarea (we don't want to show it there)
      const activeEl = document.activeElement;
      if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement || (activeEl instanceof HTMLElement && activeEl.isContentEditable)) {
        hideButton();
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        showButton(rect);
      } else {
        hideButton();
      }
    }, 10);
  });

  // Hide on scroll or mousedown elsewhere
  document.addEventListener('mousedown', (e) => {
    if (!btn.contains(e.target as Node)) {
      hideButton();
    }
  });

  window.addEventListener('scroll', hideButton, { passive: true });

  btn.addEventListener('click', () => {
    const selection = window.getSelection();
    if (!selection) return;

    const text = selection.toString().trim();
    if (text) {
      const formatted = `> ${text}\n\n`;
      insertTextIntoGeminiInput(formatted);
      selection.removeAllRanges();
    }
    hideButton();
  });
}
