export function findGeminiInput(): HTMLElement | HTMLTextAreaElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement) return active;
  if (active instanceof HTMLElement && active.isContentEditable) return active;

  const selectors = [
    'rich-textarea .ql-editor[contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLTextAreaElement) return el;
    if (el instanceof HTMLElement) return el;
  }

  return null;
}

export function insertTextIntoGeminiInput(text: string): boolean {
  const input = findGeminiInput();
  if (!input) return false;

  input.focus();

  if (input instanceof HTMLTextAreaElement) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
    const next = start + text.length;
    input.setSelectionRange(next, next);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return true;
  }

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && input.contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    input.textContent = `${input.textContent || ''}${text}`;
  }

  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  return true;
}
