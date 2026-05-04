import type { AIProvider, ChatRequest, ChatResult } from './providers/base';

interface GatewayOptions {
	maxRetries?: number;
	failureThreshold?: number; // consecutive failures before marking unhealthy
	healthCheckTTL?: number; // ms to cache health status (default 30s)
}

interface ProviderHealth {
	healthy: boolean;
	consecutiveFailures: number;
	lastChecked: number; // timestamp of last live health check
}

export class AIGateway {
	private providers: Map<string, AIProvider> = new Map();
	private health: Map<string, ProviderHealth> = new Map();
	private options: Required<GatewayOptions>;

	constructor(
		providerList: AIProvider[],
		private defaultProvider: string,
		private fallbackChain: string[],
		options: GatewayOptions = {},
	) {
		this.options = {
			maxRetries: options.maxRetries ?? 3,
			failureThreshold: options.failureThreshold ?? 5,
			healthCheckTTL: options.healthCheckTTL ?? 30_000,
		};

		// Register providers
		for (const p of providerList) {
			this.providers.set(p.name, p);
			// Initialize health - will be checked on first use
			this.health.set(p.name, { healthy: true, consecutiveFailures: 0, lastChecked: 0 });
		}
	}

	// Initialize health status by calling isHealthy() on each provider
	async init(): Promise<void> {
		for (const [name, provider] of this.providers.entries()) {
			try {
				const healthy = await provider.isHealthy();
				const health = this.health.get(name);
				if (health) {
					health.healthy = healthy;
					health.lastChecked = Date.now();
				}
			} catch {
				const health = this.health.get(name);
				if (health) {
					health.healthy = false;
					health.lastChecked = Date.now();
				}
			}
		}
	}

	// Check if provider is healthy, with TTL-cached live check
	private async checkHealth(providerName: string, provider: AIProvider): Promise<boolean> {
		const health = this.health.get(providerName);
		if (!health) return false;

		const now = Date.now();
		const cacheExpired = now - health.lastChecked > this.options.healthCheckTTL;

		if (cacheExpired) {
			try {
				health.healthy = await provider.isHealthy();
			} catch {
				health.healthy = false;
			}
			health.lastChecked = now;
		}

		return health.healthy;
	}

	async chat(request: ChatRequest): Promise<ChatResult> {
		const tried = new Set<string>();
		let lastError: Error | null = null;

		// Build attempt order: default first, then fallback chain
		const attemptOrder = [this.defaultProvider, ...this.fallbackChain.filter(p => p !== this.defaultProvider)];

		for (const providerName of attemptOrder) {
			if (tried.has(providerName)) continue;
			tried.add(providerName);

			const provider = this.providers.get(providerName);
			if (!provider) continue;

			// Check health before using
			const isHealthy = await this.checkHealth(providerName, provider);
			if (!isHealthy) continue;

			try {
				// Try the provider once (retries are per-provider, not per-attempt)
				const result = await provider.chat(request);
				// Success - reset failure count
				this.resetFailures(providerName);
				return result;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				// Track consecutive failures
				this.trackFailure(providerName);
				// Continue to next provider in fallback chain
			}
		}

		throw new Error(`All AI providers failed: ${lastError?.message || 'Unknown error'}`);
	}

	private trackFailure(providerName: string): void {
		const health = this.health.get(providerName);
		if (!health) return;

		health.consecutiveFailures++;
		if (health.consecutiveFailures >= this.options.failureThreshold) {
			health.healthy = false;
		}
	}

	private resetFailures(providerName: string): void {
		const health = this.health.get(providerName);
		if (health) {
			health.consecutiveFailures = 0;
			health.healthy = true;
		}
	}

	async getHealthStatus(): Promise<Record<string, boolean>> {
		const status: Record<string, boolean> = {};
		for (const [name, provider] of this.providers.entries()) {
			try {
				status[name] = await provider.isHealthy();
			} catch {
				status[name] = false;
			}
		}
		return status;
	}

	// Method to manually mark provider health (for testing or manual override)
	setProviderHealth(providerName: string, healthy: boolean): void {
		const health = this.health.get(providerName);
		if (health) {
			health.healthy = healthy;
			if (healthy) health.consecutiveFailures = 0;
		}
	}
}
