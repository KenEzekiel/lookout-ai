import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Lookout AI</h1>
      <p className="mt-2 text-muted-foreground">Project initialized.</p>
    </main>
  );
}
