# Gemini Minimal Helper

A lightweight, privacy-first Chrome extension tailored for Gemini users who want cleaner prompt navigation and local session organization. Inspired by [gemini-voyager](https://github.com/Nagi-ovo/gemini-voyager), while keeping the scope smaller and local-first.

## ✨ Features

- **Prompt History Rail**: Shows a compact right-side timeline for prompts in the current Gemini conversation, with hover preview and click-to-scroll.
- **Prompt Library**: Saves reusable prompts locally with title, tags, search, copy, and insert support.
- **Session Folders**: Adds local folders for Gemini conversation references, including rename, delete, collapse, import/export, and "Move to folder" from Gemini's native conversation menu.
- **Pinned Model**: Adds pin controls to Gemini's model menu and attempts to reselect the preferred model on page load.
- **Privacy-First Storage**: Keeps user data in `chrome.storage.local` with no cloud sync, analytics, or remote API calls.

## 🛠 Tech Stack

1. **Chrome Manifest V3**
   ```json
   {
     "permissions": ["storage"],
     "host_permissions": ["https://gemini.google.com/*"]
   }
   ```

2. **Vite + TypeScript**
   ```bash
   npm run build
   ```

3. **Plain DOM Content Script**
   - Injects the proportional prompt history rail.
   - Injects the local prompt library.
   - Adds pinned-model controls to Gemini's native model selector.
   - Injects folder UI near Gemini's conversation sidebar.
   - Extends Gemini's native conversation menu with a cloned "Move to folder" menu item.

4. **Local Chrome Storage**
   - `mghPromptItems`: saved prompt library.
   - `mghFolderData`: session folders and conversation references.
   - `mghPinnedModel`: preferred Gemini model label.
   - `gemini_voyager_data`: legacy migration source only.

## 🚀 Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Build Extension**
   ```bash
   npm run build
   ```

3. **Load in Chrome**
   Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select:
   ```text
   dist/
   ```

4. **Open Gemini**
   Visit:
   ```text
   https://gemini.google.com/
   ```

During development, reload the unpacked extension from `chrome://extensions` and refresh the Gemini tab. Removing the extension also removes its local Chrome storage. Use **Export Folders** before removing the extension, switching Chrome profiles, or moving to another machine; use **Import Folders** to restore the JSON backup.

## 💡 Architecture Detail

```text
my-gemini-ext/
├── manifest.json              # MV3 permissions and Gemini content-script registration
├── vite.config.ts             # Vite + CRX build configuration
└── src/
    ├── content.ts             # Content-script entry point
    ├── content.css            # Injected Gemini UI styles
    ├── features/
    │   ├── folders.ts         # Session folders, native menu integration, import/export
    │   ├── pinnedModel.ts     # Pinned Gemini model selection
    │   ├── promptHistory.ts   # Right-side proportional prompt rail
    │   └── promptLibrary.ts   # Local reusable prompt library
    └── shared/
        ├── debug.ts           # Versioned debug logging
        ├── icons.ts           # Shared SVG icons
        ├── storage.ts         # Chrome local storage helpers and keys
        └── text.ts            # Text normalization, truncation, IDs, clipboard
```

The implementation is intentionally framework-light. Injected UI is built with native DOM APIs to keep the extension small and easy to audit.

## 🎯 Design Principles

1. **Local by Default**
   > User prompts, saved prompt library entries, and folder data should stay in `chrome.storage.local`.

2. **Gemini Only**
   > Scope the extension to `https://gemini.google.com/*` unless a future feature clearly needs more.

3. **Small Surface Area**
   > Prefer TypeScript, CSS, and browser APIs over large UI frameworks or extra runtime dependencies.

## 📌 Todos

1. **Prompt History Improvements**
   > Harden Gemini prompt selectors and handle route changes more reliably across Gemini UI updates.

2. **Prompt Library Polish**
   > Improve Gemini input insertion, add import/export JSON, and refine keyboard accessibility.

3. **Pinned Model Robustness**
   > Harden model selector detection against Gemini UI updates and add clearer fallback messaging when a pinned model is unavailable.

4. **Session Folder Workflow**
   > Add drag-and-drop ordering for folders and saved conversation references.

5. **Folder Data Quality**
   > Sync renamed conversation titles, preserve sort order consistently, and improve duplicate handling across folders.

6. **增加現在是載哪一個 prompt position feature**

7. **淺色主題下調整 folder management、 prompt history 顏色**
   
8. **如果之後要再更輕，我會優先做這幾件：**

   1. 把 promptHistory 的 MutationObserver 加 debounce，避免 Gemini 大量 DOM 變動時一直重算。
   2. 把 folders 的 body observer 改成更 scoped 的 overlay/sidebar observer。
   3. ensureWrapper 可以在成功找到 sidebar 後降低 polling，或只在 URL/sidebar mutation 時跑。
   4. 未來如果功能變多，可以加 feature toggles，讓 user 關掉不用的功能。


## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
