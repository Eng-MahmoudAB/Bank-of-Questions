'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();

const REGION = process.env.FUNCTION_REGION || 'europe-west1';
const PLATFORM_REF = getFirestore().collection('platform').doc('db');
const MAX_DOCUMENT_BYTES = 900_000;

function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'يلزم تسجيل دخول الأدمن.');
  }
  if (request.auth.token.admin !== true || request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'هذا الإجراء مخصص لحساب الأدمن المعتمد.');
  }
}

function validatePlatform(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!value.settings || typeof value.settings !== 'object') return false;
  if (!Array.isArray(value.codes) || !Array.isArray(value.subjects) || !Array.isArray(value.questions)) return false;
  if (!Array.isArray(value.requests) || !Array.isArray(value.uploads)) return false;
  return true;
}

exports.adminGetPlatform = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);
  const snapshot = await PLATFORM_REF.get();
  if (!snapshot.exists) return { platform: null };
  const raw = snapshot.get('d');
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new HttpsError('data-loss', 'سجل المنصة غير صالح أو أكبر من الحد المسموح.');
  }
  let platform;
  try { platform = JSON.parse(raw); } catch {
    throw new HttpsError('data-loss', 'تعذر قراءة سجل المنصة.');
  }
  if (!validatePlatform(platform)) throw new HttpsError('data-loss', 'بنية بيانات المنصة غير متوقعة.');
  // Passwords are no longer part of the platform data model.
  if (platform.settings) delete platform.settings.pass;
  return { platform };
});

exports.adminSavePlatform = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);
  const platform = request.data && request.data.platform;
  if (!validatePlatform(platform)) throw new HttpsError('invalid-argument', 'بيانات المنصة غير مكتملة.');
  const clean = structuredClone(platform);
  if (clean.settings) delete clean.settings.pass;
  const encoded = JSON.stringify(clean);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new HttpsError('resource-exhausted', 'حجم بيانات المنصة أكبر من الحد المسموح.');
  }
  await PLATFORM_REF.set({ d: encoded, updatedAt: Date.now(), updatedBy: request.auth.uid });
  return { ok: true };
});
