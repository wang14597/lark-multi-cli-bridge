// SPDX-License-Identifier: MIT
import { readJsonOrDefault, writeJsonAtomic } from '../util/atomic-file.js';
import type { ChatSession, SessionsFile } from './types.js';

export interface SessionStoreOpts {
  /** The bot this store belongs to — enables one-time migration from the
   *  legacy shared file (see `legacyPath`). */
  botName?: string;
  /** Path to the legacy single shared sessions.json. When set and this
   *  store's own (per-bot) file is empty on first load, this bot's slots are
   *  extracted from the shared file into the per-bot file, once. */
  legacyPath?: string;
}

/**
 * SessionStore is scoped per (chatId, botName). A chat used by multiple
 * bots over time keeps each bot's sessionId / cwd in its own slot so that
 * a chat between claude-bot and codex-bot in the same group doesn't make
 * them step on each other's continuation IDs (which live in disjoint
 * namespaces — a claude UUID is not a valid codex thread_id and vice
 * versa).
 *
 * Each per-bot worker points its store at its OWN file (state/sessions/
 * <bot>.json). Earlier a single shared sessions.json was rewritten wholesale
 * by every worker from a stale in-memory snapshot, so sibling workers
 * clobbered each other's updates — after a restart a bot could resume the
 * wrong (stale) session. Per-bot files give each worker a single-writer file.
 */
export class SessionStore {
  private data: SessionsFile = { chats: {} };
  constructor(
    private filePath: string,
    private opts: SessionStoreOpts = {},
  ) {}

  async load(): Promise<void> {
    const raw = await readJsonOrDefault<unknown>(this.filePath, { chats: {} });
    this.data = migrateIfNeeded(raw);

    // One-time migration: if this per-bot file is empty but a legacy shared
    // sessions.json exists, pull just THIS bot's slots out of it. Each bot's
    // worker migrates its own slice; the shared file is left untouched.
    if (
      Object.keys(this.data.chats).length === 0 &&
      this.opts.legacyPath &&
      this.opts.botName
    ) {
      const legacy = migrateIfNeeded(
        await readJsonOrDefault<unknown>(this.opts.legacyPath, { chats: {} }),
      );
      const extracted = extractBot(legacy, this.opts.botName);
      if (Object.keys(extracted.chats).length > 0) {
        this.data = extracted;
        await this.persist();
        return;
      }
    }

    // Persist immediately if the on-disk file was legacy v1 — that way the
    // next load() is a no-op and ops tooling sees the new shape.
    if (raw !== this.data && Object.keys(this.data.chats).length > 0) {
      await this.persist();
    }
  }

  get(chatId: string, botName: string): ChatSession | undefined {
    return this.data.chats[chatId]?.[botName];
  }

  /**
   * Flatten the 2D map into a list. Each entry pairs (chatId, botName)
   * with its session. Used by /sessions to render per-bot listings.
   */
  list(): Array<{ chatId: string; botName: string; session: ChatSession }> {
    const out: Array<{ chatId: string; botName: string; session: ChatSession }> = [];
    for (const [chatId, byBot] of Object.entries(this.data.chats)) {
      for (const [botName, session] of Object.entries(byBot)) {
        out.push({ chatId, botName, session });
      }
    }
    return out;
  }

  async upsert(
    chatId: string,
    patch: Partial<ChatSession> & Pick<ChatSession, 'backend' | 'bot' | 'cwd'>,
  ): Promise<ChatSession> {
    const chatSlot = (this.data.chats[chatId] ??= {});
    const existing = chatSlot[patch.bot];
    const sessionId = patch.sessionId ?? existing?.sessionId;
    // Preserve a per-chat /timeout override across upserts unless the caller
    // explicitly sets a new one — it's a chat preference, not per-session-id.
    const idleTimeoutMs = patch.idleTimeoutMs ?? existing?.idleTimeoutMs;
    const next: ChatSession = {
      backend: patch.backend,
      bot: patch.bot,
      cwd: patch.cwd,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(idleTimeoutMs !== undefined ? { idleTimeoutMs } : {}),
      lastUsedAt: new Date().toISOString(),
      messageCount: (existing?.messageCount ?? 0) + 1,
    };
    chatSlot[patch.bot] = next;
    await this.persist();
    return next;
  }

