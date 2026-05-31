// SPDX-License-Identifier: MIT
export interface ToolCallRow {
  name: string;
  summary?: string;
  done: boolean;
  ok?: boolean;
}

export interface StreamingCardInput {
  header: string;
  bodyMarkdown: string;
  state: 'thinking' | 'streaming' | 'done' | 'error';
  toolCalls?: ToolCallRow[];
  footer?: string;
}

export function buildStreamingCard(input: StreamingCardInput): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [];

  if (input.state === 'thinking' && !input.bodyMarkdown) {
    elements.push({ tag: 'markdown', content: 'Thinking...' });
  } else {
    elements.push({ tag: 'markdown', content: input.bodyMarkdown || ' ' });
  }

  for (const tc of input.toolCalls ?? []) {
    const icon = tc.done ? (tc.ok ? '[ok]' : '[err]') : '[..]';
    const line = `${icon} \`${tc.name}\`${tc.summary ? ` ${tc.summary}` : ''}`;
    elements.push({ tag: 'markdown', content: line });
  }

  if (input.footer) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'markdown', content: `_${input.footer}_` });
  }

  return {
    schema: '2.0',
    config: { summary: { content: input.header } },
    header: {
      title: { tag: 'plain_text', content: input.header },
      template: input.state === 'error' ? 'red' : input.state === 'done' ? 'green' : 'blue',
    },
    body: { elements },
  };
}
