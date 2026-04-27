import { debugInfo } from '../shared/debug';
import { ICONS, svgIcon } from '../shared/icons';
import { canUseExtensionStorage, handleStorageError, STORAGE_KEYS, writeLocalStorage } from '../shared/storage';
import { normalizeText, truncate, uid } from '../shared/text';

interface Folder {
  id: string;
  name: string;
  isExpanded: boolean;
  parentId: string | null;
  sortIndex: number;
  createdAt: number;
  updatedAt: number;
}

interface ConversationItem {
  conversationId: string;
  title: string;
  url: string;
  starred: boolean;
  addedAt: number;
  sortIndex: number;
  lastOpenedAt?: number;
  updatedAt?: number;
}

interface AppData {
  folders: Folder[];
  folderContents: Record<string, ConversationItem[]>;
}

// Folder feature owns three things:
// 1. local folder data in chrome.storage.local,
// 2. a small folder UI injected near Gemini's conversation sidebar,
// 3. a "Move to folder" item injected into Gemini's native conversation menu.
export async function initFolders() {
  let appData: AppData = { folders: [], folderContents: {} };
  let lastClickedConversation: ConversationItem | null = null;
  let lastMenuClickPoint: { x: number; y: number } | null = null;

  try {
    if (!canUseExtensionStorage()) return;
    const raw = await chrome.storage.local.get([STORAGE_KEYS.folders, STORAGE_KEYS.legacyFolders]);
    if (raw[STORAGE_KEYS.folders]) {
      appData = raw[STORAGE_KEYS.folders] as AppData;
    } else if (raw[STORAGE_KEYS.legacyFolders]) {
      appData = raw[STORAGE_KEYS.legacyFolders] as AppData;
      await writeLocalStorage(STORAGE_KEYS.folders, appData);
    }
  } catch (error) {
    handleStorageError('read', STORAGE_KEYS.folders, error);
  }

  function saveData() {
    if (!canUseExtensionStorage()) return;
    void writeLocalStorage(STORAGE_KEYS.folders, appData);
  }

  function normalizeConversationId(id: string) {
    const clean = id.replace(/^c_/, '').trim();
    return clean ? `c_${clean}` : '';
  }

  function extractConversationIdFromUrl(url: string) {
    const appMatch = url.match(/\/app\/([^/?#]+)/);
    if (appMatch?.[1]) return normalizeConversationId(appMatch[1]);

    const gemMatch = url.match(/\/gem\/[^/]+\/([^/?#]+)/);
    if (gemMatch?.[1]) return normalizeConversationId(gemMatch[1]);

    return '';
  }

  function buildConversationUrlFromId(conversationId: string) {
    const cleanId = conversationId.replace(/^c_/, '');
    return `https://gemini.google.com/app/${cleanId}`;
  }

  function getConversationLink(scope: HTMLElement): HTMLAnchorElement | null {
    return scope.querySelector('a[href*="/app/"], a[href*="/gem/"]');
  }

  function extractConversationIdFromJslog(scope: HTMLElement): string {
    const parse = (value: string | null | undefined) => {
      if (!value) return '';
      const match = value.match(/c_([a-f0-9]{8,})/i);
      return match?.[1] ? normalizeConversationId(match[1]) : '';
    };

    const fromSelf = parse(scope.getAttribute('jslog'));
    if (fromSelf) return fromSelf;

    const nodes = scope.querySelectorAll('[jslog]');
    for (const node of Array.from(nodes)) {
      const found = parse(node.getAttribute('jslog'));
      if (found) return found;
    }

    return '';
  }

  function extractConversationTitle(scope: HTMLElement, link: HTMLAnchorElement | null) {
    const titleEl = scope.querySelector(
      '.gds-label-l, .conversation-title-text, [data-test-id="conversation-title"], h3'
    );
    const titleFromSelector = normalizeText(titleEl?.textContent || '');
    if (titleFromSelector) return titleFromSelector;

    const aria = normalizeText(link?.getAttribute('aria-label') || '');
    if (aria) return aria;

    const titleAttr = normalizeText(link?.getAttribute('title') || '');
    if (titleAttr) return titleAttr;

    const text = normalizeText(link?.textContent || scope.textContent || '');
    return text || 'Untitled conversation';
  }

  function extractConversationInfo(row: HTMLElement): ConversationItem | null {
    const scope =
      getConversationLink(row)
        ? row
        : ((row.closest('[data-test-id="conversation"]') as HTMLElement | null) || row);
    const link = getConversationLink(scope);
    const href = link?.getAttribute('href') || '';
    const url = href
      ? href.startsWith('http')
        ? href
        : `https://gemini.google.com${href}`
      : '';
    const conversationId = url ? extractConversationIdFromUrl(url) : extractConversationIdFromJslog(scope);
    const finalUrl = url || (conversationId ? buildConversationUrlFromId(conversationId) : '');

    if (!conversationId || !finalUrl) return null;

    return {
      conversationId,
      title: extractConversationTitle(scope, link),
      url: finalUrl,
      starred: false,
      addedAt: Date.now(),
      sortIndex: 0,
    };
  }

  function showFolderNotice(message: string) {
    let notice = document.querySelector('.mgh-folder-notice') as HTMLElement | null;
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'mgh-folder-notice';
      document.body.appendChild(notice);
    }

    notice.textContent = message;
    notice.classList.add('is-visible');
    window.setTimeout(() => notice?.classList.remove('is-visible'), 1800);
  }

  // Folder contents store conversation references only. The real conversation
  // remains in Gemini; we save enough metadata to reopen and organize it.
  function addConversationToFolder(folderId: string, conversation: ConversationItem) {
    if (!appData.folderContents[folderId]) {
      appData.folderContents[folderId] = [];
    }

    const contents = appData.folderContents[folderId];
    const existing = contents.find(item => item.conversationId === conversation.conversationId);
    const now = Date.now();

    if (existing) {
      existing.updatedAt = now;
      showFolderNotice('Conversation already exists in this folder');
      saveData();
      if (folderListEl) renderFolderList(folderListEl);
      return;
    }

    const maxSortIndex = contents.reduce((max, item) => Math.max(max, item.sortIndex ?? 0), -1);
    contents.push({
      ...conversation,
      addedAt: now,
      updatedAt: now,
      sortIndex: maxSortIndex + 1,
    });

    saveData();
    if (folderListEl) renderFolderList(folderListEl);
    showFolderNotice(`Added to ${appData.folders.find(folder => folder.id === folderId)?.name || 'folder'}`);
  }

  function renameFolder(folderId: string, name: string, options: { rerender?: boolean } = {}) {
    const folder = appData.folders.find(item => item.id === folderId);
    const trimmed = name.trim();
    if (!folder || !trimmed) return;

    folder.name = trimmed;
    folder.updatedAt = Date.now();
    saveData();
    if (options.rerender !== false && folderListEl) renderFolderList(folderListEl);
    showFolderNotice(`Renamed to ${trimmed}`);
  }

  function deleteFolder(folderId: string) {
    const folder = appData.folders.find(item => item.id === folderId);
    if (!folder) return;

    appData.folders = appData.folders.filter(item => item.id !== folderId);
    delete appData.folderContents[folderId];
    saveData();
    if (folderListEl) renderFolderList(folderListEl);
    showFolderNotice(`Deleted folder: ${folder.name}`);
  }

  function showMoveToFolderDialog(conversation: ConversationItem) {
    if (appData.folders.length === 0) {
      showFolderNotice('Create a folder first');
      return;
    }

    const existingOverlay = document.querySelector('.mgh-folder-dialog-overlay');
    existingOverlay?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'mgh-folder-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'mgh-folder-dialog';

    const title = document.createElement('h2');
    title.textContent = 'Move to folder';

    const subtitle = document.createElement('p');
    subtitle.textContent = truncate(conversation.title, 90);

    const list = document.createElement('div');
    list.className = 'mgh-folder-dialog-list';

    const folders = [...appData.folders].sort((a, b) => a.sortIndex - b.sortIndex);
    folders.forEach(folder => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'mgh-folder-dialog-item';
      item.innerHTML = svgIcon(ICONS.folder, 18);

      const name = document.createElement('span');
      name.textContent = folder.name;
      item.appendChild(name);

      item.addEventListener('click', () => {
        addConversationToFolder(folder.id, conversation);
        overlay.remove();
      });

      list.appendChild(item);
    });

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'mgh-folder-dialog-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => overlay.remove());

    overlay.addEventListener('click', event => {
      if (event.target === overlay) overlay.remove();
    });

    dialog.appendChild(title);
    dialog.appendChild(subtitle);
    dialog.appendChild(list);
    dialog.appendChild(cancel);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  function exportFolderData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      storageKey: STORAGE_KEYS.folders,
      data: appData,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `my-gemini-helper-folders-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showFolderNotice('Folder data exported');
  }

  function isFolderData(value: unknown): value is AppData {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<AppData>;
    return Array.isArray(candidate.folders) && Boolean(candidate.folderContents);
  }

  function importFolderData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.addEventListener('load', () => {
        try {
          const parsed = JSON.parse(String(reader.result || '{}')) as { data?: unknown };
          const nextData = isFolderData(parsed.data) ? parsed.data : parsed;
          if (!isFolderData(nextData)) {
            showFolderNotice('Invalid folder backup');
            return;
          }

          appData = nextData;
          saveData();
          if (folderListEl) renderFolderList(folderListEl);
          showFolderNotice('Folder data imported');
        } catch {
          showFolderNotice('Import failed');
        }
      });
      reader.readAsText(file);
    });
    input.click();
  }

  function collapseAllFolders() {
    appData.folders.forEach(folder => {
      folder.isExpanded = false;
      folder.updatedAt = Date.now();
    });
    saveData();
    if (folderListEl) renderFolderList(folderListEl);
    showFolderNotice('Collapsed all folders');
  }

  // Gemini's sidebar markup varies. These helpers infer the conversation row
  // from the clicked three-dot menu button using selectors, siblings, and position.
  function findConversationNearRect(sourceRect: DOMRect): HTMLElement | null {
    const sourceY = sourceRect.top + sourceRect.height / 2;
    const candidates = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/app/"], a[href*="/gem/"]')
    ).map(link => {
      const row = link.closest('[data-test-id="conversation"], [data-test-id^="history-item"], .conversation-card, li');
      if (row instanceof HTMLElement) return row;
      return link.parentElement instanceof HTMLElement ? link.parentElement : link;
    });

    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    Array.from(new Set(candidates)).forEach(candidate => {
      const rect = candidate.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      if (rect.height > 120 || rect.width > 640) return;
      const overlapsY = sourceRect.top <= rect.bottom && sourceRect.bottom >= rect.top;
      const candidateY = rect.top + rect.height / 2;
      const yDistance = Math.abs(candidateY - sourceY);
      const xDistance = Math.abs(rect.right - sourceRect.left);
      const score = yDistance * 8 + xDistance + (overlapsY ? 0 : 1000);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    });

    return best && bestScore < 1500 ? best : null;
  }

  function findConversationNearPoint(point: { x: number; y: number }): HTMLElement | null {
    const rect = new DOMRect(point.x - 2, point.y - 2, 4, 4);
    return findConversationNearRect(rect);
  }

  function findConversationForMenuButton(target: Element): HTMLElement | null {
    const direct = target.closest('[data-test-id="conversation"]');
    if (direct instanceof HTMLElement) return direct;

    const actionsContainer = target.closest('.conversation-actions-container');
    let sibling = actionsContainer?.previousElementSibling;
    while (sibling) {
      if (
        sibling instanceof HTMLElement &&
        (sibling.matches('[data-test-id="conversation"]') || getConversationLink(sibling))
      ) {
        return sibling;
      }
      sibling = sibling.previousElementSibling;
    }

    if (actionsContainer?.parentElement) {
      const siblings = Array.from(actionsContainer.parentElement.children);
      const actionIndex = siblings.indexOf(actionsContainer);
      const nearby = siblings.find((candidate, index) => {
        if (!(candidate instanceof HTMLElement)) return false;
        if (Math.abs(index - actionIndex) > 1) return false;
        return candidate.matches('[data-test-id="conversation"]') || Boolean(getConversationLink(candidate));
      });
      if (nearby instanceof HTMLElement) return nearby;
    }

    const parent = target.closest('[data-test-id^="history-item"], .conversation-card, li, div');
    const linked = parent?.querySelector('a[href*="/app/"], a[href*="/gem/"]');
    if (parent instanceof HTMLElement && linked) return parent;

    const nearby = findConversationNearRect(target.getBoundingClientRect());
    if (nearby) return nearby;

    return null;
  }

  function findNativeConversationMenuTrigger(target: Element): Element | null {
    const isMoreIcon =
      target instanceof HTMLElement &&
      target.tagName.toLowerCase() === 'mat-icon' &&
      normalizeText(target.textContent || '') === 'more_vert';

    if (isMoreIcon) {
      return target.closest('button') || target;
    }

    const trigger = target.closest(
      [
        'button[data-test-id="actions-menu-button"]',
        'button[data-test-id="more-button"]',
        '[data-test-id="actions-menu-button"]',
        '[data-test-id="more-button"]',
        'button.mat-mdc-menu-trigger:has(mat-icon[fonticon="more_vert"])',
        'button.mat-mdc-menu-trigger:has([data-mat-icon-name="more_vert"])',
        'button:has(mat-icon[fonticon="more_vert"])',
        'button:has([data-mat-icon-name="more_vert"])',
        'mat-icon[fonticon="more_vert"]',
        '[data-mat-icon-name="more_vert"]',
        '[aria-label*="More"]',
        '[aria-label*="more"]',
        '[aria-label*="更多"]',
        '[aria-label*="選項"]',
        '[aria-label*="Options"]',
      ].join(', ')
    );
    if (!(trigger instanceof Element)) return null;
    return trigger.closest('button') || trigger;
  }

  function trackNativeMenuClicks() {
    const handlePotentialMenuClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const menuButton = findNativeConversationMenuTrigger(target);
      if (!(menuButton instanceof Element)) return;

      if (event instanceof MouseEvent) {
        lastMenuClickPoint = { x: event.clientX, y: event.clientY };
      }

      const row = findConversationForMenuButton(menuButton) ||
        (lastMenuClickPoint ? findConversationNearPoint(lastMenuClickPoint) : null);
      if (!row) {
        lastClickedConversation = null;
        debugInfo('native menu trigger clicked but no conversation row was found', {
          target: target instanceof HTMLElement ? target.outerHTML.slice(0, 220) : String(target),
          trigger: menuButton instanceof HTMLElement ? menuButton.outerHTML.slice(0, 220) : String(menuButton),
          point: lastMenuClickPoint,
        });
        return;
      }

      const conversation = extractConversationInfo(row);
      if (!conversation) {
        lastClickedConversation = null;
        debugInfo('conversation row found but conversation info could not be extracted', {
          row: row.outerHTML.slice(0, 260),
        });
        return;
      }

      lastClickedConversation = conversation;
      debugInfo('tracked native conversation menu click', conversation);
      pollMoveToFolderMenu();
    };

    document.addEventListener('pointerdown', handlePotentialMenuClick, true);
    document.addEventListener('click', handlePotentialMenuClick, true);
  }

  // After Gemini opens its menu in an overlay, clone a native menu item when
  // possible so our item inherits Gemini's current spacing and typography.
  function setupMoveToFolderMenuObserver() {
    const observer = new MutationObserver(() => {
      if (lastClickedConversation) {
        void injectMoveToFolderMenuItems();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function pollMoveToFolderMenu() {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const inserted = injectMoveToFolderMenuItems();
      if (inserted || attempts >= 24) {
        if (!inserted && attempts >= 24) {
          debugInfo('native menu poll finished without finding an injectable menu target', lastClickedConversation);
        }
        window.clearInterval(timer);
      }
    }, 50);
  }

  function findNativeMenuItemTemplate(menuContent: HTMLElement): HTMLButtonElement | null {
    const directButtons = Array.from(menuContent.children).filter(
      (node): node is HTMLButtonElement =>
        node instanceof HTMLButtonElement && node.classList.contains('mat-mdc-menu-item')
    );
    const nestedButtons = Array.from(menuContent.querySelectorAll<HTMLButtonElement>('button.mat-mdc-menu-item'));
    const candidates = [...directButtons];

    nestedButtons.forEach(button => {
      if (!candidates.includes(button)) candidates.push(button);
    });

    return candidates.find(button => !button.classList.contains('mgh-menu-move-folder')) || null;
  }

  function updateNativeMenuItemIcon(item: HTMLButtonElement, iconName: string) {
    const icon = item.querySelector('mat-icon') as HTMLElement | null;
    if (!icon) return false;

    icon.setAttribute('fonticon', iconName);
    if (icon.hasAttribute('data-mat-icon-name')) {
      icon.setAttribute('data-mat-icon-name', iconName);
    }
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '';
    return true;
  }

  function updateNativeMenuItemLabel(item: HTMLButtonElement, label: string) {
    const textContainer = item.querySelector('.mat-mdc-menu-item-text') as HTMLElement | null;
    if (!textContainer) return false;

    const styledLabel = textContainer.querySelector('.menu-text, .gds-body-m, .gds-label-m, .subtitle');
    if (styledLabel) {
      styledLabel.textContent = label;
    } else {
      textContainer.textContent = label;
    }
    return true;
  }

  function clearNativeMenuItemTemplateState(item: HTMLButtonElement) {
    [
      'data-test-id',
      'id',
      'jslog',
      'jscontroller',
      'jsaction',
      'jsname',
      'aria-describedby',
      'aria-labelledby',
    ].forEach(attribute => item.removeAttribute(attribute));

    [
      'cdk-focused',
      'cdk-keyboard-focused',
      'cdk-program-focused',
      'cdk-mouse-focused',
      'mat-mdc-menu-item-highlighted',
    ].forEach(className => item.classList.remove(className));
  }

  function createMoveToFolderMenuItemFallback(label: string) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'mat-mdc-menu-item mat-focus-indicator mgh-menu-move-folder mgh-menu-move-folder-fallback';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-disabled', 'false');

    const icon = document.createElement('span');
    icon.className = 'mgh-menu-move-folder-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = svgIcon(ICONS.folder, 20);

    const text = document.createElement('span');
    text.className = 'mat-mdc-menu-item-text';
    const innerText = document.createElement('span');
    innerText.className = 'gds-body-m';
    innerText.textContent = label;
    text.appendChild(innerText);

    const ripple = document.createElement('div');
    ripple.className = 'mat-ripple mat-mdc-menu-ripple';
    ripple.setAttribute('matripple', '');

    item.appendChild(icon);
    item.appendChild(text);
    item.appendChild(ripple);
    return item;
  }

  function createMoveToFolderMenuItem(menuContent: HTMLElement, conversation: ConversationItem) {
    const label = '移動至資料夾';
    const template = findNativeMenuItemTemplate(menuContent);
    const item = template?.cloneNode(true) as HTMLButtonElement | undefined;
    let menuItem = item || createMoveToFolderMenuItemFallback(label);

    if (item) {
      clearNativeMenuItemTemplateState(item);
      item.classList.add('mgh-menu-move-folder');
      item.type = 'button';
      item.disabled = false;
      item.setAttribute('role', 'menuitem');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-disabled', 'false');
      item.title = label;
      item.setAttribute('aria-label', label);

      const hasIcon = updateNativeMenuItemIcon(item, 'folder_open');
      const hasLabel = updateNativeMenuItemLabel(item, label);
      if (!hasIcon || !hasLabel) {
        menuItem = createMoveToFolderMenuItemFallback(label);
      }
    }

    menuItem.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      showMoveToFolderDialog(conversation);

      const backdrops = document.querySelectorAll('.cdk-overlay-backdrop');
      const backdrop = backdrops.length > 0 ? backdrops[backdrops.length - 1] : null;
      if (backdrop instanceof HTMLElement) {
        backdrop.click();
      } else {
        const panel = menuItem.closest('.mat-mdc-menu-panel, [role="menu"]');
        panel?.remove();
      }
    });

    return menuItem;
  }

  function attachMoveToFolderMenuItem(target: HTMLElement, conversation: ConversationItem) {
    const item = createMoveToFolderMenuItem(target, conversation);
    const pinButton = target.querySelector('[data-test-id="pin-button"]');
    if (pinButton?.nextSibling) {
      target.insertBefore(item, pinButton.nextSibling);
    } else {
      target.insertBefore(item, target.firstChild);
    }
  }

  function isVisibleMenuCandidate(el: HTMLElement) {
    if (el.querySelector('.mgh-menu-move-folder')) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const hasConversationAction = Boolean(
      el.querySelector(
        [
          '[data-test-id="pin-button"]',
          '[data-test-id="rename-button"]',
          '[data-test-id="share-button"]',
          '[data-test-id="delete-button"]',
        ].join(', ')
      )
    );
    const isModelMenu = Boolean(
      el.closest('.gds-mode-switch-menu') ||
      el.querySelector('.bard-mode-list-button, [data-test-id*="model"], [data-test-id*="mode"]')
    );

    return (
      rect.width > 80 &&
      rect.height > 20 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      hasConversationAction &&
      !isModelMenu
    );
  }

  function findVisibleMenuTargets() {
    const selectors = [
      '.cdk-overlay-pane .mat-mdc-menu-content',
      '.mat-mdc-menu-panel .mat-mdc-menu-content',
      '.mat-mdc-menu-content',
    ];

    const targets = selectors.flatMap(selector =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
    );

    return Array.from(new Set(targets))
      .map(target => (target.querySelector('.mat-mdc-menu-content') as HTMLElement | null) || target)
      .filter(isVisibleMenuCandidate);
  }

  function injectMoveToFolderMenuItems() {
    if (!lastClickedConversation) return false;
    const conversation = lastClickedConversation;
    const targets = findVisibleMenuTargets();
    let inserted = false;

    targets.forEach(target => {
      if (target.querySelector('.mgh-menu-move-folder')) return;
      attachMoveToFolderMenuItem(target, conversation);
      debugInfo('inserted Move to Folder into native menu', conversation);
      inserted = true;
    });

    return inserted;
  }

  function cleanupNativeConversationActions() {
    document.querySelectorAll('.mgh-native-folder-action').forEach(action => action.remove());
    document.querySelectorAll<HTMLElement>('.mgh-native-conversation-action-host').forEach(host => {
      host.classList.remove('mgh-native-conversation-action-host');
    });
    document.querySelectorAll<HTMLElement>('.mgh-native-conversation-row').forEach(row => {
      row.classList.remove('mgh-native-conversation-row');
      row.style.removeProperty('--mgh-action-space');
      delete row.dataset.mghFolderActionInjected;
    });
  }

  function findRecentSection(): Element | null {
    let list = document.querySelector('[data-test-id="all-conversations"]');
    if (!list) list = document.querySelector('.chat-history');
    if (!list) {
      const items = document.querySelectorAll('[data-test-id="conversation"]');
      if (items.length > 0) {
        list = items[0].closest('.chat-history, [class*="conversation"]');
      }
    }
    return list;
  }

  // Render our compact folder section above Gemini's recent conversation list.
  function createFolder(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = uid('folder');
    appData.folders.push({
      id,
      name: trimmed,
      isExpanded: true,
      parentId: null,
      sortIndex: appData.folders.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    appData.folderContents[id] = [];
    saveData();
    if (folderListEl) renderFolderList(folderListEl);
    showFolderNotice(`Created folder: ${trimmed}`);
  }

  function showNewFolderForm() {
    const wrapper = document.getElementById('gv-folder-wrapper');
    if (!wrapper || wrapper.querySelector('.mgh-new-folder-form')) return;

    const form = document.createElement('form');
    form.className = 'mgh-new-folder-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'New folder name';
    input.maxLength = 80;

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => form.remove());

    form.addEventListener('submit', event => {
      event.preventDefault();
      createFolder(input.value);
      form.remove();
    });

    form.appendChild(input);
    form.appendChild(saveBtn);
    form.appendChild(cancelBtn);

    const header = wrapper.querySelector('.gv-folder-list-header');
    header?.insertAdjacentElement('afterend', form);
    input.focus();
  }

  function showDeleteFolderConfirm(folderId: string) {
    const folder = appData.folders.find(item => item.id === folderId);
    if (!folder) return;

    const existingOverlay = document.querySelector('.mgh-folder-confirm-overlay');
    existingOverlay?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'mgh-folder-confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'mgh-folder-confirm-dialog';

    const title = document.createElement('h2');
    title.textContent = 'Delete folder';

    const message = document.createElement('p');
    const count = appData.folderContents[folderId]?.length || 0;
    message.textContent = `Delete "${folder.name}" and remove ${count} saved session reference${count === 1 ? '' : 's'} from this folder?`;

    const actions = document.createElement('div');
    actions.className = 'mgh-folder-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'mgh-danger-button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      deleteFolder(folderId);
      overlay.remove();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(deleteBtn);
    dialog.appendChild(title);
    dialog.appendChild(message);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  // Keep a stable reference so we can update without re-creating the whole wrapper.
  let folderListEl: HTMLElement | null = null;

  function renderFolderList(container: HTMLElement) {
    container.innerHTML = '';
    const sorted = [...appData.folders].sort((a, b) => a.sortIndex - b.sortIndex);

    sorted.forEach(folder => {
      const folderEl = document.createElement('div');
      folderEl.className = 'gv-folder-item';

      // --- Header ---
      const headerEl = document.createElement('div');
      headerEl.className = 'gv-folder-header';

      const chevronSpan = document.createElement('span');
      chevronSpan.className = 'gv-chevron';
      chevronSpan.innerHTML = svgIcon(folder.isExpanded ? ICONS.chevronD : ICONS.chevronR);

      const folderIconSpan = document.createElement('span');
      folderIconSpan.className = 'gv-folder-icon';
      folderIconSpan.innerHTML = svgIcon(ICONS.folder);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'gv-folder-name';
      nameSpan.textContent = folder.name;

      const folderActions = document.createElement('div');
      folderActions.className = 'mgh-folder-actions';

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'mgh-folder-action';
      renameBtn.title = 'Rename folder';
      renameBtn.innerHTML = svgIcon(ICONS.edit, 15);
      renameBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const input = document.createElement('input');
        input.className = 'mgh-folder-rename-input';
        input.type = 'text';
        input.value = folder.name;
        input.maxLength = 80;

        const originalName = folder.name;
        const commit = () => {
          const nextName = input.value.trim();
          if (nextName && nextName !== originalName) {
            renameFolder(folder.id, nextName);
          } else if (folderListEl) {
            renderFolderList(folderListEl);
          }
        };

        input.addEventListener('click', inputEvent => inputEvent.stopPropagation());
        input.addEventListener('keydown', inputEvent => {
          if (inputEvent.key === 'Enter') {
            inputEvent.preventDefault();
            commit();
          }
          if (inputEvent.key === 'Escape' && folderListEl) {
            inputEvent.preventDefault();
            renderFolderList(folderListEl);
          }
        });
        input.addEventListener('blur', commit, { once: true });

        nameSpan.replaceWith(input);
        input.focus();
        input.select();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'mgh-folder-action mgh-folder-action-danger';
      deleteBtn.title = 'Delete folder';
      deleteBtn.innerHTML = svgIcon(ICONS.delete, 15);
      deleteBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        showDeleteFolderConfirm(folder.id);
      });

      folderActions.appendChild(renameBtn);
      folderActions.appendChild(deleteBtn);

      headerEl.appendChild(chevronSpan);
      headerEl.appendChild(folderIconSpan);
      headerEl.appendChild(nameSpan);
      headerEl.appendChild(folderActions);

      headerEl.addEventListener('click', () => {
        folder.isExpanded = !folder.isExpanded;
        saveData();
        renderFolderList(container);
      });

      folderEl.appendChild(headerEl);

      // --- Contents ---
      if (folder.isExpanded) {
        const contentsEl = document.createElement('div');
        contentsEl.className = 'gv-folder-contents';

        const items = (appData.folderContents[folder.id] || []).sort((a, b) => a.sortIndex - b.sortIndex);
        items.forEach(item => {
          const itemEl = document.createElement('a');
          itemEl.className = 'gv-conversation-item';
          itemEl.href = item.url;

          const chatIcon = document.createElement('span');
          chatIcon.className = 'gv-chat-icon';
          chatIcon.innerHTML = svgIcon(ICONS.chat, 16);

          const titleSpan = document.createElement('span');
          titleSpan.className = 'gv-conv-title';
          titleSpan.textContent = item.title;

          const actionsDiv = document.createElement('div');
          actionsDiv.className = 'gv-conv-actions';

          const starBtn = document.createElement('span');
          starBtn.className = `gv-star-icon${item.starred ? ' active' : ''}`;
          starBtn.innerHTML = svgIcon(ICONS.star, 16);
          starBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.starred = !item.starred;
            saveData();
            renderFolderList(container);
          });

          const delBtn = document.createElement('span');
          delBtn.className = 'gv-delete-icon';
          delBtn.innerHTML = svgIcon(ICONS.close, 16);
          delBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            appData.folderContents[folder.id] = appData.folderContents[folder.id].filter(
              c => c.conversationId !== item.conversationId
            );
            saveData();
            renderFolderList(container);
          });

          actionsDiv.appendChild(starBtn);
          actionsDiv.appendChild(delBtn);

          itemEl.appendChild(chatIcon);
          itemEl.appendChild(titleSpan);
          itemEl.appendChild(actionsDiv);
          contentsEl.appendChild(itemEl);
        });

        folderEl.appendChild(contentsEl);
      }

      container.appendChild(folderEl);
    });
  }

  // Gemini can replace the sidebar during navigation, so ensureWrapper is
  // idempotent and safe to call repeatedly.
  function ensureWrapper() {
    const recentSection = findRecentSection();
    if (!recentSection || !recentSection.parentElement) return;

    let wrapper = document.getElementById('gv-folder-wrapper');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = 'gv-folder-wrapper';

      // --- Header ---
      const header = document.createElement('div');
      header.className = 'gv-folder-list-header';

      const title = document.createElement('span');
      title.className = 'gv-folder-list-title';
      title.textContent = '資料夾';

      const actions = document.createElement('div');
      actions.className = 'gv-folder-list-actions';

      const btns: Array<{ title: string; icon: string; handler: () => void }> = [
        { title: 'Collapse All', icon: ICONS.collapse, handler: collapseAllFolders },
        { title: 'Import Folders', icon: ICONS.upload, handler: importFolderData },
        { title: 'Export Folders', icon: ICONS.download, handler: exportFolderData },
        { title: 'Add Folder', icon: ICONS.add, handler: showNewFolderForm },
      ];
      btns.forEach(({ title: title_, icon, handler }) => {
        const btn = document.createElement('button');
        btn.className = 'gv-icon-btn';
        btn.title = title_;
        btn.innerHTML = svgIcon(icon);
        btn.addEventListener('click', handler);
        actions.appendChild(btn);
      });

      header.appendChild(title);
      header.appendChild(actions);

      // --- Folder list container ---
      const listEl = document.createElement('div');
      listEl.className = 'gv-folder-list';
      folderListEl = listEl;

      wrapper.appendChild(header);
      wrapper.appendChild(listEl);
      recentSection.parentElement.insertBefore(wrapper, recentSection);

      renderFolderList(listEl);
    }
  }

  setInterval(ensureWrapper, 3000);
  trackNativeMenuClicks();
  setupMoveToFolderMenuObserver();
  ensureWrapper();
  cleanupNativeConversationActions();
}
