const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'community-sports-6584e' });
}

const db = admin.firestore();

async function main() {
  const organiserSnap = await db.collection('users').where('role', '==', 'organiser').get();
  if (organiserSnap.empty) {
    throw new Error('No organiser user found for ownership backfill.');
  }
  if (organiserSnap.size !== 1) {
    throw new Error(`Expected exactly 1 organiser for backfill, found ${organiserSnap.size}.`);
  }

  const organiser = organiserSnap.docs[0];
  const organiserId = organiser.id;

  const seriesSnap = await db.collection('sessions').get();
  for (const seriesDoc of seriesSnap.docs) {
    const data = seriesDoc.data();
    if (!data.organiserId || data.organiserId !== organiserId) {
      await seriesDoc.ref.set({ organiserId }, { merge: true });
    }
  }

  const eventSnap = await db.collection('sessionEvents').get();
  for (const eventDoc of eventSnap.docs) {
    const data = eventDoc.data();
    if (!data.organiserId || data.organiserId !== organiserId) {
      await eventDoc.ref.set({ organiserId }, { merge: true });
    }
  }

  const nonPlayerUserIds = new Set();
  const adminUsers = await db.collection('users').where('role', 'in', ['admin', 'organiser']).get();
  adminUsers.forEach((doc) => nonPlayerUserIds.add(doc.id));

  const registrationSnap = await db.collection('registrations').get();
  const eventCounts = new Map();

  for (const regDoc of registrationSnap.docs) {
    const data = regDoc.data();
    if (nonPlayerUserIds.has(data.userId)) {
      await db.collection('payments').doc(`payment__${regDoc.id}`).delete().catch(() => {});
      await regDoc.ref.delete();
      continue;
    }

    const currentCount = eventCounts.get(data.sessionEventId) || 0;
    eventCounts.set(data.sessionEventId, currentCount + 1);
  }

  for (const eventDoc of eventSnap.docs) {
    const count = eventCounts.get(eventDoc.id) || 0;
    await eventDoc.ref.set({ bookedCount: count }, { merge: true });
  }

  console.log('Backfill complete:', { organiserId, seriesCount: seriesSnap.size, eventCount: eventSnap.size });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
