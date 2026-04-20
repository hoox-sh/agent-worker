import { describe, it, expect, vi } from "vitest";
import worker from "../src/index";

describe("Agent Worker", () => {
	it("responds with Agent Worker is running on /", async () => {
		const request = new Request("http://example.com/");
		const mockEnv = {} as any;
		const mockCtx = { waitUntil: () => {} } as any;
		const response = await worker.fetch(request, mockEnv, mockCtx);
		expect(await response.text()).toBe("Agent Worker is running");
	});

	it("responds to /agent/risk-override", async () => {
		const request = new Request("http://example.com/agent/risk-override", { method: "POST" });
		const mockEnv = {} as any;
		const mockCtx = { waitUntil: () => {} } as any;
		const response = await worker.fetch(request, mockEnv, mockCtx);
		expect(response.status).toBe(200);
		const json: any = await response.json();
		expect(json.success).toBe(true);
		expect(json.message).toBe("Risk override applied");
	});

	it("responds to /agent/status", async () => {
		const request = new Request("http://example.com/agent/status", { method: "GET" });
		const mockEnv = {} as any;
		const mockCtx = { waitUntil: () => {} } as any;
		const response = await worker.fetch(request, mockEnv, mockCtx);
		expect(response.status).toBe(200);
		const json: any = await response.json();
		expect(json.success).toBe(true);
		expect(json.status).toBe("Healthy");
	});

	it("runs scheduled event successfully without positions", async () => {
		const mockEnv = {
			D1_SERVICE: {
				fetch: vi.fn().mockResolvedValue({
					ok: true,
					json: vi.fn().mockResolvedValue({ positions: [] })
				})
			},
			CONFIG_KV: {
				get: vi.fn().mockResolvedValue(null)
			}
		} as any;
		
		let waitedPromise: Promise<any> | undefined;
		const mockCtx = { 
			waitUntil: (p: Promise<any>) => { waitedPromise = p; } 
		} as any;
		const event = { cron: "* * * * *", scheduledTime: 12345 } as any;
		
		await worker.scheduled(event, mockEnv, mockCtx);
		await waitedPromise;
		
		expect(mockEnv.D1_SERVICE.fetch).toHaveBeenCalled();
		expect(mockEnv.CONFIG_KV.get).toHaveBeenCalledWith('trade:kill_switch');
	});

	it("processRoutine handles kill switch active", async () => {
		const mockEnv = {
			D1_SERVICE: {
				fetch: vi.fn().mockResolvedValue({
					ok: true,
					json: vi.fn().mockResolvedValue({ positions: [{ symbol: "BTCUSDT" }] })
				})
			},
			CONFIG_KV: {
				get: vi.fn().mockResolvedValue("true")
			}
		} as any;
		
		await worker.processRoutine(mockEnv);
		// Should return early, not fetching mark price or anything else
		expect(mockEnv.CONFIG_KV.get).toHaveBeenCalledWith('trade:kill_switch');
	});
});
