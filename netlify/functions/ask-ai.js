/* =========================================================
   CONTOH BACKEND: functions/ask-ai.js  (Netlify Function)
   =========================================================
   Ini implementasi referensi untuk endpoint yang sudah dipanggil
   front-end di AI_BACKEND_URL = '/.netlify/functions/ask-ai'.

   Cara pakai:
   1. Simpan file ini di  netlify/functions/ask-ai.js  pada repo kamu.
   2. Set environment variable di Netlify (Site settings → Environment
      variables), JANGAN ditulis langsung di kode:
        ANTHROPIC_API_KEY   = sk-ant-xxxxxxxx
        FIREBASE_PROJECT_ID = jagarute-b19fd
   3. `npm install firebase-admin node-fetch` di root project.
   4. Deploy. Front-end tidak perlu tahu API key sama sekali.

   Yang dijamin fungsi ini (dibanding versi lama yang fallback
   langsung ke api.anthropic.com dari browser):
   - API key HANYA ada di server, tidak pernah terkirim ke client.
   - Setiap request WAJIB menyertakan Firebase ID Token yang valid
     (baik warga anonim maupun admin) — menolak bot yang memanggil
     endpoint ini tanpa lewat aplikasi.
   - Rate limit sederhana per UID (misal 20 pertanyaan/10 menit)
     supaya satu orang tidak bisa menghabiskan kuota/biaya API.
========================================================= */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  // Di Netlify, kredensial service account TIDAK tersedia otomatis
  // (beda dengan di server Google Cloud sendiri). Karena itu kita
  // baca dari environment variable GOOGLE_APPLICATION_CREDENTIALS_JSON,
  // yang isinya adalah seluruh isi file JSON service account
  // (didapat dari Firebase Console → Project Settings → Service accounts
  // → Generate new private key), di-paste sebagai satu baris teks.
  const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!serviceAccountJson) {
    throw new Error('Environment variable GOOGLE_APPLICATION_CREDENTIALS_JSON belum diset di Netlify.');
  }
  const serviceAccount = JSON.parse(serviceAccountJson);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const RATE_LIMIT_MAX = 20;       // maksimal pertanyaan
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // per 10 menit

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 1) Verifikasi identitas pemanggil lewat Firebase ID Token.
  const authHeader = event.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Token tidak ditemukan.' }) };
  }

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (e) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Token tidak valid.' }) };
  }

  // 2) Rate limiting sederhana per UID memakai Firestore sebagai counter.
  const limitRef = db.collection('_aiRateLimit').doc(uid);
  const now = Date.now();
  try {
    const allowed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(limitRef);
      const data = snap.exists ? snap.data() : { count: 0, windowStart: now };
      const withinWindow = now - data.windowStart < RATE_LIMIT_WINDOW_MS;
      const count = withinWindow ? data.count + 1 : 1;
      const windowStart = withinWindow ? data.windowStart : now;
      if (count > RATE_LIMIT_MAX) return false;
      tx.set(limitRef, { count, windowStart });
      return true;
    });
    if (!allowed) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Terlalu banyak permintaan, coba lagi nanti.' }) };
    }
  } catch (e) {
    console.error('Rate limit error:', e);
    // Kalau rate limiter gagal, tetap lanjut (fail-open untuk UX),
    // tapi log error supaya bisa dipantau.
  }

  // 3) Teruskan ke Anthropic API — API key HANYA ada di sini, di server.
  const body = JSON.parse(event.body || '{}');
  const payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: Math.min(body.max_tokens || 500, 500),
    system: body.system,
    messages: body.messages,
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { statusCode: res.status, body: JSON.stringify(data) };
  } catch (e) {
    console.error('Anthropic API error:', e);
    return { statusCode: 502, body: JSON.stringify({ error: 'Gagal menghubungi layanan AI.' }) };
  }
};
