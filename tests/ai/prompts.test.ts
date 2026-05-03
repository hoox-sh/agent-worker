import { describe, expect, test } from 'bun:test';
import { getPrompt, listPromptTemplates, renderPrompt } from '../../src/ai/prompts';
import type { PromptTemplate } from '../../src/ai/prompts';

describe('getPrompt', () => {
	test('returns trading analyst prompt', () => {
		const prompt = getPrompt('trading-analyst');
		expect(prompt).toBeDefined();
		expect(prompt!.content).toContain('trading');
		expect(prompt!.content).toContain('risk management');
	});

	test('returns risk assessor prompt', () => {
		const prompt = getPrompt('risk-assessor');
		expect(prompt).toBeDefined();
		expect(prompt!.content).toContain('risk');
		expect(prompt!.content).toContain('position');
	});

	test('returns market scanner prompt', () => {
		const prompt = getPrompt('market-scanner');
		expect(prompt).toBeDefined();
		expect(prompt!.content).toContain('market');
		expect(prompt!.content).toContain('opportunity');
	});

	test('returns undefined for unknown template', () => {
		const prompt = getPrompt('nonexistent');
		expect(prompt).toBeUndefined();
	});
});

describe('listPromptTemplates', () => {
	test('returns array of template metadata', () => {
		const templates = listPromptTemplates();
		expect(Array.isArray(templates)).toBe(true);
		expect(templates.length).toBeGreaterThan(0);
		for (const t of templates) {
			expect(t.id).toBeDefined();
			expect(t.name).toBeDefined();
			expect(t.description).toBeDefined();
		}
	});
});

describe('renderPrompt', () => {
	test('replaces placeholders with variables', () => {
		const prompt = getPrompt('trading-analyst');
		expect(prompt).toBeDefined();
		const rendered = renderPrompt(prompt!, { symbol: 'BTCUSDT', timeframe: '4h' });
		expect(rendered).toContain('BTCUSDT');
		expect(rendered).toContain('4h');
	});

	test('leaves unreplaced placeholders unchanged', () => {
		const prompt = getPrompt('trading-analyst');
		expect(prompt).toBeDefined();
		const rendered = renderPrompt(prompt!, { symbol: 'BTCUSDT' });
		expect(rendered).toContain('BTCUSDT');
		// timeframe placeholder remains if not provided
		expect(rendered).toContain('{{timeframe}}');
	});

	test('handles empty variables object', () => {
		const prompt = getPrompt('trading-analyst');
		expect(prompt).toBeDefined();
		const rendered = renderPrompt(prompt!, {});
		expect(rendered).toContain('{{symbol}}');
	});
});
