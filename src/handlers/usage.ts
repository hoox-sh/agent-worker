import type { Env } from '../../src/types';

export interface UsageData {
	period: 'today' | 'week' | 'month';
	providers: Record<string, {
		requests: number;
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		avgLatencyMs: number;
		errorRate: number;
	}>;
	total: {
		requests: number;
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
}

// In-memory storage (replace with D1 in production)
const usageStore: Map<string, {
	requests: number;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	totalLatencyMs: number;
	errors: number;
}> = new Map();

export function trackUsage(
	provider: string,
	usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
	latencyMs: number,
	success: boolean,
): void {
	let stats = usageStore.get(provider);
	if (!stats) {
		stats = {
			requests: 0,
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			totalLatencyMs: 0,
			errors: 0,
		};
		usageStore.set(provider, stats);
	}

	stats.requests++;
	stats.promptTokens += usage.promptTokens || 0;
	stats.completionTokens += usage.completionTokens || 0;
	stats.totalTokens += usage.totalTokens || 0;
	stats.totalLatencyMs += latencyMs;
	if (!success) stats.errors++;
}

export async function handleUsage(request: Request, _env: Env): Promise<Response> {
	const url = new URL(request.url);
	const periodParam = url.searchParams.get('period') || 'today';

	// Validate period
	if (!['today', 'week', 'month'].includes(periodParam)) {
		return new Response(JSON.stringify({ error: 'Invalid period. Use: today, week, month' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const period = periodParam as 'today' | 'week' | 'month';

	const result: UsageData = {
		period,
		providers: {},
		total: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
	};

	// Aggregate usage from in-memory store
	for (const [provider, stats] of usageStore.entries()) {
		const providerData = {
			requests: stats.requests,
			promptTokens: stats.promptTokens,
			completionTokens: stats.completionTokens,
			totalTokens: stats.totalTokens,
			avgLatencyMs: stats.requests > 0 ? stats.totalLatencyMs / stats.requests : 0,
			errorRate: stats.requests > 0 ? stats.errors / stats.requests : 0,
		};

		result.providers[provider] = providerData;
		result.total.requests += providerData.requests;
		result.total.promptTokens += providerData.promptTokens;
		result.total.completionTokens += providerData.completionTokens;
		result.total.totalTokens += providerData.totalTokens;
	}

	return new Response(JSON.stringify(result), {
		headers: { 'Content-Type': 'application/json' },
	});
}
