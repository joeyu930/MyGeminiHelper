import './content.css';

import { initFolders } from './features/folders';
import { cleanupPinnedModelUi, initPinnedModel } from './features/pinnedModel';
import { initPromptHistoryRail } from './features/promptHistory';
import { initPromptLibrary } from './features/promptLibrary';
import { debugInfo } from './shared/debug';

// Content scripts run directly inside Gemini pages. Keep this file as the
// orchestrator only; feature-specific DOM/storage logic lives under features/.
function initContentScript() {
  debugInfo('content script loaded');
  initPromptHistoryRail();
  cleanupPinnedModelUi();
  void initPinnedModel();
  void initPromptLibrary();
  void initFolders();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript, { once: true });
} else {
  initContentScript();
}
