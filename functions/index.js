'use strict';

const crypto = require('node:crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();

const REGION = process.env.FUNCTION_REGION || 'europe-west1';
const PLATFORM_REF = getFirestore().collection('platform').doc('db');
const LOGIN_LIMIT_REF = getFirestore().collection('security').doc('studentLoginRateLimit');
const MAX_DOCUMENT_BYTES = 900_000;
const MAX_QUESTIONS_PER_EXAM = 100;

function requireAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'يلزم تسجيل دخول الأدمن.');
  if (request.auth.token.admin !== true || request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'هذا الإجراء مخصص لحساب الأدمن المعتمد.');
  }
}

function requireStudent(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'سجّل الدخول بكود التفعيل.');
  if (request.auth.token.student !== true || !request.auth.uid.startsWith('student-')) {
    throw new HttpsError('permission-denied', 'هذا الإجراء مخصص لحساب الطالب.');
  }
}

function normalizePlatform(value) {
  const db = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!db || !db.settings || typeof db.settings !== 'object') return null;
  for (const key of ['codes', 'subjects', 'questions', 'requests', 'uploads']) {
    if (!Array.isArray(db[key])) return null;
  }
  db.notifs = Array.isArray(db.notifs) ? db.notifs : [];
  db.settings.examTimes = db.settings.examTimes && typeof db.settings.examTimes === 'object' ? db.settings.examTimes : {};
  return db;
}

async function loadPlatform(tx, allowMissing = false) {
  const snapshot = tx ? await tx.get(PLATFORM_REF) : await PLATFORM_REF.get();
  if (!snapshot.exists) {
    if (allowMissing) return { platform: null, revision: 0 };
    throw new HttpsError('failed-precondition', 'بيانات المنصة غير مهيأة على الخادم.');
  }
  const raw = snapshot.get('d');
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new HttpsError('data-loss', 'سجل المنصة غير صالح أو أكبر من الحد المسموح.');
  }
  let value;
  try { value = JSON.parse(raw); } catch { throw new HttpsError('data-loss', 'تعذر قراءة سجل المنصة.'); }
  const platform = normalizePlatform(value);
  if (!platform) throw new HttpsError('data-loss', 'بنية بيانات المنصة غير متوقعة.');
  return { platform, revision: Number(snapshot.get('revision') || 0) };
}

function encodePlatform(platform) {
  const clean = structuredClone(platform);
  if (clean.settings) delete clean.settings.pass;
  const encoded = JSON.stringify(clean);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new HttpsError('resource-exhausted', 'حجم بيانات المنصة أكبر من الحد المسموح.');
  }
  return encoded;
}

function studentUid(code) {
  return 'student-' + crypto.createHash('sha256').update(String(code)).digest('hex').slice(0, 32);
}

function findStudent(platform, uid) {
  return platform.codes.find((code) => studentUid(code.code) === uid) || null;
}

function assertActiveCode(code) {
  if (!code || code.status === 'disabled' || !Number.isFinite(Number(code.end)) || Date.now() > Number(code.end)) {
    throw new HttpsError('permission-denied', 'كود التفعيل غير صالح أو منتهي.');
  }
}

async function limitLoginAttempts(request) {
  const ip = String(request.rawRequest?.ip || 'unknown').slice(0, 100);
  const key = crypto.createHash('sha256').update(ip).digest('hex');
  const ref = LOGIN_LIMIT_REF.collection('windows').doc(key);
  const now = Date.now();
  await getFirestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const old = snapshot.exists ? snapshot.data() : {};
    const withinWindow = Number(old.windowStart) > now - 10 * 60_000;
    const count = withinWindow ? Number(old.count || 0) : 0;
    if (count >= 12) throw new HttpsError('resource-exhausted', 'محاولات كثيرة. حاول بعد دقائق.');
    tx.set(ref, { windowStart: withinWindow ? old.windowStart : now, count: count + 1 });
  });
}

function assertExamAnswers(platform, answers) {
  if (!Array.isArray(answers) || answers.length < 1 || answers.length > MAX_QUESTIONS_PER_EXAM) {
    throw new HttpsError('invalid-argument', 'عدد الأسئلة غير صالح.');
  }
  const ids = new Set();
  const items = answers.map((entry) => {
    if (!entry || (typeof entry.id !== 'string' && typeof entry.id !== 'number')) {
      throw new HttpsError('invalid-argument', 'إجابة غير صالحة.');
    }
    const id = String(entry.id);
    if (ids.has(id)) throw new HttpsError('invalid-argument', 'السؤال مكرر.');
    ids.add(id);
    const question = platform.questions.find((item) => String(item.id) === id && !item.hiddenFromExams);
    if (!question || !Array.isArray(question.options) || !question.options.includes(question.answer)) {
      throw new HttpsError('invalid-argument', 'أحد الأسئلة لم يعد متاحًا.');
    }
    const answer = entry.answer === undefined || entry.answer === null ? null : String(entry.answer);
    if (answer !== null && !question.options.includes(answer)) {
      throw new HttpsError('invalid-argument', 'إجابة غير موجودة ضمن الاختيارات.');
    }
    return { question, answer };
  });
  return items;
}

