/* =========================================================
   netlify/functions/notify-status.js
   =========================================================
   Dipanggil dari browser admin setiap kali status sebuah laporan
   diubah (lihat notifyStatusChange() di index.html). Fungsi ini:
   1. Memverifikasi pemanggilnya benar admin asli (lewat Firebase ID
      Token + cek koleksi `admins` — sama seperti verifikasi di
      ask-ai.js), supaya endpoint ini tidak bisa disalahgunakan orang
      untuk kirim notifikasi sembarangan ke pelapor.
   2. Membaca dokumen laporan langsung dari Firestore (bukan percaya
      data yang dikirim client) untuk ambil fcmToken & nama jalan asli.
   3. Mengirim push notification lewat Firebase Cloud Messaging.

   Environment variables yang dipakai (SAMA seperti ask-ai.js, tidak
   perlu tambahan baru kalau kamu sudah setup fitur Tanya AI):
     FIREBASE_PROJECT_ID
     GOOGLE_APPLICATION_CREDENTIALS_JSON
========================================================= */

const admin = require('firebase-admin');

if (!admin.apps.length) {
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

const STATUS_LABEL = {
  belum: 'Belum Ditangani',
  tinjauan: 'Dalam Tinjauan',
  proses: 'Dalam Proses Perbaikan',
  selesai: 'Selesai Diperbaiki',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 1) Verifikasi pemanggil benar-benar admin.
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
  const adminDoc = await db.collection('admins').doc(uid).get();
  if (!adminDoc.exists) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Hanya admin yang boleh memicu notifikasi.' }) };
  }

  // 2) Ambil data laporan LANGSUNG dari Firestore (bukan dari body
  //    request) — supaya isi notifikasi tidak bisa dipalsukan client.
  const body = JSON.parse(event.body || '{}');
  const { reportId, newStatus } = body;
  if (!reportId || !STATUS_LABEL[newStatus]) {
    return { statusCode: 400, body: JSON.stringify({ error: 'reportId atau newStatus tidak valid.' }) };
  }

  const reportSnap = await db.collection('laporan').doc(reportId).get();
  if (!reportSnap.exists) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Laporan tidak ditemukan.' }) };
  }
  const report = reportSnap.data();

  if (!report.fcmToken) {
    // Pelapor tidak opt-in notifikasi — bukan error, cuma tidak ada
    // yang perlu dikirim.
    return { statusCode: 200, body: JSON.stringify({ sent: false, reason: 'no-token' }) };
  }

  // 3) Kirim push notification.
  try {
    await admin.messaging().send({
      token: report.fcmToken,
      notification: {
        title: 'Update Laporan Jagarute',
        body: `Laporan "${report.namaJalan}" sekarang berstatus: ${STATUS_LABEL[newStatus]}.`,
      },
      webpush: {
        fcmOptions: { link: '/' },
      },
    });
    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (e) {
    console.error('Gagal kirim FCM:', e.message);
    // Token kedaluwarsa/tidak valid itu wajar terjadi (mis. pelapor
    // uninstall/clear data browser) — bukan error server, jadi tetap
    // balas 200 supaya tidak bikin admin panik lihat error di console.
    return { statusCode: 200, body: JSON.stringify({ sent: false, reason: 'send-failed' }) };
  }
};
