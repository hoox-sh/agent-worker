import { describe, expect, test } from 'bun:test';
import { validateChatRequest, mergeMessages } from '../../../src/ai/providers/base';
import type { ChatRequest } from '../../../src/ai/providers/base';

describe('validateChatRequest', () => {
	test('passes for valid request with messages', () => {
		const req: ChatRequest = {
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'gpt-4o-mini',
		};
		const result = validateChatRequest(req);
		expect(result.ok).toBe(true);
	});

	test('fails for empty messages array', () => {
		const req: ChatRequest = {
			messages: [],
			model: 'gpt-4o-mini',
		};
		const result = validateChatRequest(req);
		expect(result.ok).toBe(false);
	});

	test('fails for missing model', () => {
		const req = {
			messages: [{ role: 'user' as const, content: 'Hello' }],
		} as ChatRequest;
		const result = validateChatRequest(req);
		expect(result.ok).toBe(false);
	});

	test('fails for invalid temperature', () => {
		const req: ChatRequest = {
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'gpt-4o-mini',
			temperature: 2.5,
		};
		const result = validateChatRequest(req);
		expect(result.ok).toBe(false);
	});

	test('fails for negative maxTokens', () => {
		const req: ChatRequest = {
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'gpt-4o-mini',
			maxTokens: -1,
		};
		const result = validateChatRequest(req);
		expect(result.ok).toBe(false);
	});
});

describe('mergeMessages', () => {
	test('prepends system prompt to messages', () => {
		const messages = [{ role: 'user' as const, content: 'Hello' }];
		const result = mergeMessages(messages, 'You are helpful');
		expect(result.length).toBe(2);
		expect(result[0].role).toBe('system');
		expect(result[0].content).toBe('You are helpful');
	});

	test('replaces existing system prompt', () => {
		const messages = [
			{ role: 'system' as const, content: 'Old system' },
			{ role: 'user' as const, content: 'Hello' },
		];
		const result = mergeMessages(messages, 'New system');
		expect(result.length).toBe(2);
		expect(result[0].content).toBe('New system');
	});

	test('returns messages unchanged when no system prompt', () => {
		const messages = [{ role: 'user' as const, content: 'Hello' }];
		const result = mergeMessages(messages);
		expect(result).toEqual(messages);
	});
});
