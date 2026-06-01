// SPDX-License-Identifier: MIT
import { z } from 'zod';

const OpenId = z.string().regex(/^ou_[A-Za-z0-9]+$/, 'must be a Lark open_id (ou_...)');
const ChatId = z.string().regex(/^oc_[A-Za-z0-9]+$/, 'must be a Lark chat_id (oc_...)');

export const SecretRefSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('keychain'), key: z.string() }),
  z.object({ source: z.literal('exec'), command: z.string(), args: z.array(z.string()).default([]) }),
  z.object({ source: z.literal('env'), var: z.string() }),
]);

const LarkAccountSchema = z
  .object({
    app_id: z.string(),
    app_secret: z.string().optional(),
    app_secret_ref: SecretRefSchema.optional(),
    tenant: z.enum(['lark', 'feishu']).default('lark'),
  })
  .refine((v) => v.app_secret || v.app_secret_ref, 'either app_secret or app_secret_ref is required');

const ClaudeBackendSchema = z.object({
  type: z.literal('claude'),
  claude: z.object({
    model: z.string().optional(),
    permission_mode: z.enum(['default', 'bypassPermissions', 'plan']).default('bypassPermissions'),
    extra_args: z.array(z.string()).default([]),
  }),
  injectSkillPrompt: z.boolean().optional(),
  appendSystemPrompt: z.string().optional(),
});

const CodexBackendSchema = z.object({
  type: z.literal('codex'),
  codex: z.object({
    model: z.string().optional(),
    json_mode: z.boolean().default(true),
    extra_args: z.array(z.string()).default([]),
  }),
  injectSkillPrompt: z.boolean().optional(),
  appendSystemPrompt: z.string().optional(),
});

const GeminiBackendSchema = z.object({
  type: z.literal('gemini'),
  gemini: z.object({
    model: z.string().optional(),
    extra_args: z.array(z.string()).default([]),
  }),
  injectSkillPrompt: z.boolean().optional(),
  appendSystemPrompt: z.string().optional(),
});

export const BackendSchema = z.discriminatedUnion('type', [
  ClaudeBackendSchema,
  CodexBackendSchema,
  GeminiBackendSchema,
]);

export const AccessSchema = z.object({
  allowed_users: z.array(OpenId).default([]),
  allowed_chats: z.array(ChatId).default([]),
  admins: z.array(OpenId).default([]),
});

export const BehaviorSchema = z.object({
  default_cwd: z.string().default('~'),
  group_trigger: z.enum(['mention', 'always']).default('mention'),
  idle_timeout_seconds: z.number().int().positive().default(600),
  max_concurrent_chats: z.number().int().nonnegative().default(0),
});

export const BotConfigSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'lowercase kebab-case'),
  enabled: z.boolean().default(true),
  lark: LarkAccountSchema,
  backend: BackendSchema,
  access: AccessSchema.default({ allowed_users: [], allowed_chats: [], admins: [] }),
  behavior: BehaviorSchema.default({
    default_cwd: '~',
    group_trigger: 'mention',
    idle_timeout_seconds: 600,
    max_concurrent_chats: 0,
  }),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;
export type Backend = z.infer<typeof BackendSchema>;
export type BackendType = Backend['type'];

const PartialBehaviorSchema = z.object({
  default_cwd: z.string().default('~'),
  group_trigger: z.enum(['mention', 'always']).default('mention'),
  idle_timeout_seconds: z.number().int().positive().default(600),
  max_concurrent_chats: z.number().int().nonnegative().default(0),
}).partial().transform((v) => ({
  default_cwd: v.default_cwd ?? '~',
  group_trigger: v.group_trigger ?? 'mention',
  idle_timeout_seconds: v.idle_timeout_seconds ?? 600,
  max_concurrent_chats: v.max_concurrent_chats ?? 0,
}));

export const GlobalConfigSchema = z.object({
  log_retention_days: z.number().int().positive().default(7),
  ipc_socket: z.string().optional(),
  metrics: z
    .object({
      enabled: z.boolean().default(false),
      port: z.number().int().positive().default(9099),
    })
    .default({ enabled: false, port: 9099 }),
  defaults: z
    .object({
      behavior: PartialBehaviorSchema.default({}),
    })
    .default({ behavior: {} }),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
