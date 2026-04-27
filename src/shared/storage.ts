// Centralized storage keys keep local data ownership clear and easy to audit.
export const STORAGE_KEYS = {
  folders: 'mghFolderData',
  // One-time migration source for users who previously had Voyager folder data.
  legacyFolders: 'gemini_voyager_data',
  pinnedModel: 'mghPinnedModel',
  prompts: 'mghPromptItems',
} as const;

let extensionContextActive = true;

function isExtensionContextError(error: unknown) {
  return error instanceof Error && /Extension context invalidated/i.test(error.message);
}

export function canUseExtensionStorage() {
  return extensionContextActive && typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
}

export function handleStorageError(action: 'read' | 'write', key: string, error: unknown) {
  if (isExtensionContextError(error)) {
    // Chrome invalidates the old content-script context after extension reloads.
    // Stop future storage calls so Gemini does not spam console errors.
    extensionContextActive = false;
    return;
  }
  console.error(`[MGH] Failed to ${action} storage`, key, error);
}

export async function readLocalStorage<T>(key: string, fallback: T): Promise<T> {
  if (!canUseExtensionStorage()) return fallback;

  try {
    const result = await chrome.storage.local.get(key);
    return (result[key] as T | undefined) ?? fallback;
  } catch (error) {
    handleStorageError('read', key, error);
    return fallback;
  }
}

export async function writeLocalStorage<T>(key: string, value: T): Promise<void> {
  if (!canUseExtensionStorage()) return;

  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (error) {
    handleStorageError('write', key, error);
  }
}
