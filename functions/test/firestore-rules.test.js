'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { assertFails, initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { collection, doc, getDoc, setDoc } = require('firebase/firestore');

let env;

before(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  env = await initializeTestEnvironment({
    projectId: 'bank-of-questions-rules-test',
    firestore: {
      host: hostname,
      port: Number(port),
      rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8')
    }
  });
});

after(async () => { if (env) await env.cleanup(); });

test('unauthenticated clients cannot read or write the legacy platform document', async () => {
  const db = env.unauthenticatedContext().firestore();
  const ref = doc(db, 'platform/db');
  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, { d: '{}' }));
});

test('signed-in clients still cannot read or write any Firestore document', async () => {
  const db = env.authenticatedContext('regular-user', { admin: false }).firestore();
  await assertFails(getDoc(doc(db, 'platform/db')));
  await assertFails(setDoc(doc(db, 'students/student-1'), { name: 'forbidden' }));
  await assertFails(getDoc(doc(db, 'questions/question-1')));
});

test('client rules deny every path by default', async () => {
  const db = env.authenticatedContext('claimed-admin', { admin: true }).firestore();
  await assertFails(getDoc(doc(db, 'anything/nested/path')));
  await assertFails(setDoc(doc(db, 'anything/nested/path'), { ok: true }));
});
