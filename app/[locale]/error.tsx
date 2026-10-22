"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

const COPY = {
  en: {
    eyebrow: "Recovered safely",
    title: "This page hit a snag.",
    body: "Mimir kept the rest of the app alive. Try the request again or head back to the arena.",
    retry: "Try again",
    home: "Back home",
  },
  es: {
    eyebrow: "Recuperado",
    title: "Esta pagina fallo.",
    body: "Mimir mantuvo viva el resto de la app. Intenta otra vez o vuelve a la arena.",
    retry: "Intentar de nuevo",
    home: "Volver al inicio",
  },
} as const;

export default function LocaleError({ error, reset }: Props) {
  const params = useParams<{ locale?: string }>();
  const locale = params?.locale === "en" ? "en" : "es";
  const copy = COPY[locale];

  useEffect(() => {
    console.error("Localized route error", error);
  }, [error]);

  return (
    <section className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-2xl rounded-3xl border border-pv-ink/[0.08] big-pv-surface/70 p-8 sm:p-10 text-center shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <p className="text-xs uppercase tracking-[0.35em] text-pv-emerald/85 font-bold">
          {copy.eyebrow}
        </p>
        <h1 className="mt-4 font-display text-4xl sm:text-5xl font-bold tracking-tight text-pv-text">
          {copy.title}
        </h1>
        <p className="mt-4 text-sm sm:text-base text-pv-muted max-w-xl mx-auto">
          {copy.body}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={reset}
            className="w-full sm:w-auto px-5 py-3 rounded-xl bg-pv-emerald text-pv-bg font-bold hover:brightness-110 transition-all focus-ring"
          >
            {copy.retry}
          </button>
          <a
            href={`/${locale}`}
            className="w-full sm:w-auto px-5 py-3 rounded-xl border border-pv-ink/[0.12] text-pv-text hover:border-pv-ink/[0.2] hover:bg-pv-ink/[0.04] transition-all focus-ring"
          >
            {copy.home}
          </a>
        </div>
      </div>
    </section>
  );
}