  async reset(chatId: string, botName: string): Promise<void> {
    const existing = this.data.chats[chatId]?.[botName];
    if (!existing) return;
    const { sessionId: _sessionId, ...rest } = existing;
    this.data.chats[chatId]![botName] = {
      ...rest,
      lastUsedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  async setCwd(
    chatId: string,
    botName: string,
    cwd: string,
    resetSession: boolean,
  ): Promise<void> {
    const existing = this.data.chats[chatId]?.[botName];
    if (!existing) throw new Error(`chat not initialized: ${chatId} / ${botName}`);
    if (resetSession) {
      const { sessionId: _sessionId, ...rest } = existing;
      this.data.chats[chatId]![botName] = {
        ...rest,
        cwd,
        lastUsedAt: new Date().toISOString(),
      };
    } else {
      this.data.chats[chatId]![botName] = {
        ...existing,
        cwd,
        lastUsedAt: new Date().toISOString(),
      };
    }
    await this.persist();
  }

  /**
   * Set (or clear) the per-chat idle-timeout override for a slot. Pass
   * `undefined` to clear it and fall back to the bot default. Throws if the
   * slot doesn't exist yet — callers should upsert first.
   */
  async setIdleTimeout(
    chatId: string,
    botName: string,
    ms: number | undefined,
  ): Promise<void> {
    const existing = this.data.chats[chatId]?.[botName];
    if (!existing) throw new Error(`chat not initialized: ${chatId} / ${botName}`);
    const { idleTimeoutMs: _drop, ...rest } = existing;
    this.data.chats[chatId]![botName] = {
      ...rest,
      ...(ms !== undefined ? { idleTimeoutMs: ms } : {}),
      lastUsedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeJsonAtomic(this.filePath, this.data);
  }
}

/**
 * Return a copy of `data` containing only the slots belonging to `botName`
 * (keyed the same 2D way, but every chat has at most this one bot). Used to
 * carve a per-bot file out of the legacy shared sessions.json.
 */
function extractBot(data: SessionsFile, botName: string): SessionsFile {
  const out: SessionsFile = { chats: {} };
  for (const [chatId, byBot] of Object.entries(data.chats)) {
    const slot = byBot[botName];
    if (slot) out.chats[chatId] = { [botName]: slot };
  }
  return out;
}

/**
 * Migrate legacy v1 schema in-place. v1 stored `chats[chatId]` directly
 * as a ChatSession; v2 nests `chats[chatId][botName]`. Detection looks at
 * whether the value has a top-level `backend` field (v1 marker — v2 slot
 * values are bot-name dicts where the *children* carry `backend`).
 *
 * Returns the input unchanged when it's already v2 or a plain empty file.
 */
function migrateIfNeeded(raw: unknown): SessionsFile {
  if (!raw || typeof raw !== 'object') return { chats: {} };
  const r = raw as { chats?: Record<string, unknown> };
  if (!r.chats || typeof r.chats !== 'object') return { chats: {} };

  // Detect: peek at any value. If it has a `backend` string property, it's
  // a v1 ChatSession; otherwise it's already a botName → ChatSession dict.
  const sampleVal = Object.values(r.chats).find((v) => v && typeof v === 'object');
  if (!sampleVal) return { chats: {} };
  const isV1 = 'backend' in (sampleVal as object);
  if (!isV1) return r as SessionsFile;

  const migrated: SessionsFile = { chats: {} };
  for (const [chatId, session] of Object.entries(r.chats)) {
    const s = session as ChatSession;
    if (!s.bot) continue; // skip malformed
    migrated.chats[chatId] = { [s.bot]: s };
  }
  return migrated;
}
