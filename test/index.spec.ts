import { describe, it, expect, vi, beforeEach } from "bun:test";
import worker from "../src/index";

describe("Agent Worker", () => {
	let mockEnv: any;
	let mockCtx: any;

	beforeEach(() => {
		mockEnv = {
			AI: {
				run: vi.fn().mockResolvedValue({ response: "Test response" }),
				gateway: vi.fn().mockReturnValue({
					getUrl: vi.fn().mockResolvedValue("https://gateway.ai.cloudflare.com/v1/test")
				})
			},
			CONFIG_KV: {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined)
			},
			D1_SERVICE: {
				fetch: vi.fn().mockResolvedValue({
					ok: true,
					json: vi.fn().mockResolvedValue({ positions: [] })
				})
			},
			TRADE_SERVICE: {
				fetch: vi.fn().mockResolvedValue({ ok: true })
			},
			TELEGRAM_SERVICE: {
				fetch: vi.fn().mockResolvedValue({ ok: true })
			}
		};
		mockCtx = { waitUntil: (p: Promise<any>) => p };
	});

	describe("Root endpoint", () => {
		it("responds with Agent Worker is running on /", async () => {
			const request = new Request("http://example.com/");
			const response = await worker.fetch(request, mockEnv, mockCtx);
			expect(await response.text()).toBe("Agent Worker is running");
		});
	});

	describe("POST /agent/risk-override", () => {
		it("applies risk override", async () => {
			const request = new Request("http://example.com/agent/risk-override", { 
				method: "POST",
				body: JSON.stringify({ trailingStopPercent: 0.03 })
			});
			const response = await worker.fetch(request, mockEnv, mockCtx);
			expect(response.status).toBe(200);
			const json: any = await response.json();
			expect(json.success).toBe(true);
			expect(json.message).toBe("Risk override applied");
		});
	});

	describe("GET /agent/status", () => {
		it("returns health status with config", async () => {
			const request = new Request("http://example.com/agent/status", { method: "GET" });
			const response = await worker.fetch(request, mockEnv, mockCtx);
			expect(response.status).toBe(200);
			const json: any = await response.json();
			expect(json.success).toBe(true);
			expect(json.status).toBe("Healthy");
			expect(json.config).toBeDefined();
			expect(json.config.defaultProvider).toBeDefined();
		});
	});

	describe("GET /agent/config", () => {
		it("returns current agent configuration", async () => {
			const request = new Request("http://example.com/agent/config", { method: "GET" });
			const response = await worker.fetch(request, mockEnv, mockCtx);
			expect(response.status).toBe(200);
			const json: any = await response.json();
			expect(json.success).toBe(true);
			expect(json.config).toBeDefined();
			expect(json.config.defaultProvider).toBe('workers-ai');
			expect(json.config.fallbackChain).toContain('workers-ai');
		});
	});

	describe("POST /agent/config", () => {
		it("updates agent configuration", async () => {
			mockEnv.CONFIG_KV.get = vi.fn().mockImplementation((key: string) => {
				if (key === 'agent:config') return Promise.resolve(JSON.stringify({
					defaultProvider: 'workers-ai',
					fallbackChain: ['workers-ai'],
					modelMap: { 'workers-ai': '@cf/meta/llama-3.1-8b-instruct' },
					trailingStopPercent: 0.05,
					takeProfitPercent: 0.10
				}));
				return Promise.resolve(null);
			});

			const request = new Request("http://example.com/agent/config", {
				method: "POST",
				body: JSON.stringify({ 
					defaultProvider: 'openai',
					fallbackChain: ['openai', 'workers-ai']
				})
			});
			const response = await worker.fetch(request, mockEnv, mockCtx);
			expect(response.status).toBe(200);
			const json: any = await response.json();
			expect(json.success).toBe(true);
		});
	});

	describe("GET /agent/models", () => {
		it("returns all available models", async () => {
			const request = new Request("http://example.com/agent/models", { method: "GET" });
			const response = await worker.fetch(request, mockEnv, mockCtx);
			expect(response.status).toBe(200);
			const json: any = await response.json();
			expect(json.success).toBe(true);
			expect(json.models).toBeDefined();
			expect(Object.keys(json.models).length).toBeGreaterThan(0);
		});
	});

	describe("POST /agent/test-model", () => {
		it("tests Workers AI model", async () => {
			const request = new Request("http://example.com/agent/test-model", {
				method: "POST",
				body: JSON.stringify({ 
					prompt: "Say hello",
					model: "@cf/meta/llama-3.1-8b-instruct"
				})
			});
			const response = await worker.fetch(request, mockEnv, mockCtx);
			expect(response.status).toBe(200);
			const json: any = await response.json();
			expect(json.success).toBe(true);
			expect(json.model).toBe("@cf/meta/llama-3.1-8b-instruct");
		});
	});

	describe("GET /agent/health", () => {
		it("returns provider health status", async () => {
			const request = new Request("http://example.com/agent/health", { method: "GET" });
			const response = await worker.fetch(request, mockEnv, mockCtx);
			expect(response.status).toBe(200);
			const json: any = await response.json();
			expect(json.success).toBe(true);
			expect(json.providers).toBeDefined();
		});
	});

	describe("POST /agent/chat", () => {
		it("sends chat request", async () => {
			const request = new Request("http://example.com/agent/chat", {
				method: "POST",
				body: JSON.stringify({ 
					prompt: "What is Bitcoin?"
				})
			});
			const response = await worker.fetch(request, mockEnv, mockCtx);
			expect(response.status).toBe(200);
			const json: any = await response.json();
			expect(json.success).toBe(true);
		});
	});

	describe("POST /agent/embedding", () => {
		it("returns embedding response", async () => {
			const request = new Request("http://example.com/agent/embedding", {
				method: "POST",
				body: JSON.stringify({ 
					text: "Bitcoin price analysis"
				})
			});
			const response = await worker.fetch(request, mockEnv, mockCtx);
			expect(response.status).toBeGreaterThanOrEqual(200);
		});
	});

	describe("Scheduled routine", () => {
		it("runs scheduled event without positions", async () => {
			const event = { cron: "* * * * *", scheduledTime: 12345 } as any;
			await worker.scheduled(event, mockEnv, mockCtx);
			expect(mockEnv.D1_SERVICE.fetch).toHaveBeenCalled();
		});

		it("processRoutine handles kill switch active", async () => {
			mockEnv.CONFIG_KV.get = vi.fn().mockImplementation((key: string) => {
				if (key === 'trade:kill_switch') return Promise.resolve("true");
				if (key === 'agent:config') return Promise.resolve(null);
				return Promise.resolve(null);
			});
			
			await worker.processRoutine(mockEnv);
			expect(mockEnv.CONFIG_KV.get).toHaveBeenCalledWith('trade:kill_switch');
		});

		it("processRoutine fetches positions", async () => {
			const event = { cron: "* * * * *", scheduledTime: 12345 } as any;
			await worker.scheduled(event, mockEnv, mockCtx);
			expect(mockEnv.D1_SERVICE.fetch).toHaveBeenCalled();
		});
	});
});