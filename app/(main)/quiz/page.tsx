"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type QuizQuestion = {
  attempt_id: number;
  question_id: number;
  question_position: number;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
};

type QuizResult = {
  attempt_id: number;
  score: number;
  total_questions: number;
  reward_granted: boolean;
  reward_amount: number;
  balance_after: number;
};

type SelectedAnswers = Record<number, "A" | "B" | "C" | "D">;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const OPTIONS = [
  { key: "A", field: "option_a" },
  { key: "B", field: "option_b" },
  { key: "C", field: "option_c" },
  { key: "D", field: "option_d" },
] as const;

export default function QuizPage() {
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<SelectedAnswers>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answeredCount = useMemo(() => {
    return questions.filter((q) => answers[q.question_id]).length;
  }, [questions, answers]);

  const canSubmit = questions.length === 5 && answeredCount === 5 && !result;

  const startQuiz = async () => {
    setStarting(true);
    setError(null);
    setResult(null);
    setAnswers({});

    try {
      const { data, error } = await supabase.rpc("start_daily_quiz");

      if (error) {
        const msg = String(error.message || "");

        if (msg.includes("Daily quiz already completed")) {
          setError("Dzisiejszy quiz został już ukończony. Wróć jutro po kolejną próbę.");
        } else {
          setError(msg || "Nie udało się rozpocząć quizu.");
        }

        setQuestions([]);
        return;
      }

      setQuestions((data ?? []) as QuizQuestion[]);
    } finally {
      setStarting(false);
      setLoading(false);
    }
  };

  const submitQuiz = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      const payload = questions.map((q) => ({
        questionId: q.question_id,
        selectedOption: answers[q.question_id],
      }));

      const { data, error } = await supabase.rpc("submit_daily_quiz", {
        p_answers: payload,
      });

      if (error) {
        const msg = String(error.message || "");

        if (msg.includes("Daily quiz already completed")) {
          setError("Ten quiz został już zakończony.");
        } else {
          setError(msg || "Nie udało się zakończyć quizu.");
        }

        return;
      }

            const first = Array.isArray(data) ? data[0] : null;
            const quizResult = first as QuizResult | null;

            setResult(quizResult);

            if (quizResult?.reward_granted) {
            window.dispatchEvent(
                new CustomEvent("vb:refresh-balance", {
                detail: {
                    balanceAfter: quizResult.balance_after,
                },
                })
            );
            }
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    void startQuiz();
  }, []);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950/70 shadow-[0_18px_80px_rgba(0,0,0,0.35)]">
        <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.11),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.95),rgba(5,5,5,0.98))] p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                VirtualBook Football
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Quiz dnia
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
                Odpowiedz poprawnie na 5 losowych pytań piłkarskich i zgarnij{" "}
                <span className="font-semibold text-white">50 VB</span>. Quiz można ukończyć tylko raz dziennie.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:min-w-[360px]">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                  Pytań
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {questions.length || 5}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                  Odp.
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {answeredCount}/5
                </div>
              </div>

              <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-yellow-500/80">
                  Nagroda
                </div>
                <div className="mt-2 text-2xl font-semibold text-yellow-200">
                  50 VB
                </div>
              </div>
            </div>
          </div>
        </div>

        {result ? (
          <div
            className={cn(
              "border-b p-5 sm:p-6",
              result.reward_granted
                ? "border-green-500/20 bg-green-500/10"
                : "border-red-500/20 bg-red-500/10"
            )}
          >
            <div
              className={cn(
                "text-lg font-semibold",
                result.reward_granted ? "text-green-200" : "text-red-200"
              )}
            >
              Wynik: {result.score}/{result.total_questions}
            </div>

            <div className="mt-2 text-sm text-neutral-300">
              {result.reward_granted ? (
                <>
                  Brawo. Wszystkie odpowiedzi są poprawne. Dodano{" "}
                  <span className="font-semibold text-white">
                    {Number(result.reward_amount).toFixed(0)} VB
                  </span>
                  . Nowe saldo po wpisie w ledgerze:{" "}
                  <span className="font-semibold text-white">
                    {Number(result.balance_after).toFixed(2)} VB
                  </span>
                  .
                </>
              ) : (
                "Nie udało się zdobyć nagrody. Aby otrzymać 50 VB, trzeba odpowiedzieć poprawnie na wszystkie 5 pytań."
              )}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="border-b border-red-500/20 bg-red-500/10 p-5 text-sm text-red-200 sm:p-6">
            {error}
          </div>
        ) : null}

        <div className="p-5 sm:p-6">
          {loading || starting ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4"
                >
                  <div className="h-5 w-2/3 rounded bg-neutral-800" />
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <div className="h-12 rounded-2xl bg-neutral-800" />
                    <div className="h-12 rounded-2xl bg-neutral-800" />
                    <div className="h-12 rounded-2xl bg-neutral-800" />
                    <div className="h-12 rounded-2xl bg-neutral-800" />
                  </div>
                </div>
              ))}
            </div>
          ) : questions.length > 0 ? (
            <div className="space-y-4">
              {questions.map((q) => (
                <div
                  key={q.question_id}
                  className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-sm font-semibold text-white">
                      {q.question_position}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-base font-semibold leading-7 text-white">
                        {q.question}
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {OPTIONS.map((opt) => {
                          const selected = answers[q.question_id] === opt.key;
                          const label = q[opt.field];

                          return (
                            <button
                              key={opt.key}
                              type="button"
                              disabled={!!result}
                              onClick={() => {
                                if (result) return;

                                setAnswers((prev) => ({
                                  ...prev,
                                  [q.question_id]: opt.key,
                                }));
                              }}
                              className={cn(
                                "rounded-2xl border px-4 py-3 text-left transition",
                                selected
                                  ? "border-white bg-white text-black"
                                  : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:border-neutral-700 hover:bg-neutral-900",
                                result && "cursor-default"
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <span
                                  className={cn(
                                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                                    selected
                                      ? "border-black/15 bg-black/5 text-black"
                                      : "border-neutral-700 bg-neutral-900 text-neutral-300"
                                  )}
                                >
                                  {opt.key}
                                </span>

                                <span className="text-sm font-medium">
                                  {label}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {!result ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-neutral-500">
                    Odpowiedz na wszystkie pytania, żeby zakończyć quiz.
                  </div>

                  <button
                    type="button"
                    disabled={!canSubmit || submitting}
                    onClick={submitQuiz}
                    className={cn(
                      "rounded-2xl px-5 py-3 text-sm font-semibold transition",
                      canSubmit && !submitting
                        ? "bg-white text-black hover:bg-neutral-200"
                        : "cursor-not-allowed bg-neutral-800 text-neutral-500"
                    )}
                  >
                    {submitting ? "Sprawdzam…" : "Zakończ quiz"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300">
              Brak dostępnego quizu.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}