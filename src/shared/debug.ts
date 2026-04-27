const MGH_VERSION = 'dev-2026-04-27-jslog-menu';

export function debugInfo(message: string, data?: unknown) {
  console.info(`[MGH ${MGH_VERSION}] ${message}`, data ?? '');
}
