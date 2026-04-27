import { ICONS, svgIcon } from '../shared/icons';
import { canUseExtensionStorage, handleStorageError, readLocalStorage, STORAGE_KEYS, writeLocalStorage } from '../shared/storage';
import { copyText, normalizeText, uid, truncate } from '../shared/text';

interface PromptItem {
  id: string;
  title?: string;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt?: number;
}

// Saved prompt panel: local CRUD, tag filtering, copy, and insert into Gemini.
function parseTags(raw: string) {
  const seen = new Set<string>();
  return raw
    .split(',')
    .map(tag => tag.trim().replace(/^#/, '').toLowerCase())
    .filter(tag => {
      if (!tag || seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
}

function findGeminiInput(): HTMLElement | HTMLTextAreaElement | null {
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

// Gemini has used both textarea-like and contenteditable editors. Support both
// paths so saved prompts can be inserted without depending on one exact DOM.
function insertTextIntoGeminiInput(text: string) {
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

export async function initPromptLibrary() {
  let prompts = await readLocalStorage<PromptItem[]>(STORAGE_KEYS.prompts, []);
  let selectedTag = '';
  let editingId: string | null = null;

  const trigger = document.createElement('button');
  trigger.id = 'mgh-prompt-library-trigger';
  trigger.type = 'button';
  trigger.title = 'Prompt library';
  trigger.setAttribute('aria-label', 'Open prompt library');
  trigger.innerHTML = svgIcon(ICONS.list, 24);

  const panel = document.createElement('section');
  panel.id = 'mgh-prompt-library-panel';
  panel.setAttribute('aria-label', 'Prompt library');
  panel.hidden = true;

  const header = document.createElement('div');
  header.className = 'mgh-prompt-panel-header';

  const heading = document.createElement('h2');
  heading.textContent = 'Prompt Library';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mgh-icon-button';
  closeBtn.title = 'Close';
  closeBtn.innerHTML = svgIcon(ICONS.close, 18);
  closeBtn.addEventListener('click', () => {
    panel.hidden = true;
  });

  header.appendChild(heading);
  header.appendChild(closeBtn);

  const search = document.createElement('input');
  search.className = 'mgh-prompt-search';
  search.type = 'search';
  search.placeholder = 'Search prompts or tags';

  const tagsWrap = document.createElement('div');
  tagsWrap.className = 'mgh-prompt-tags';

  const form = document.createElement('form');
  form.className = 'mgh-prompt-form';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'Title';
  titleInput.className = 'mgh-prompt-title-input';

  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.placeholder = 'Tags, comma separated';
  tagsInput.className = 'mgh-prompt-tags-input';

  const textInput = document.createElement('textarea');
  textInput.placeholder = 'Prompt text';
  textInput.className = 'mgh-prompt-text-input';
  textInput.rows = 4;

  const formActions = document.createElement('div');
  formActions.className = 'mgh-prompt-form-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.textContent = 'Save';

  const cancelEditBtn = document.createElement('button');
  cancelEditBtn.type = 'button';
  cancelEditBtn.textContent = 'Cancel';
  cancelEditBtn.hidden = true;
  cancelEditBtn.addEventListener('click', () => resetForm());

  formActions.appendChild(cancelEditBtn);
  formActions.appendChild(saveBtn);

  form.appendChild(titleInput);
  form.appendChild(tagsInput);
  form.appendChild(textInput);
  form.appendChild(formActions);

  const list = document.createElement('div');
  list.className = 'mgh-prompt-list';

  const notice = document.createElement('div');
  notice.className = 'mgh-prompt-notice';
  notice.setAttribute('role', 'status');

  panel.appendChild(header);
  panel.appendChild(search);
  panel.appendChild(tagsWrap);
  panel.appendChild(form);
  panel.appendChild(list);
  panel.appendChild(notice);

  document.body.appendChild(trigger);
  document.body.appendChild(panel);

  // State helpers keep storage, the edit form, and the visible list in sync.
  function setNotice(message: string) {
    notice.textContent = message;
    notice.classList.add('is-visible');
    window.setTimeout(() => notice.classList.remove('is-visible'), 1600);
  }

  function resetForm() {
    editingId = null;
    titleInput.value = '';
    tagsInput.value = '';
    textInput.value = '';
    saveBtn.textContent = 'Save';
    cancelEditBtn.hidden = true;
  }

  async function persist() {
    await writeLocalStorage(STORAGE_KEYS.prompts, prompts);
  }

  function renderTags() {
    tagsWrap.innerHTML = '';
    const allTags = Array.from(new Set(prompts.flatMap(prompt => prompt.tags))).sort();

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.textContent = 'All';
    allBtn.className = selectedTag ? '' : 'is-active';
    allBtn.addEventListener('click', () => {
      selectedTag = '';
      render();
    });
    tagsWrap.appendChild(allBtn);

    allTags.forEach(tag => {
      const tagBtn = document.createElement('button');
      tagBtn.type = 'button';
      tagBtn.textContent = `#${tag}`;
      tagBtn.className = selectedTag === tag ? 'is-active' : '';
      tagBtn.addEventListener('click', () => {
        selectedTag = selectedTag === tag ? '' : tag;
        render();
      });
      tagsWrap.appendChild(tagBtn);
    });
  }

  function getFilteredPrompts() {
    const query = normalizeText(search.value).toLowerCase();
    return prompts.filter(prompt => {
      const matchesTag = !selectedTag || prompt.tags.includes(selectedTag);
      if (!matchesTag) return false;
      if (!query) return true;
      return (
        (prompt.title || '').toLowerCase().includes(query) ||
        prompt.text.toLowerCase().includes(query) ||
        prompt.tags.some(tag => tag.includes(query.replace(/^#/, '')))
      );
    });
  }

  // Rendering is intentionally native DOM to avoid adding a UI framework.
  function renderList() {
    list.innerHTML = '';
    const filtered = getFilteredPrompts();

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mgh-prompt-empty';
      empty.textContent = prompts.length === 0 ? 'No saved prompts yet.' : 'No matching prompts.';
      list.appendChild(empty);
      return;
    }

    filtered.forEach(prompt => {
      const item = document.createElement('article');
      item.className = 'mgh-prompt-item';

      const body = document.createElement('button');
      body.type = 'button';
      body.className = 'mgh-prompt-item-body';
      body.title = 'Insert prompt';
      body.addEventListener('click', () => {
        const inserted = insertTextIntoGeminiInput(prompt.text);
        setNotice(inserted ? 'Inserted' : 'Gemini input not found');
      });

      const title = document.createElement('strong');
      title.textContent = prompt.title || truncate(prompt.text, 48);

      const preview = document.createElement('span');
      preview.textContent = truncate(prompt.text, 110);

      const tagLine = document.createElement('span');
      tagLine.className = 'mgh-prompt-item-tags';
      tagLine.textContent = prompt.tags.map(tag => `#${tag}`).join(' ');

      body.appendChild(title);
      body.appendChild(preview);
      if (prompt.tags.length > 0) body.appendChild(tagLine);

      const actions = document.createElement('div');
      actions.className = 'mgh-prompt-item-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.title = 'Copy';
      copyBtn.innerHTML = svgIcon(ICONS.copy, 16);
      copyBtn.addEventListener('click', async () => {
        setNotice((await copyText(prompt.text)) ? 'Copied' : 'Copy failed');
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.title = 'Edit';
      editBtn.innerHTML = svgIcon(ICONS.edit, 16);
      editBtn.addEventListener('click', () => {
        editingId = prompt.id;
        titleInput.value = prompt.title || '';
        tagsInput.value = prompt.tags.join(', ');
        textInput.value = prompt.text;
        saveBtn.textContent = 'Update';
        cancelEditBtn.hidden = false;
        textInput.focus();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.title = 'Delete';
      deleteBtn.innerHTML = svgIcon(ICONS.close, 16);
      deleteBtn.addEventListener('click', async () => {
        prompts = prompts.filter(item => item.id !== prompt.id);
        if (editingId === prompt.id) resetForm();
        await persist();
        render();
        setNotice('Deleted');
      });

      actions.appendChild(copyBtn);
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(body);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  function render() {
    renderTags();
    renderList();
  }

  trigger.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) search.focus();
  });

  search.addEventListener('input', () => renderList());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = textInput.value.trim();
    if (!text) {
      setNotice('Prompt text is required');
      return;
    }

    const now = Date.now();
    const nextItem: PromptItem = {
      id: editingId || uid('prompt'),
      title: titleInput.value.trim() || undefined,
      text,
      tags: parseTags(tagsInput.value),
      createdAt: now,
      updatedAt: now,
    };

    if (editingId) {
      prompts = prompts.map(prompt => (
        prompt.id === editingId
          ? { ...nextItem, createdAt: prompt.createdAt || now }
          : prompt
      ));
      setNotice('Updated');
    } else {
      prompts = [nextItem, ...prompts];
      setNotice('Saved');
    }

    await persist();
    resetForm();
    render();
  });

  if (canUseExtensionStorage()) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!canUseExtensionStorage() || area !== 'local' || !changes[STORAGE_KEYS.prompts]) return;
        prompts = (changes[STORAGE_KEYS.prompts].newValue as PromptItem[] | undefined) || [];
        render();
      });
    } catch (error) {
      handleStorageError('read', STORAGE_KEYS.prompts, error);
    }
  }

  render();
}
