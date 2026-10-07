import { config } from "./config";
import { EMPTY_FILTERS, type ChatPrefs, type Filters, type SearchParams, type SearchSession } from "./types";

const prefs = new Map<number, ChatPrefs>();
const sessions = new Map<number, SearchSession>();

export function getPrefs(chatId: number): ChatPrefs {
  const existing = prefs.get(chatId);
  if (existing) return existing;
  const fresh: ChatPrefs = { gl: config.defaultGl, hl: config.defaultHl, max: config.maxResults };
  prefs.set(chatId, fresh);
  return fresh;
}

export function updatePrefs(chatId: number, partial: Partial<ChatPrefs>): ChatPrefs {
  const current = getPrefs(chatId);
  const next = { ...current, ...partial };
  prefs.set(chatId, next);
  return next;
}

export function getSession(chatId: number): SearchSession | undefined {
  return sessions.get(chatId);
}

export function createSession(chatId: number, params: SearchParams, filters: Partial<Filters> = {}): SearchSession {
  const session: SearchSession = {
    params,
    results: [],
    start: 0,
    hasMore: false,
    pages: 0,
    filters: { ...EMPTY_FILTERS, ...filters },
    busy: false,
  };
  sessions.set(chatId, session);
  return session;
}

export function clearSession(chatId: number): void {
  sessions.delete(chatId);
}

// Memoria corta de conversación para el agente IA
const history = new Map<number, string[]>();

export function getHistory(chatId: number): string[] {
  return history.get(chatId) || [];
}

export function pushHistory(chatId: number, userText: string, botReply: string): void {
  const lines = history.get(chatId) || [];
  lines.push(`Usuario: ${userText.slice(0, 300)}`);
  lines.push(`Asistente: ${botReply.slice(0, 300)}`);
  while (lines.length > 8) lines.shift();
  history.set(chatId, lines);
}
