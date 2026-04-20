import { describe, it, expect } from "vitest";
import worker from "../src/index";

describe("Agent Worker", () => {
	it("responds with Agent Worker is running on /", async () => {
		const request = new Request("http://example.com/");
		const mockEnv = {} as any;
		const mockCtx = { waitUntil: () => {} } as any;
		const response = await worker.fetch(request, mockEnv, mockCtx);
		expect(await response.text()).toBe("Agent Worker is running");
	});
});
