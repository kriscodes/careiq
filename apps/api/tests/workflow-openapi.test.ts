import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('workflow OpenAPI resolves every internal reference and documents the implemented command registry',async()=>{
 const spec=JSON.parse(await readFile(new URL('../../../docs/api/workflow.openapi.json',import.meta.url),'utf8'));assert.equal(spec.openapi,'3.1.0');const ids=new Set<string>();
 const resolve=(reference:string)=>{assert.ok(reference.startsWith('#/'));let result:any=spec;for(const key of reference.slice(2).split('/'))result=result?.[key];assert.ok(result,reference);return result;};
 const walk=(value:any)=>{if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object'){if(value.$ref)resolve(value.$ref);Object.values(value).forEach(walk);}};walk(spec);
 for(const[path,methods]of Object.entries(spec.paths)as Array<[string,Record<string,any>]>){for(const operation of Object.values(methods)){assert.ok(!ids.has(operation.operationId),operation.operationId);ids.add(operation.operationId);const parameters=operation.parameters.map((p:any)=>p.$ref?resolve(p.$ref):p);const actual=parameters.filter((p:any)=>p.in==='path').map((p:any)=>p.name).sort();const expected=Array.from(path.matchAll(/\{([^}]+)\}/g),m=>m[1]).sort();assert.deepEqual(actual,expected,path);}}
 const routes=await readFile(new URL('../src/routes/workflow.ts',import.meta.url),'utf8');const entries=Array.from(routes.matchAll(/\[\s*['"](post|patch)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([a-z.-]+)['"]\s*,\s*['"]([a-zA-Z]+)['"](?:\s*,\s*(true))?\s*\]/g));assert.ok(entries.length>=40);
 for(const[,method,path,,,precondition]of entries){const target='/api/v1/locations/{locationId}/workflow/'+path.replace(/:([a-zA-Z]+)/g,'{$1}');const operation=spec.paths[target]?.[method];assert.ok(operation,method+' '+target);assert.ok(operation.requestBody);assert.ok(operation['x-required-permission']);const parameters=operation.parameters.map((p:any)=>p.$ref?resolve(p.$ref):p);assert.ok(parameters.find((p:any)=>p.name==='Idempotency-Key'&&p.required));if(precondition)assert.ok(parameters.find((p:any)=>p.name==='If-Match'&&p.required));}
 assert.equal(spec.components.securitySchemes.patientSession.in,'cookie');assert.equal(spec.components.securitySchemes.bearerAuth.scheme,'bearer');assert.deepEqual(spec.paths['/api/v1/patient-workflows/completion'].post.security,[{patientSession:[]}]);assert.deepEqual(spec.paths['/api/v1/patient-workflows/session-exchanges'].post.security,[]);
});
