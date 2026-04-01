import Link from "next/link";

const cards = [
  {
    title: "Players",
    description: "Check session availability, book spots, and track payments.",
  },
  {
    title: "Organisers",
    description: "Manage sessions, payments, attendance, and communication.",
  },
  {
    title: "Firebase",
    description: "Config is wired. Next step is auth and Firestore-backed flows.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <section className="rounded-3xl bg-white p-10 shadow-sm ring-1 ring-zinc-200">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Community Sports
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Manage local sports sessions without the spreadsheet chaos.
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-600">
            The MVP is focused on badminton workflows first, with room to expand into broader community sports management.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/login"
              className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-700"
            >
              Open login
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full border border-zinc-300 px-6 py-3 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100"
            >
              View dashboard
            </Link>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <div
              key={card.title}
              className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200"
            >
              <h2 className="text-xl font-semibold">{card.title}</h2>
              <p className="mt-3 text-sm leading-7 text-zinc-600">{card.description}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
