import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, where, doc, setDoc, serverTimestamp } from 'firebase/firestore';
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
  console.log('signed in organiser uid', cred.user.uid);

  const ownedEvents = await getDocs(query(collection(db, 'sessionEvents'), where('organiserId', '==', cred.user.uid)));
  if (!ownedEvents.size) throw new Error('No organiser-owned events found.');

  const eventIds = ownedEvents.docs.map((docSnap) => docSnap.id);
  let target = null;
  for (const eventId of eventIds) {
    const regsSnap = await getDocs(query(collection(db, 'registrations'), where('sessionEventId', '==', eventId)));
    if (regsSnap.size) {
      target = regsSnap.docs[0];
      break;
    }
  }

  if (!target) throw new Error('No registrations found for organiser-owned events.');
  const data = target.data();

  await setDoc(doc(db, 'payments', `payment__${target.id}`), {
    sessionSeriesId: data.sessionSeriesId,
    sessionEventId: data.sessionEventId,
    registrationId: target.id,
    organiserId: cred.user.uid,
    userId: data.userId,
    playerName: data.playerName,
    playerEmail: data.playerEmail,
    amount: 15,
    playerPaid: true,
    organiserPaid: true,
    effectivePaid: true,
    status: 'paid',
    updatedAt: serverTimestamp(),
  }, { merge: true });

  console.log('payment write succeeded for registration', target.id);
  await signOut(auth);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