exports.adminGetPlatform = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);
  const { platform, revision } = await loadPlatform(null, true);
  if (!platform) return { platform: null, revision };
  delete platform.settings.pass;
  return { platform, revision };
});

exports.adminSavePlatform = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);
  const platform = normalizePlatform(request.data && request.data.platform);
  if (!platform) throw new HttpsError('invalid-argument', 'بيانات المنصة غير مكتملة.');
  const encoded = encodePlatform(platform);
  const expectedRevision = Number(request.data.expectedRevision);
  let nextRevision = 0;
  await getFirestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(PLATFORM_REF);
    const currentRevision = Number(snapshot.get('revision') || 0);
    if (currentRevision !== expectedRevision) {
      throw new HttpsError('aborted', 'تغيرت البيانات على الخادم. أعد تحميل المنصة قبل الحفظ.');
    }
    nextRevision = currentRevision + 1;
    tx.set(PLATFORM_REF, { d: encoded, revision: nextRevision, updatedAt: Date.now(), updatedBy: request.auth.uid });
  });
  return { ok: true, revision: nextRevision };
});

exports.studentLogin = onCall({ region: REGION, enforceAppCheck: true }, async (request) => {
  const codeValue = String(request.data?.code || '').trim();
  const device = String(request.data?.device || '');
  if (!/^\d{6}$/.test(codeValue) || device.length < 16 || device.length > 120) {
    throw new HttpsError('permission-denied', 'كود التفعيل أو الجهاز غير صالح.');
  }
  const uid = studentUid(codeValue);
  let student;
  let revision = 0;
  try {
    await getFirestore().runTransaction(async (tx) => {
      const { platform, revision: currentRevision } = await loadPlatform(tx);
      const code = platform.codes.find((item) => String(item.code) === codeValue);
      assertActiveCode(code);
      if (code.device && code.device !== device) {
        throw new HttpsError('permission-denied', 'هذا الكود مرتبط بجهاز آخر. اطلب تغيير الجهاز من الأدمن.');
      }
      if (!code.device) code.device = device;
      student = { ...code };
      revision = currentRevision + 1;
      tx.set(PLATFORM_REF, {
        d: encodePlatform(platform),
        revision,
        updatedAt: Date.now(),
        updatedBy: 'student-device-binding'
      });
    });
  } catch (error) {
    if (error.code === 'permission-denied') await limitLoginAttempts(request);
    throw error;
  }
  const token = await getAuth().createCustomToken(uid, { student: true });
  return { token, student, revision };
});

exports.studentGetPlatform = onCall({ region: REGION, enforceAppCheck: true }, async (request) => {
  requireStudent(request);
  const { platform, revision } = await loadPlatform();
  const student = findStudent(platform, request.auth.uid);
  assertActiveCode(student);
  delete platform.settings.pass;
  // Never return another student's activation code, profile, score, or history.
  platform.codes = [student];
  platform.requests = [];
  return { platform, revision };
});

exports.studentSaveProfile = onCall({ region: REGION, enforceAppCheck: true }, async (request) => {
  requireStudent(request);
  const image = request.data?.image;
  if (typeof image !== 'string' || image.length > 100_000 ||
      !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) {
    throw new HttpsError('invalid-argument', 'صورة الحساب غير صالحة أو أكبر من الحد المسموح.');
  }
  let student;
  let revision = 0;
  await getFirestore().runTransaction(async (tx) => {
    const { platform, revision: current } = await loadPlatform(tx);
    const record = findStudent(platform, request.auth.uid);
    assertActiveCode(record);
    record.img = image;
    student = { ...record };
    revision = current + 1;
    tx.set(PLATFORM_REF, { d: encodePlatform(platform), revision, updatedAt: Date.now(), updatedBy: request.auth.uid });
  });
  return { student, revision };
});
exports.studentClearMistakes = onCall({ region: REGION, enforceAppCheck: true }, async (request) => {
  requireStudent(request);
  let student;
  let revision = 0;
  await getFirestore().runTransaction(async (tx) => {
    const { platform, revision: current } = await loadPlatform(tx);
    const record = findStudent(platform, request.auth.uid);
    assertActiveCode(record);
    record.wrongBank = [];
    record.wr = [];
    student = { ...record };
    revision = current + 1;
    tx.set(PLATFORM_REF, { d: encodePlatform(platform), revision, updatedAt: Date.now(), updatedBy: request.auth.uid });
  });
  return { student, revision };
});


