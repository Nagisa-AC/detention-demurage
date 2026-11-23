"use client";

export default function GlobalError({ error }: { error: { digest?: string } }) {
  void error;
  return (
    <html lang="en">
      <body>
        <p>Something went wrong.</p>
      </body>
    </html>
  );
}
