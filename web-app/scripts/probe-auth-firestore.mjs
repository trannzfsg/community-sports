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

async function probe(email, password) {
  console.log(`\n== Probing ${email} ==`);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  const profileSnap = await getDoc(doc(db, 'users', uid));
  console.log('profile exists:', profileSnap.exists(), profileSnap.data());
  const role = profileSnap.data()?.role;

  const sessionsQuery = role === 'organiser'
    ? query(collection(db, 'sessions'), where('organiserId', '==', uid), orderBy('dayOfWeek'))
    : query(collection(db, 'sessions'), orderBy('dayOfWeek'));

  const sessionsSnap = await getDocs(sessionsQuery);
  console.log('sessions count:', sessionsSnap.size);

  if (role === 'organiser') {
    const playersOwn = await getDocs(query(collection(db, 'players'), where('ownerOrganiserId', '==', uid)));
    const playersShared = await getDocs(query(collection(db, 'players'), where('ownerOrganiserId', '==', null)));
    console.log('players own/shared:', playersOwn.size, playersShared.size);
  }

  for (const sessionDoc of sessionsSnap.docs) {
    const eventSnap = await getDocs(query(collection(db, 'sessionEvents'), where('sessionSeriesId', '==', sessionDoc.id)));
    console.log('series', sessionDoc.id, 'events', eventSnap.size);
    for (const eventDoc of eventSnap.docs) {
      const regSnap = await getDocs(query(collection(db, 'registrations'), where('sessionEventId', '==', eventDoc.id)));
      console.log('event', eventDoc.id, 'regs', regSnap.size);
    }
  }

  await signOut(auth);
}

const email = process.argv[2];
const password = process.argv[3];
probe(email, password).catch((err) => {
  console.error(err);
  process.exit(1);
});