exports.studentSubmitExam = onCall({ region: REGION, enforceAppCheck: true }, async (request) => {
  requireStudent(request);
  const answers = request.data?.answers;
  let response;
  await getFirestore().runTransaction(async (tx) => {
    const { platform, revision: current } = await loadPlatform(tx);
    const student = findStudent(platform, request.auth.uid);
    assertActiveCode(student);
    const items = assertExamAnswers(platform, answers);
    const subjectIds = new Set(items.map(({ question }) => String(question.subject)));
    const subjectNames = [...subjectIds].map((id) => platform.subjects.find((item) => String(item.id) === id)?.name).filter(Boolean);
    const subjectName = subjectNames.length === 1 ? subjectNames[0] : 'مراجعة متنوعة';
    const correct = items.filter(({ question, answer }) => answer !== null && answer === question.answer).length;
    const wrong = items.filter(({ question, answer }) => answer !== null && answer !== question.answer).length;
    const total = items.length;
    const percent = Math.round((correct / total) * 100);
    const submittedAt = Date.now();
    const suspiciousExits = Math.max(0, Math.min(20, Math.floor(Number(request.data?.suspiciousExits) || 0)));
    const submissionType = ['manual', 'manual-exit', 'timeout', 'cheat'].includes(request.data?.submissionType) ? request.data.submissionType : 'manual';
    student.hist = Array.isArray(student.hist) ? student.hist : [];
    student.hist.push({ t: submittedAt, s: subjectName, c: correct, n: total, p: percent, lv: suspiciousExits });
    student.hist = student.hist.slice(-100);
    student.wr = Array.isArray(student.wr) ? student.wr : [];
    student.wr = student.wr.slice(0, 500);
    student.wrongBank = Array.isArray(student.wrongBank) ? student.wrongBank : [];
    student.wrongBank = student.wrongBank.slice(0, 500);
    student.ls = student.ls && typeof student.ls === 'object' ? student.ls : {};
    let mastered = 0;
    for (const { question, answer } of items) {
      if (answer === null) continue;
      const lesson = question.lesson || question.chapter || 'عام';
      const stats = student.ls[lesson] = student.ls[lesson] || { c: 0, n: 0 };
      stats.n++;
      const oldLength = student.wrongBank.length;
      if (answer === question.answer) {
        stats.c++;
        student.wr = student.wr.filter((id) => String(id) !== String(question.id));
        student.wrongBank = student.wrongBank.filter((item) => String(item.id) !== String(question.id));
        mastered += oldLength - student.wrongBank.length;
      } else {
        if (!student.wr.some((id) => String(id) === String(question.id))) student.wr.push(question.id);
        const old = student.wrongBank.find((item) => String(item.id) === String(question.id));
        const record = {
          id: question.id, subject: platform.subjects.find((item) => String(item.id) === String(question.subject))?.name || '', chapter: question.chapter || '', lesson: question.lesson || '',
          text: question.text, options: question.options.slice(), wrongAnswer: answer, correctAnswer: question.answer,
          explanation: question.explanation || 'لا يوجد شرح مضاف لهذا السؤال.', date: submittedAt,
          attempts: old ? (old.attempts || 1) + 1 : 1
        };
        if (old) Object.assign(old, record); else student.wrongBank.unshift(record);
      }
      student.wr = student.wr.slice(0, 500);
      student.wrongBank = student.wrongBank.slice(0, 500);
    }
    student.examLogs = Array.isArray(student.examLogs) ? student.examLogs : [];
    student.examLogs.push({
      startedAt: Number(request.data?.startedAt) || submittedAt, submittedAt,
      elapsedSeconds: Math.max(0, Math.min(86_400, Math.floor(Number(request.data?.elapsedSeconds) || 0))),
      suspiciousExits, autoSubmitted: submissionType === 'timeout' || submissionType === 'cheat',
      submissionType, subject: subjectName, score: correct, total, percent
    });
    student.examLogs = student.examLogs.slice(-100);
    platform.exams = (Number(platform.exams) || 0) + 1;
    const revision = current + 1;
    tx.set(PLATFORM_REF, { d: encodePlatform(platform), revision, updatedAt: submittedAt, updatedBy: request.auth.uid });
    response = { student: { ...student }, exams: platform.exams, revision, correct, wrong, total, percent, mastered };
  });
  return response;
});

exports.studentRequestDeviceChange = onCall({ region: REGION, enforceAppCheck: true }, async (request) => {
  const codeValue = String(request.data?.code || '').trim();
  const reason = String(request.data?.reason || '').trim().slice(0, 500);
  if (!/^\d{6}$/.test(codeValue) || reason.length < 3) {
    throw new HttpsError('invalid-argument', 'اكتب كود التفعيل وسببًا واضحًا للتغيير.');
  }
  await getFirestore().runTransaction(async (tx) => {
    const { platform, revision: currentRevision } = await loadPlatform(tx);
    const code = platform.codes.find((item) => String(item.code) === codeValue);
    assertActiveCode(code);
    if (platform.requests.some((item) => String(item.code) === codeValue && item.status === 'pending')) {
      throw new HttpsError('already-exists', 'لديك طلب قيد المراجعة.');
    }
    platform.requests.push({
      id: Date.now(), type: 'device_change', code: codeValue, name: code.name, reason,
      t: Date.now(), status: 'pending'
    });
    const revision = currentRevision + 1;
    tx.set(PLATFORM_REF, {
      d: encodePlatform(platform),
      revision,
      updatedAt: Date.now(), updatedBy: 'device-change-request'
    });
  });
  return { ok: true };
});

