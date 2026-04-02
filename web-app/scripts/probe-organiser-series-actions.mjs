import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
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

function buildSessionEventId(seriesId, eventDate) {
  return `${seriesId}__${eventDate.replaceAll('-', '')}`;
}

async function main() {
  const email = 'tranzha83+badmintonmonday@gmail.com';
  const password = 'testtest1234';
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  console.log('signed in organiser uid', uid);

  const profileSnap = await getDoc(doc(db, 'users', uid));
  console.log('profile', profileSnap.data());

  const stamp = Date.now();
  const title = `Probe Series ${stamp}`;
  const nextGameOn = '2026-04-13';

  const seriesRef = await addDoc(collection(db, 'sessions'), {
    title,
    typeOfSport: 'Badminton',
    location: 'Probe Court',
    dayOfWeek: 'Mon',
    nextGameOn,
    startAt: '19:00',
    endAt: '21:00',
    firstSessionOn: nextGameOn,
    defaultPriceCasual: 15,
    capacity: 12,
    waitingListCapacity: 2,
    organiserId: uid,
    organiserName: profileSnap.data()?.displayName || email,
    status: 'active',
    copyRosterFromLastEvent: false,
    createdAt: serverTimestamp(),
  });
  console.log('created series', seriesRef.id);

  await updateDoc(doc(db, 'sessions', seriesRef.id), {
    title: `${title} Edited`,
    waitingListCapacity: 3,
  });
  console.log('edited series');

  const eventId = buildSessionEventId(seriesRef.id, nextGameOn);
  await updateDoc(doc(db, 'sessions', seriesRef.id), {
    nextGameOn,
  });

  await addDoc(collection(db, 'sessionEvents'), {
    sessionSeriesId: seriesRef.id,
    organiserId: uid,
    organiserName: profileSnap.data()?.displayName || email,
    title: `${title} Edited`,
    typeOfSport: 'Badminton',
    location: 'Probe Court',
    dayOfWeek: 'Mon',
    eventDate: nextGameOn,
    startAt: '19:00',
    endAt: '21:00',
    defaultPriceCasual: 15,
    capacity: 12,
    waitingListCapacity: 3,
    bookedCount: 0,
    waitingCount: 0,
    status: 'active',
    createdAt: serverTimestamp(),
  }).catch(async () => {
    // fallback deterministic doc if addDoc path is not what app uses; ignore if already exists later
    console.log('addDoc sessionEvents failed; checking existing deterministic event path');
  });

  const ownedSeries = await getDocs(query(collection(db, 'sessions'), where('organiserId', '==', uid), orderBy('dayOfWeek')));
  console.log('owned series count', ownedSeries.size);

  const maybeEvent = await getDoc(doc(db, 'sessionEvents', eventId));
  console.log('deterministic event exists', maybeEvent.exists());

  await updateDoc(doc(db, 'sessions', seriesRef.id), {
    status: 'inactive',
  });
  console.log('inactivated series');

  await deleteDoc(doc(db, 'sessions', seriesRef.id)).catch(() => {
    console.log('hard delete denied or skipped, as expected for normal workflow');
  });

  await signOut(auth);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
