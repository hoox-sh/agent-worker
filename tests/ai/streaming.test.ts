import { describe, expect, test } from 'bun:test';
import { formatSSE, createStreamResponse } from '../../src/ai/streaming';
import type { StreamChunk } from '../../src/ai/providers/base';

describe('formatSSE', () => {
	test('formats data line correctly', () => {
		const chunk: StreamChunk = { content: 'Hello', model: 'gpt-4', provider: 'openai', done: false };
		const result = formatSSE(chunk);
		expect(result).toBe('data: {"content":"Hello","model":"gpt-4","provider":"openai","done":false}\n\n');
	});

	test('formats done signal correctly', () => {
		const chunk: StreamChunk = { content: '', model: 'gpt-4', provider: 'openai', done: true };
		const result = formatSSE(chunk);
		expect(result).toBe('data: {"content":"","model":"gpt-4","provider":"openai","done":true}\n\n');
	});

	test('escapes newlines in content', () => {
		const chunk: StreamChunk = { content: 'Hello\nWorld', model: 'gpt-4', provider: 'openai', done: false };
		const result = formatSSE(chunk);
		// Newlines should be escaped as \\n in JSON
		expect(result).toContain('Hello\\\\nWorld');
	});
});

describe('createStreamResponse', () => {
	test('returns Response with correct headers', async () => {
		async function* gen() {
			yield { content: 'Hello', model: 'gpt-4', provider: 'openai', done: false } as StreamChunk;
			yield { content: '', model: 'gpt-4', provider: 'openai', done: true } as StreamChunk;
		}

		const response = createStreamResponse(gen());
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('text/event-stream');
		expect(response.headers.get('Cache-Control')).toBe('no-cache');
		expect(response.headers.get('Connection')).toBe('keep-alive');
	});

	test('streams all chunks', async () => {
		async function* gen() {
			yield { content: 'A', model: 'test', provider: 'openai', done: false } as StreamChunk;
			yield { content: 'B', model: 'test', provider: 'openai', done: false } as StreamChunk;
			yield { content: '', model: 'test', provider: 'openai', done: true } as StreamChunk;
		}

		const response = createStreamResponse(gen());
		const reader = response.body?.getReader();
		expect(reader).toBeDefined();

		const decoder = new TextDecoder();
		const chunks: string[] = [];

		if (reader) {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(decoder.decode(value));
			}
		}

		expect(chunks.length).toBe(3);
		expect(chunks[0]).toContain('"content":"A"');
		expect(chunks[1]).toContain('"content":"B"');
		expect(chunks[2]).toContain('"done":true');
	});
});
