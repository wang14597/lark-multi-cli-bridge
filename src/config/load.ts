// SPDX-License-Identifier: MIT
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import yaml from 'js-yaml';
import { BotConfigSchema, GlobalConfigSchema, type BotConfig, type GlobalConfig } from './schema.js';

export async function loadGlobalConfig(file: string): Promise<GlobalConfig> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = yaml.load(raw);
    return GlobalConfigSchema.parse(parsed ?? {});
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return GlobalConfigSchema.parse({});
    }
    throw err;
  }
}

export async function loadAllBots(botsDir: string): Promise<BotConfig[]> {
  let entries: string[];
  try {
    entries = await readdir(botsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: BotConfig[] = [];
  for (const entry of entries) {
    if (!(entry.endsWith('.yaml') || entry.endsWith('.yml'))) continue;
    const filePath = join(botsDir, entry);
    const filenameStem = basename(entry, extname(entry));
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = BotConfigSchema.parse(yaml.load(raw));
      if (parsed.name !== filenameStem) {
        console.warn(`[config] bot file ${entry}: name=${parsed.name} does not match filename; skipping`);
        continue;
      }
      out.push(parsed);
    } catch (err) {
      console.warn(`[config] failed to load ${entry}: ${(err as Error).message}`);
    }
  }
  return out;
}
