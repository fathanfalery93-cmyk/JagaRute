/* =========================================================
   firebase-messaging-sw.js
   =========================================================
   WAJIB ditaruh di ROOT domain (sejajar dengan index.html, BUKAN di
   dalam folder netlify/ atau folder lain) — supaya scope-nya mencakup
   seluruh situs. Browser akan menjalankan file ini di background untuk
   menampilkan notifikasi push walau tab Jagarute sedang tertutup.

   GANTI nilai firebaseConfig di bawah supaya SAMA PERSIS dengan yang
   ada di index.html (project yang sama).
========================================================= */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyADCjxTqzR_mWqMP7175vbE-Jphw4IVWJA",
  authDomain: "jagarute-b19fd.firebaseapp.com",
  projectId: "jagarute-b19fd",
  storageBucket: "jagarute-b19fd.firebasestorage.app",
  messagingSenderId: "221251984171",
  appId: "1:221251984171:web:64e06398eab4ae8981036e",
});

const messaging = firebase.messaging();

// Dipanggil browser saat notifikasi datang sementara TIDAK ada tab
// Jagarute yang sedang aktif dilihat (kalau tab sedang aktif, yang
// jalan adalah onMessage() di index.html, bukan file ini).
messaging.onBackgroundMessage((payload)=>{
  const title = payload?.notification?.title || 'Jagarute';
  const body = payload?.notification?.body || 'Status laporan kamu diperbarui.';
  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png', // opsional — sediakan file ini kalau punya, kalau tidak browser pakai ikon default
  });
});
