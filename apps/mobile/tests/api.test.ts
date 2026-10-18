import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, ScopeChangedError, createApi } from "../src/api";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return {
    promise,
    resolve
  };
}
const register = () => () => {};
test("does not send a request when authentication is absent", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("unexpected");
  };
  try {
    const api = createApi({
      origin: "https://api.example",
      getToken: async () => null,
      getScope: () => "scope-a",
      register
    });
    await assert.rejects(api("/api/v1/me"), (e: unknown) => e instanceof ApiError && e.status === 401);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("rejects a token resolved after account or organization changes without making a network request", async () => {
  const original = globalThis.fetch;
  const token = deferred<string>();
  let scope = "user-a:org-a";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("unexpected");
  };
  try {
    const api = createApi({
      origin: "https://api.example",
      getToken: () => token.promise,
      getScope: () => scope,
      register
    });
    const pending = api("/api/v1/me");
    scope = "user-b:org-b";
    token.resolve("fake-test-token");
    await assert.rejects(pending, ScopeChangedError);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("discards a successful response if the working location changes while the request is in flight", async () => {
  const original = globalThis.fetch;
  const response = deferred<Response>();
  let scope = "user-a:org-a:location-a";
  globalThis.fetch = () => response.promise;
  try {
    const api = createApi({
      origin: "https://api.example",
      getToken: async () => "fake-test-token",
      getScope: () => scope,
      register
    });
    const pending = api("/api/v1/me");
    await Promise.resolve();
    scope = "user-a:org-a:location-b";
    response.resolve(new Response(JSON.stringify({
      data: {
        privateValue: "old-context"
      }
    }), {
      status: 200
    }));
    await assert.rejects(pending, ScopeChangedError);
  } finally {
    globalThis.fetch = original;
  }
});
test("passes provider JWT and request retry key, and honors server authorization failures", async () => {
  const original = globalThis.fetch;
  const key = "a912e8c1-475a-4cc0-befe-66bdb5a2c123";
  globalThis.fetch = async (_url, init) => {
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer fake-test-token");
    assert.equal(headers["Idempotency-Key"], key);
    assert.equal(init?.cache, "no-store");
    return new Response(JSON.stringify({
      error: {
        code: "LOCATION_ACCESS_DENIED",
        message: "Location access is unavailable."
      }
    }), {
      status: 403
    });
  };
  try {
    const api = createApi({
      origin: "https://api.example",
      getToken: async () => "fake-test-token",
      getScope: () => "scope-a",
      register
    });
    await assert.rejects(api("/api/v1/onboarding", {
      method: "POST",
      body: {
        name: "A"
      },
      key
    }), (e: unknown) => e instanceof ApiError && e.code === "LOCATION_ACCESS_DENIED" && e.status === 403);
  } finally {
    globalThis.fetch = original;
  }
});
test("unregisters outstanding work when the server rejects or the user cancels a request", async () => {
  const original = globalThis.fetch;
  let unregisters = 0;
  let registered: AbortController | null = null;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      code: "SERVER_BUSY"
    }
  }), {
    status: 503
  });
  try {
    const api = createApi({
      origin: "https://api.example",
      getToken: async () => "fake-test-token",
      getScope: () => "scope-a",
      register: controller => {
        registered = controller;
        return () => {
          unregisters++;
        };
      }
    });
    await assert.rejects(api("/api/v1/me"), ApiError);
    assert.ok(registered);
    assert.equal(unregisters, 1);
    const signal = new AbortController();
    signal.abort();
    await assert.rejects(api("/api/v1/me", {
      signal: signal.signal
    }), ScopeChangedError);
    assert.equal(unregisters, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("background cancellation rejects even when the provider token request never settles", async () => {
  const pendingToken = deferred<string>();
  let controller!: AbortController;
  const api = createApi({ origin: "https://api.example", getToken: () => pendingToken.promise, getScope: () => "a", register: current => { controller = current; return () => {}; } });
  const pending = api("/api/v1/me");
  controller.abort();
  await assert.rejects(pending, ScopeChangedError);
  pendingToken.resolve("late-test-token");
});
test("the total request deadline also bounds provider token acquisition", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = createApi({ origin: "https://api.example", getToken: () => new Promise(() => {}), getScope: () => "a", register });
  const pending = api("/api/v1/me");
  t.mock.timers.tick(25001);
  await assert.rejects(pending, (error: unknown) => error instanceof ApiError && error.code === "REQUEST_TIMEOUT");
});
test("unexpected JSON values fail without rendering internal JavaScript errors", async () => {
  const original = globalThis.fetch;
  try {
    for (const payload of [null, 42, "unexpected", []]) {
      globalThis.fetch = async () => Response.json(payload);
      const api = createApi({ origin: "https://api.example", getToken: async () => "test", getScope: () => "a", register });
      await assert.rejects(api("/api/v1/me"), (error: unknown) => error instanceof ApiError && error.code === "INVALID_RESPONSE");
    }
  } finally { globalThis.fetch = original; }
});

test("connection failures distinguish safe keyed retries from uncertain unkeyed saves",async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>{throw new TypeError("fetch failed after request was sent");};
  try{
    const api=createApi({origin:"https://api.example.com",getToken:async()=>"synthetic-token",getScope:()=>"scope",register:()=>()=>{}});
    for(const [options,expected]of [[{method:"GET"},"read"],[{method:"POST",body:{name:"Synthetic"},key:"stable-command-key"},"idempotentWrite"],[{method:"POST",body:{name:"Synthetic"}},"write"]] as const){
      await assert.rejects(api("/api/v1/patients",options),error=>error instanceof ApiError&&error.code==="NETWORK_ERROR"&&error.retryHint===expected);
    }
  }finally{globalThis.fetch=original;}
});
