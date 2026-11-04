// SPDX-License-Identifier: MIT
import type { ChatBot } from '../lark/client.js';
import type { TeamMembers } from '../session/team.js';

/**
 * `<team_roster>` block injected after `<bridge_context>`. Empty roster → ''
 * so chats that never ran `/team` see no change. A bot absent from the roster
 * still sees its teammates. `chatBots` (this app's view of the chat's bot
 * members) adds a ready-to-paste `<at>` tag per teammate so the bot needn't
 * look ids up; a teammate with no match just has no tag.
 */
export function buildTeamRoster(
  botName: string,
  members: TeamMembers,
  chatBots: ChatBot[] = [],
): string {
  const entries = Object.entries(members);
  if (entries.length === 0) return '';
  const self = members[botName];
  const others = entries.filter(([name]) => name !== botName);
  const lines = ['<team_roster>', `you: ${botName} — ${self ? self.role : '(no role assigned)'}`];
  if (others.length > 0) {
    lines.push('members:');
    for (const [name, m] of others) {
      // Lark display names ("wl-codex-bot") wrap the lmcb name ("codex-bot").
      const hit = chatBots.find((b) => b.name.toLowerCase().includes(name.toLowerCase()));
      lines.push(
        `- ${name} — ${m.role}` +
          (hit ? ` — mention: <at user_id="${hit.openId}">${hit.name}</at>` : ''),
      );
    }
  }
  lines.push('</team_roster>');
  return lines.join('\n');
}

const OK_TTL_MS = 10 * 60_000;
// Failures (e.g. app lacks im:chat.members:read) retry sooner but not every message.
const FAIL_TTL_MS = 60_000;

/** Per-chat cache over `fetch` so the members API isn't hit on every turn. */
export function makeChatBotsLookup(
  fetch: (chatId: string) => Promise<ChatBot[]>,
  now: () => number = Date.now,
): (chatId: string) => Promise<ChatBot[]> {
  const cache = new Map<string, { until: number; bots: ChatBot[] }>();
  return async (chatId) => {
    const hit = cache.get(chatId);
    if (hit && hit.until > now()) return hit.bots;
    const bots = await fetch(chatId);
    cache.set(chatId, { until: now() + (bots.length > 0 ? OK_TTL_MS : FAIL_TTL_MS), bots });
    return bots;
  };
}
