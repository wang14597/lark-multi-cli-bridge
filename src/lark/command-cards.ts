// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../commands/types.js';
import type { Access } from '../auth/access-control.js';

// ─── primitive helpers (mirroring reference templates.ts style) ───────────────

interface ButtonSpec {
  text: string;
  value: Record<string, unknown>;
  style?: 'primary' | 'danger' | 'default';
}

function button(spec: ButtonSpec): object {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: spec.text },
    type: spec.style ?? 'default',
    behaviors: [{ type: 'callback', value: spec.value }],
  };
}

function divMd(content: string): object {
  return { tag: 'markdown', content };
}

function actionRow(buttons: ButtonSpec[]): object {
  return { tag: 'action', actions: buttons.map(button) };
}

const HR: object = { tag: 'hr' };

/**
 * Build a schema-2.0 card shell with a header title and body elements.
 */
function shell(title: string, elements: object[]): object {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template: 'blue',
    },
    body: { elements },
  };
}

function escapeMd(s: string): string {
  return s.replace(/([*_`\\])/g, '\\$1');
}

function escapeCode(s: string): string {
  return s.replace(/`/g, "'");
}

// ─── card builders ────────────────────────────────────────────────────────────

export interface StatusInfo {
  chatId: string;
  cwd: string;
  sessionId?: string | undefined;
  agentName: string;
}

/**
 * Build the /status interactive card.
 * Shows scope/cwd/session/agent with action buttons.
 */
export function buildStatusCard(info: StatusInfo): object {
  const sessionLine = info.sessionId
    ? `\`${info.sessionId.slice(0, 8)}…\``
    : '_(无)_';
  const lines = [
    `🧭 **scope**: \`${escapeCode(info.chatId)}\``,
    `📁 **cwd**: \`${escapeCode(info.cwd)}\``,
    `🔗 **session**: ${sessionLine}`,
    `🤖 **agent**: ${escapeMd(info.agentName)}`,
  ];
  return shell('📊 当前状态', [
    divMd(lines.join('\n')),
    HR,
    actionRow([
      { text: '🆕 新会话', value: { cmd: 'new' }, style: 'primary' },
      // TODO: restore this when multi-session history is implemented;
      // for now clicking shows help as a placeholder.
      { text: '🔁 恢复会话', value: { cmd: 'help' } },
      { text: '📂 工作空间', value: { cmd: 'ws.list' } },
      { text: '💡 帮助', value: { cmd: 'help' } },
    ]),
  ]);
}

/**
 * Build the /help interactive card.
 * Lists all visible commands grouped by purpose.
 */
export function buildHelpCard(handlers: CommandHandler[]): object {
  // Separate into groups by purpose.
  const sessionCmds = ['help', 'status', 'new', 'stop', 'timeout', 'sessions', 'reconnect'];
  const workspaceCmds = ['cd', 'ws'];
  const adminCmds = handlers.filter((h) => h.adminOnly).map((h) => h.name);

  const sessionGroup = handlers.filter(
    (h) => !h.adminOnly && sessionCmds.includes(h.name),
  );
  const workspaceGroup = handlers.filter(
    (h) => !h.adminOnly && workspaceCmds.includes(h.name),
  );
  const otherGroup = handlers.filter(
    (h) => !h.adminOnly && !sessionCmds.includes(h.name) && !workspaceCmds.includes(h.name),
  );
  const adminGroup = handlers.filter((h) => h.adminOnly);

  const elements: object[] = [];

  const renderGroup = (title: string, group: CommandHandler[]): void => {
    if (group.length === 0) return;
    elements.push(divMd(`**${title}**`));
    const lines = group.map((h) => `- \`/${h.name}\` — ${h.description}`);
    elements.push(divMd(lines.join('\n')));
    elements.push(HR);
  };

  renderGroup('会话 / 控制', sessionGroup);
  renderGroup('工作空间', workspaceGroup);
  if (otherGroup.length > 0) renderGroup('其他', otherGroup);
  if (adminGroup.length > 0) {
    elements.push(divMd(`**管理员** _(admin only)_`));
    const lines = adminGroup.map((h) => `- \`/${h.name}\` — ${h.description}`);
    elements.push(divMd(lines.join('\n')));
    elements.push(HR);
  }

  // Remove trailing HR if present.
  if (elements.length > 0 && JSON.stringify(elements[elements.length - 1]) === JSON.stringify(HR)) {
    elements.pop();
  }

  void adminCmds; // suppress unused-var; used indirectly via adminGroup

  elements.push(
    actionRow([
      { text: '📊 状态', value: { cmd: 'status' }, style: 'primary' },
      { text: '📂 工作空间', value: { cmd: 'ws.list' } },
      { text: '🆕 新会话', value: { cmd: 'new' } },
    ]),
  );

  return shell('💡 使用帮助', elements);
}

/**
 * Build the /ws list interactive card.
 * Shows current cwd and named workspaces with switch/delete buttons.
 */
export function buildWorkspacesCard(
  current: string | undefined,
  named: Record<string, string>,
): object {
  const entries = Object.entries(named);
  const elements: object[] = [];

  elements.push(divMd(`当前 cwd：\`${escapeCode(current ?? '(未设置，使用 $HOME)')}\``));

  if (entries.length === 0) {
    elements.push(HR);
    elements.push(divMd('暂无命名工作空间。'));
    elements.push(divMd('💡 发送 `/ws save <name>` 把当前 cwd 存为命名工作空间'));
  } else {
    elements.push(HR);
    entries.forEach(([name, path], i) => {
      const marker = path === current ? '  ← 当前' : '';
      elements.push(divMd(`**${escapeMd(name)}** → \`${escapeCode(path)}\`${marker}`));
      elements.push(
        actionRow([
          { text: '切换到此处', value: { cmd: 'ws.use', name }, style: 'primary' },
          { text: '删除', value: { cmd: 'ws.remove', name }, style: 'danger' },
        ]),
      );
      if (i < entries.length - 1) elements.push(HR);
    });
  }

  return shell('📂 工作空间', elements);
}

/**
 * Build the /access admin card.
 * Shows the three access lists in a friendly layout.
 */
export function buildAccessCard(access: Access): object {
  const usersLine =
    access.allowed_users.length === 0
      ? '_（所有人）_'
      : access.allowed_users.map((u) => `\`${u}\``).join(', ');
  const chatsLine =
    access.allowed_chats.length === 0
      ? '_（所有群/会话）_'
      : access.allowed_chats.map((c) => `\`${c}\``).join(', ');
  const adminsLine =
    access.admins.length === 0
      ? '_（无）_'
      : access.admins.map((a) => `\`${a}\``).join(', ');

  const lines = [
    `👥 **allowed_users**: ${usersLine}`,
    `💬 **allowed_chats**: ${chatsLine}`,
    `🔑 **admins**: ${adminsLine}`,
  ];

  return shell('🔒 访问控制', [divMd(lines.join('\n'))]);
}
