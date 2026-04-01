import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx), line.slice(idx + 1)];
    }),
);

const app = initializeApp({
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
});

const auth = getAuth(app);
const db = getFirestore(app);

async function main() {
  const email = 'tranzha83+badmintonmonday@gmail.com';
  const password = 'testtest1234';
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  console.log('uid', uid);

  const sessionsSnap = await getDocs(query(collection(db, 'sessions'), where('organiserId', '==', uid), orderBy('dayOfWeek')));
  console.log('sessions ok', sessionsSnap.size);

  for (const sessionDoc of sessionsSnap.docs) {
    console.log('series', sessionDoc.id, sessionDoc.data());
    try {
      const eventSnap = await getDocs(query(collection(db, 'sessionEvents'), where('sessionSeriesId', '==', sessionDoc.id)));
      console.log('event query ok', eventSnap.size);
      for (const eventDoc of eventSnap.docs) {
        console.log('event doc', eventDoc.id, eventDoc.data());
        const regSnap = await getDocs(query(collection(db, 'registrations'), where('sessionEventId', '==', eventDoc.id)));
        console.log('reg query ok', regSnap.size);
      }
    } catch (err) {
      console.error('failed on series', sessionDoc.id, err);
    }
  }

  await signOut(auth);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
