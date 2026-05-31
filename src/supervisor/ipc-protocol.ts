// SPDX-License-Identifier: MIT
import { z } from 'zod';

export const RpcRequestSchema = z.object({
  id: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcResponseSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

export const WorkerStateSchema = z.enum(['starting', 'ready', 'crashed', 'restarting', 'disabled', 'stopped']);
export type WorkerState = z.infer<typeof WorkerStateSchema>;

export const WorkerStatusSchema = z.object({
  bot: z.string(),
  pid: z.number().int().positive().optional(),
  state: WorkerStateSchema,
  startedAt: z.string().optional(),
  lastError: z.string().optional(),
  restartCount: z.number().int().nonnegative(),
});
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

export const ListWorkersResultSchema = z.object({
  workers: z.array(WorkerStatusSchema),
  supervisorPid: z.number(),
  supervisorStartedAt: z.string(),
});

export const Methods = {
  ping: 'ping',
  listWorkers: 'list-workers',
  restartWorker: 'restart-worker',
  reloadWorker: 'reload-worker',
  shutdown: 'shutdown',
} as const;
