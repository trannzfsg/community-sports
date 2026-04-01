import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, where, orderBy, doc, getDoc } from 'firebase/firestore';
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
  const cred = await signInWithEmailAndPassword(auth, 'tranzha83+badmintonmonday@gmail.com', 'testtest1234');
  const uid = cred.user.uid;
  console.log('signed in organiser uid', uid);

  const profileSnapshot = await getDoc(doc(db, 'users', uid));
  console.log('profile role', profileSnapshot.data()?.role);

  const sessionSnapshots = await getDocs(query(collection(db, 'sessions'), where('organiserId', '==', uid), orderBy('dayOfWeek')));
  console.log('owned series', sessionSnapshots.size);
  if (!sessionSnapshots.size) throw new Error('No owned series found');

  const target = sessionSnapshots.docs[0];
  const sessionSnapshot = await getDoc(doc(db, 'sessions', target.id));
  console.log('target series read ok', target.id, sessionSnapshot.data());

  await signOut(auth);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
