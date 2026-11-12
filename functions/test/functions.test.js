'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const { beforeEach, test } = require('node:test');

const documents = new Map();
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function ref(path) {
  return {
    path,
    collection: (name) => ({ doc: (id) => ref(path + '/' + name + '/' + id) }),
    get: async () => {
      const value = documents.get(path);
      return { exists: Boolean(value), get: (key) => value && value[key], data: () => value || {} };
    }
  };
}
const firestore = {
  collection: (name) => ({ doc: (id) => ref(name + '/' + id) }),
  runTransaction: async (callback) => callback({
    get: async (reference) => {
      const value = documents.get(reference.path);
      return { exists: Boolean(value), get: (key) => value && value[key], data: () => value || {} };
    },
    set: (reference, value) => documents.set(reference.path, value)
  })
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-functions/v2/https') return { HttpsError, onCall: (options, handler) => ({ options, handler }) };
  if (request === 'firebase-admin/app') return { initializeApp: () => {} };
  if (request === 'firebase-admin/auth') return { getAuth: () => ({ createCustomToken: async (uid) => 'custom:' + uid }) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => firestore };
  return originalLoad.call(this, request, parent, isMain);
};
const functions = require('../index.js');
Module._load = originalLoad;

const admin = { auth: { uid: 'trusted-admin', token: { admin: true, email_verified: true } } };
const studentUid = (code) => 'student-' + crypto.createHash('sha256').update(String(code)).digest('hex').slice(0, 32);
const activePlatform = () => ({
  settings: { name: 'Test', pass: 'legacy-secret', examTimes: {} },
  codes: [
    { code: '123456', name: 'Amal', section: 'عام', status: 'active', end: Date.now() + 86_400_000, device: '', hist: [], wrongBank: [], examLogs: [] },
    { code: '654321', name: 'Other', section: 'عام', status: 'active', end: Date.now() + 86_400_000, device: '', hist: [] }
  ],
  subjects: [{ id: 1, name: 'Biology', chapters: [] }],
  questions: [{ id: 7, subject: 1, chapter: 'A', lesson: 'L', text: 'Q?', options: ['right', 'wrong'], answer: 'right', explanation: 'Because.' }],
  requests: [], uploads: [], notifs: [], exams: 0
});
const seed = () => documents.set('platform/db', { d: JSON.stringify(activePlatform()), revision: 0 });
const student = (code = '123456') => ({ auth: { uid: studentUid(code), token: { student: true } } });
beforeEach(() => { documents.clear(); seed(); });

test('admin functions reject unauthenticated and non-admin callers', async () => {
  await assert.rejects(functions.adminGetPlatform.handler({ auth: null }), (e) => e.code === 'unauthenticated');
  const unclaimed = { auth: { uid: 'user', token: { email_verified: true } } };
  await assert.rejects(functions.adminGetPlatform.handler(unclaimed), (e) => e.code === 'permission-denied');
  await assert.rejects(functions.adminSavePlatform.handler({ ...unclaimed, data: { platform: activePlatform(), expectedRevision: 0 } }), (e) => e.code === 'permission-denied');
});

test('admin save validates data, strips the legacy password, and uses revision checks', async () => {
  await assert.rejects(functions.adminSavePlatform.handler({ ...admin, data: { platform: { settings: {}, codes: [] }, expectedRevision: 0 } }), (e) => e.code === 'invalid-argument');
  const platform = activePlatform();
  await functions.adminSavePlatform.handler({ ...admin, data: { platform, expectedRevision: 0 } });
  const result = await functions.adminGetPlatform.handler(admin);
  assert.equal(result.platform.settings.pass, undefined);
  assert.equal(result.revision, 1);
  await assert.rejects(functions.adminSavePlatform.handler({ ...admin, data: { platform, expectedRevision: 0 } }), (e) => e.code === 'aborted');
});

