"use client";

export default function ErrorPage({ error, reset }: { error: { digest?: string }; reset: () => void }) {
  void error;
  return (
    <main className="center">
      <div className="auth">
        <div className="logo">
          <i />
          Tidemark Recovery
        </div>
        <h2>Something went wrong</h2>
        <p>Please try again.</p>
        <button className="btn primary full" type="button" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </main>
  );
}
