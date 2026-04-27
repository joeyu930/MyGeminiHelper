export function uid(prefix: string) {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

// Gemini text often contains extra whitespace from nested DOM nodes.
export function normalizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, max = 180) {
  const normalized = normalizeText(text);
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for pages where the async clipboard API is blocked.
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  }
}
