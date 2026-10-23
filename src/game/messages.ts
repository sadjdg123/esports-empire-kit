// Inbox messages (P1). Kept apart so every game module can post without import cycles.

import type { GameState, InboxKind, InboxMessage } from './state';

const MAX_INBOX = 200;

export function postMessage(state: GameState, kind: InboxKind, title: string, body: string, data?: Record<string, string | number>): InboxMessage {
  const m: InboxMessage = { id: state.nextMessageId++, season: state.calendar.season, day: state.calendar.day, kind, title, body, read: false };
  if (data) m.data = data;
  state.inbox.push(m);
  if (state.inbox.length > MAX_INBOX) state.inbox = state.inbox.slice(-MAX_INBOX);
  return m;
}