test('student login binds a device and signs in with a scoped custom token', async () => {
  const result = await functions.studentLogin.handler({ data: { code: '123456', device: 'device-identifier-123456' }, rawRequest: { ip: '127.0.0.1' } });
  assert.equal(result.token, 'custom:' + studentUid('123456'));
  assert.equal(result.student.device, 'device-identifier-123456');
  await assert.rejects(functions.studentLogin.handler({ data: { code: '123456', device: 'different-device-123456' }, rawRequest: { ip: '127.0.0.2' } }), (e) => e.code === 'permission-denied');
});

test('failed code guesses are rate limited by client IP', async () => {
  for (let attempt = 0; attempt < 12; attempt++) {
    await assert.rejects(functions.studentLogin.handler({
      data: { code: '000000', device: 'device-identifier-123456' }, rawRequest: { ip: '127.0.0.4' }
    }), (e) => e.code === 'permission-denied');
  }
  await assert.rejects(functions.studentLogin.handler({
    data: { code: '000000', device: 'device-identifier-123456' }, rawRequest: { ip: '127.0.0.4' }
  }), (e) => e.code === 'resource-exhausted');
});

test('student responses expose only that student record', async () => {
  const response = await functions.studentGetPlatform.handler(student());
  assert.equal(response.platform.codes.length, 1);
  assert.equal(response.platform.codes[0].name, 'Amal');
  assert.equal(response.platform.settings.pass, undefined);
  assert.deepEqual(response.platform.requests, []);
});

test('server grades submitted answers and rejects forged answers', async () => {
  const response = await functions.studentSubmitExam.handler({
    ...student(),
    data: { answers: [{ id: 7, answer: 'right' }], startedAt: Date.now(), elapsedSeconds: 25, submissionType: 'manual' }
  });
  assert.equal(response.correct, 1);
  assert.equal(response.wrong, 0);
  assert.equal(response.percent, 100);
  assert.equal(response.student.hist.length, 1);
  await assert.rejects(functions.studentSubmitExam.handler({
    ...student(), data: { answers: [{ id: 7, answer: 'forged answer' }] }
  }), (e) => e.code === 'invalid-argument');
  await assert.rejects(functions.studentSubmitExam.handler({
    auth: { uid: 'other-user', token: { student: true } }, data: { answers: [{ id: 7, answer: 'right' }] }
  }), (e) => e.code === 'permission-denied');
});

test('student profile updates accept only a bounded image payload', async () => {
  await assert.rejects(functions.studentSaveProfile.handler({ ...student(), data: { image: 'javascript:alert(1)' } }), (e) => e.code === 'invalid-argument');
  const result = await functions.studentSaveProfile.handler({ ...student(), data: { image: 'data:image/jpeg;base64,AAAA' } });
  assert.equal(result.student.img, 'data:image/jpeg;base64,AAAA');
});

test('students can only clear their own mistake bank', async () => {
  const platform = activePlatform();
  platform.codes[0].wrongBank = [{ id: 7 }];
  documents.set('platform/db', { d: JSON.stringify(platform), revision: 0 });
  const result = await functions.studentClearMistakes.handler(student());
  assert.deepEqual(result.student.wrongBank, []);
  await assert.rejects(functions.studentClearMistakes.handler({
    auth: { uid: 'student-not-this-code', token: { student: true } }
  }), (e) => e.code === 'permission-denied');
});

test('device-change requests are validated and stored for admin review', async () => {
  const result = await functions.studentRequestDeviceChange.handler({
    data: { code: '123456', reason: 'جهازي القديم تعطل' }, rawRequest: { ip: '127.0.0.3' }
  });
  assert.equal(result.ok, true);
  const stored = JSON.parse(documents.get('platform/db').d);
  assert.equal(stored.requests[0].status, 'pending');
  await assert.rejects(functions.studentRequestDeviceChange.handler({
    data: { code: '123456', reason: 'سبب آخر' }, rawRequest: { ip: '127.0.0.3' }
  }), (e) => e.code === 'already-exists');
});

test('student callables enforce App Check', () => {
  for (const name of ['studentLogin', 'studentGetPlatform', 'studentSaveProfile', 'studentClearMistakes', 'studentSubmitExam', 'studentRequestDeviceChange']) {
    assert.equal(functions[name].options.enforceAppCheck, true, name + ' must enforce App Check');
  }
});

