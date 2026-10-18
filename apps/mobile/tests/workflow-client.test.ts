import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/api";
import { allowedStatusTransitions, displayTime } from "../src/workflow-contract";

test("workflow mutations carry revision and retry headers without persisting clinical data", async () => {
  const previous = globalThis.fetch;
  let observed: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => { observed = init; return new Response(JSON.stringify({ data: { id: "synthetic", revision: 2 } }), { status: 200 }); };
  try {
    const api = createApi({ origin: "http://localhost:3100", getToken: async () => "synthetic-token", getScope: () => "account:practice:location", register: () => () => {} });
    await api("/api/v1/locations/synthetic/workflow/patients/synthetic", { method: "PATCH", body: { phone: "synthetic" }, key: "retry-reference", ifMatch: '"1"' });
    const headers = new Headers(observed?.headers);
    assert.equal(observed?.method, "PATCH");
    assert.equal(headers.get("If-Match"), '"1"'); assert.equal(headers.get("Idempotency-Key"), "retry-reference");
    assert.equal(observed?.cache, "no-store"); assert.equal(observed?.credentials, "omit"); assert.equal(observed?.redirect, "error"); assert.equal(observed?.referrerPolicy, "no-referrer");
  } finally { globalThis.fetch = previous; }
});

test("binary upload bytes and protected file responses are never JSON-encoded", async () => {
  const previous = globalThis.fetch;
  const raw = new Uint8Array([37, 80, 68, 70]).buffer;
  let uploaded = false;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "PUT") { uploaded = true; assert.equal(new Headers(init.headers).get("Content-Type"), "application/octet-stream"); assert.equal(init.body, raw); return new Response(JSON.stringify({ data: { state: "uploaded" } })); }
    return new Response(raw, { headers: { "Content-Type": "application/pdf" } });
  };
  try {
    const api = createApi({ origin: "http://localhost:3100", getToken: async () => "synthetic-token", getScope: () => "scope", register: () => () => {} });
    await api("/api/v1/upload", { method: "PUT", binaryBody: raw });
    assert.equal(uploaded, true);
    assert.deepEqual(new Uint8Array(await api<ArrayBuffer>("/api/v1/file", { binaryResponse: true })), new Uint8Array(raw));
  } finally { globalThis.fetch = previous; }
});

test("terminal appointment states cannot offer a new transition and location time remains explicit", () => {
  for (const state of ["cancelled", "completed", "no_show", "unknown_future_state"]) assert.deepEqual(allowedStatusTransitions(state), []);
  assert.deepEqual(allowedStatusTransitions("checked_in"), ["in_progress"]);
  assert.match(displayTime("2026-10-20T16:00:00Z", "America/Los_Angeles"), /9:00/);
});

test("collection envelopes preserve continuation metadata while ordinary responses remain unwrapped",async()=>{
 const previous=globalThis.fetch;
 const envelope={data:[{id:"synthetic"}],pagination:{hasMore:true,nextCursor:"opaque-continuation",limit:50,total:620}};
 globalThis.fetch=async()=>new Response(JSON.stringify(envelope));
 try{
  const api=createApi({origin:"http://localhost:3100",getToken:async()=>"synthetic-token",getScope:()=>"scope",register:()=>()=>{}});
  assert.deepEqual(await api("/api/v1/locations/synthetic/workflow/patients",{envelope:true}),envelope);
  assert.deepEqual(await api("/api/v1/locations/synthetic/workflow/patients"),envelope.data);
 }finally{globalThis.fetch=previous;}
});

test("native page merging preserves every older item and applies refreshed versions without duplication",async()=>{
 const {mergeWorkflowRows}=await import("../src/workflow-contract");
 const existing=[{id:"first",revision:1},{id:"second",revision:1}];
 assert.deepEqual(mergeWorkflowRows(existing,[{id:"second",revision:2},{id:"third",revision:1}]),[{id:"first",revision:1},{id:"second",revision:2},{id:"third",revision:1}]);
 assert.equal(existing[1].revision,1);
});

test("native template answers retain checkbox booleans and exclude signature and patient selector values",async()=>{
 const {templateAnswers,locationDate}=await import("../src/workflow-contract");
 const fields=[{key:"approved",label:"Approve",type:"checkbox"},{key:"name",label:"Name",type:"text"},{key:"signature",label:"Sign",type:"typed_signature"}];
 assert.deepEqual(templateAnswers(fields,{approved:"true",name:"Synthetic",signature:"Private signature",patientId:"patient-reference"}),{approved:true,name:"Synthetic"});
 assert.deepEqual(templateAnswers(fields,{approved:"false"}),{approved:false,name:""});
 assert.equal(locationDate(new Date("2026-10-17T02:00:00Z"),"America/Los_Angeles"),"2026-10-16");
 assert.equal(locationDate(new Date("2026-11-01T08:30:00Z"),"America/Los_Angeles"),"2026-11-01");
});
