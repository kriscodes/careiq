import assert from "node:assert/strict";
import test from "node:test";
import { checkHealth } from "../src/health";

test("public health request sends no authorization or cookies and checks the response", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "https://api.example.com/health");
    assert.equal(new Headers(init?.headers).get("Authorization"), null);
    assert.equal(init?.credentials, "omit");
    return Response.json({
      status: "ok",
      service: "careiq-api",
      database: "connected",
    });
  };
  assert.equal(
    await checkHealth("https://api.example.com", undefined, { fetcher }),
    "available",
  );
});
test("unavailable, non-JSON and wrong-service responses remain failures", async () => {
  for (const response of [
    new Response("private server detail", { status: 503 }),
    new Response("<html>"),
    Response.json({ status: "ok" }),
  ]) {
    await assert.rejects(
      checkHealth("https://api.example.com", undefined, {
        fetcher: async () => response,
      }),
      (error: Error) =>
        error.message.includes("Connection unavailable") &&
        !error.message.includes("private server detail"),
    );
  }
});
test("a health check times out and supports cancellation", async () => {
  const fetcher: typeof fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      const abort = () => reject(new Error("Aborted"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  await assert.rejects(
    checkHealth("https://api.example.com", undefined, {
      fetcher,
      timeoutMs: 5,
    }),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    checkHealth("https://api.example.com", controller.signal, { fetcher }),
  );
});
