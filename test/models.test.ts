import { describe, expect, test } from "bun:test";
import {
  CF_MODELS,
  EXTERNAL_MODELS,
  ALL_MODELS,
  getModelInfo,
  getModelsByTask,
  getModelsByProvider,
  getRecommendedModel,
} from "../src/models";

describe("agent-worker models", () => {
  test("CF_MODELS contains expected models", () => {
    const keys = Object.keys(CF_MODELS);
    expect(keys).toContain("@cf/meta/llama-3.1-8b-instruct");
    expect(CF_MODELS["@cf/meta/llama-3.1-8b-instruct"].provider).toBe(
      "workers-ai"
    );
  });

  test("EXTERNAL_MODELS contains OpenAI models", () => {
    expect(EXTERNAL_MODELS).toHaveProperty("gpt-4o-mini-2024-07-18");
    expect(EXTERNAL_MODELS["gpt-4o-mini-2024-07-18"].provider).toBe("openai");
  });

  test("ALL_MODELS merges both", () => {
    expect(Object.keys(ALL_MODELS).length).toBeGreaterThan(
      Object.keys(CF_MODELS).length
    );
  });

  test("getModelInfo returns model details", () => {
    const info = getModelInfo("@cf/meta/llama-3.1-8b-instruct");
    expect(info).toBeDefined();
    expect(info?.taskType).toBe("chat");
  });

  test("getModelInfo returns undefined for unknown", () => {
    const info = getModelInfo("unknown-model");
    expect(info).toBeUndefined();
  });

  test("getModelsByTask filters by task type", () => {
    const chatModels = getModelsByTask("chat");
    expect(chatModels.length).toBeGreaterThan(0);
    chatModels.forEach((m) => expect(m.taskType).toBe("chat"));
  });

  test("getModelsByProvider filters by provider", () => {
    const openaiModels = getModelsByProvider("openai");
    expect(openaiModels.length).toBeGreaterThan(0);
    openaiModels.forEach((m) => expect(m.provider).toBe("openai"));
  });

  test("getRecommendedModel returns default for chat", () => {
    const model = getRecommendedModel("chat");
    expect(model).toBeDefined();
    expect(ALL_MODELS[model]).toBeDefined();
  });

  test("getRecommendedModel prefers provider when specified", () => {
    const model = getRecommendedModel("chat", "openai");
    expect(model).toBe("gpt-4o-mini-2024-07-18");
  });

  test("getRecommendedModel falls back to default", () => {
    const model = getRecommendedModel("chat", "unknown-provider" as any);
    expect(ALL_MODELS[model]).toBeDefined();
  });

  test("embedding models have correct type", () => {
    const embeddings = getModelsByTask("embedding");
    expect(embeddings.length).toBeGreaterThan(0);
  });

  test("vision models exist", () => {
    const vision = getModelsByTask("vision");
    expect(vision.length).toBeGreaterThan(0);
  });

  test("reasoning models exist", () => {
    const reasoning = getModelsByTask("reasoning");
    expect(reasoning.length).toBeGreaterThan(0);
  });
});
