## Verification Checklist

After changing content-script behavior, verify:

- The right-side prompt history rail appears on Gemini conversation pages.
- Prompt markers spread proportionally to prompt positions in the conversation.
- Hover previews are readable and do not cover important controls.
- Hover previews do not include Gemini's "You said" / "你說了" label.
- Clicking a marker scrolls to the expected user prompt.
- Prompt library entries persist after refresh.
- Search and tag filters work.
- Copy works from the prompt library.
- Insert works with Gemini's current input DOM.
- Opening Gemini's model menu shows pin stars beside model options.
- A pinned model persists in `mghPinnedModel` and is reselected on page load when available.
- Folder data persists in `mghFolderData`.
- Folders can be created, renamed, and deleted.
- Sessions can be added from the current page and from Gemini's native conversation menu.
- Folder JSON export and import work from the folder toolbar.