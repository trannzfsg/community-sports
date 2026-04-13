import fs from 'node:fs';
import admin from 'firebase-admin';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp, getDoc } from 'firebase/firestore';

const serviceAccount = JSON.parse(fs.readFileSync(new URL('../temp-firebase-admin-key.json', import.meta.url), 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'community-sports-6584e' });
}
const customToken = await admin.auth().createCustomToken('vRuRwnVANDXAXcppo7nBbLNF8N22', { email: 'john@example.com' });

const app = initializeApp({
  apiKey: 'AIzaSyCTDIfDdwK_XSQpmBfxu8pm-Lc3gjKe0xg',
  authDomain: 'community-sports-6584e.firebaseapp.com',
  projectId: 'community-sports-6584e',
  storageBucket: 'community-sports-6584e.firebasestorage.app',
  messagingSenderId: '673994490005',
  appId: '1:673994490005:web:8825a5a07dd69a5d45db9c',
});

const auth = getAuth(app);
await signInWithCustomToken(auth, customToken);
console.log('SIGNED_IN_UID=' + auth.currentUser?.uid);

const db = getFirestore(app);
const eventSnap = await getDoc(doc(db, 'sessionEvents', 'zliuLWtLMGqpU2rY1sJk__20260413'));
console.log('EVENT_EXISTS=' + eventSnap.exists(), 'EVENT_ORGANISER=' + eventSnap.data()?.organiserId);

try {
  await setDoc(doc(db, 'registrations', 'sdk_debug_reg_manual'), {
    sessionEventId: 'zliuLWtLMGqpU2rY1sJk__20260413',
    sessionSeriesId: 'zliuLWtLMGqpU2rY1sJk',
    userId: 'manual-player__vRuRwnVANDXAXcppo7nBbLNF8N22__johnp1%40example.com',
    playerName: 'johnp1',
    playerEmail: 'johnp1@example.com',
    playerPaid: false,
    organiserPaid: false,
    status: 'registered',
    createdAt: serverTimestamp(),
  });
  console.log('SDK_WRITE=success');
} catch (err) {
  console.error('SDK_WRITE=fail', err.code, err.message);
  process.exitCode = 1;
}
