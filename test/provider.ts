import type { ServerResponse } from 'node:http';
import type { APIProtocol } from '../shared/types.js';

// Local protocol fixture: exercises the official SDK without an external model.
export function textReply(response: ServerResponse, protocol: APIProtocol, model: string, text = 'OK') {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  if (protocol === 'openai') {
    response.end([
      { id: 'reply', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
      { id: 'reply', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
    ].map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n');
  } else {
    response.end([
      { type: 'message_start', message: { id: 'reply', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
      { type: 'message_stop' },
    ].map(value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join(''));
  }
}
