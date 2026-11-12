'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { beforeEach, test } = require('node:test');

const documents = new Map();
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-functions/v2/https') {
    return { HttpsError, onCall: (options, handler) => ({ options, handler }) };
  }
  if (request === 'firebase-admin/app') return { initializeApp: () => {} };
  if (request === 'firebase-admin/firestore') {
    return { getFirestore: () => ({ collection: (collectionName) => ({ doc: (documentId) => ({
      get: async () => {
        const value = documents.get(`${collectionName}/${documentId}`);
        return { exists: Boolean(value), get: (key) => value && value[key] };
      },
      set: async (value) => documents.set(`${collectionName}/${documentId}`, value)
    }) }) }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const functions = require('../index.js');
Module._load = originalLoad;

const admin = { auth: { uid: 'trusted-admin', token: { admin: true, email_verified: true } } };
const validPlatform = () => ({ settings: { name: 'Test', pass: 'legacy-secret' }, codes: [], subjects: [], questions: [], requests: [], uploads: [] });
beforeEach(() => documents.clear());

test('read and write reject unauthenticated and non-admin callers', async () => {
  await assert.rejects(functions.adminGetPlatform.handler({ auth: null }), (e) => e.code === 'unauthenticated');
  const unclaimed = { auth: { uid: 'user', token: { email_verified: true } } };
  await assert.rejects(functions.adminGetPlatform.handler(unclaimed), (e) => e.code === 'permission-denied');
  await assert.rejects(functions.adminSavePlatform.handler({ ...unclaimed, data: { platform: validPlatform() } }), (e) => e.code === 'permission-denied');
});

test('save validates shape, removes the legacy password, and read round-trips data', async () => {
  await assert.rejects(functions.adminSavePlatform.handler({ ...admin, data: { platform: { settings: {}, codes: [] } } }), (e) => e.code === 'invalid-argument');
  await functions.adminSavePlatform.handler({ ...admin, data: { platform: validPlatform() } });
  const result = await functions.adminGetPlatform.handler(admin);
  assert.equal(result.platform.settings.name, 'Test');
  assert.equal(result.platform.settings.pass, undefined);
  assert.equal(JSON.parse(documents.get('platform/db').d).settings.pass, undefined);
});

test('read fails closed on malformed stored data', async () => {
  documents.set('platform/db', { d: '{broken json' });
  await assert.rejects(functions.adminGetPlatform.handler(admin), (e) => e.code === 'data-loss');
});

test('callables do not enforce App Check until a provider is configured', () => {
  assert.equal(functions.adminGetPlatform.options.enforceAppCheck, undefined);
  assert.equal(functions.adminSavePlatform.options.enforceAppCheck, undefined);
});
