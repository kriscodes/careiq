import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INTERVIEW_ROLES, parseInterviewRequest } from '../index.js';
const valid = () => ({name: '  Synthetic Contact  ', email: 'DEMO@gmail.com', role: 'practice_manager', practiceName: '  Demo  ', submissionKey: randomUUID(), website: ''});
test('normalizes safely, permits general email providers and optional practice name', () => {
  const result = parseInterviewRequest(valid());
  assert.equal(result.ok, true);
  assert.equal(result.data.name, 'Synthetic Contact');
  assert.equal(result.data.email, 'demo@gmail.com');
  assert.equal(result.data.practiceName, 'Demo');
  assert.equal(parseInterviewRequest({...valid(), practiceName: undefined}).ok, true);
  for (const role of INTERVIEW_ROLES) assert.equal(parseInterviewRequest({...valid(), role}).ok, true);
});
test('rejects extra authority, invalid fields, control characters and unbounded keys', () => {
  for (const addition of [{id: randomUUID()}, {source:'elsewhere'}, {practiceId:randomUUID()}, {privacyNoticeVersion:'fake'}, {name:'\u0000'}, {email:'bad'}, {email:'<name>@example.com'}, {email:'name@example.com/path'}, {email:'name@-example.com'}, {email:'two..dots@example.com'}, {role:'Practice owner'}, {name:'x'.repeat(121)}, {email:'x'.repeat(255)}, {practiceName:'x'.repeat(161)}, {submissionKey:'retry'}, {website:'x'.repeat(201)}]) {
    assert.equal(parseInterviewRequest({...valid(), ...addition}).ok, false);
  }
  for (const value of [null, [], 'text', {}, 1]) assert.equal(parseInterviewRequest(value).ok, false);
});
test('keeps bounded honeypot available for server abuse policy', () => {
  const result = parseInterviewRequest({...valid(), website:'bot.example'});
  assert.equal(result.ok, true);
  assert.equal(result.data.website, 'bot.example');
});
