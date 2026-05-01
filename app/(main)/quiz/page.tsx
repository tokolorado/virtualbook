// app/(main)/quiz/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type OptionKey = "A" | "B" | "C" | "D";

type QuizLevelSlug = "very_easy" | "easy" | "medium" | "hard" | "very_hard";

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
  balance_after?: number | null;
};

type QuizAttemptRow = {
  id: number | string;
  status: string | null;
  score: number | string | null;
  total_questions: number | string | null;
  reward_granted: boolean | null;
  reward_amount: number | string | null;
  level_slug?: string | null;
};

type SelectedAnswers = Record<number, OptionKey | null>;

type QuizMode = "checking" | "idle" | "running" | "completed";

const QUESTION_TIME_SECONDS = 10;

const QUIZ_LEVELS: Array<{
  slug: QuizLevelSlug;
  label: string;
  shortLabel: string;
  description: string;
  mix: string;
  reward: number;
}> = [
  {
    slug: "very_easy",
    label: "Bardzo łatwy",
    shortLabel: "Bardzo łatwy",
    description: "Najprostsze pytania piłkarskie. Dobry poziom na rozgrzewkę.",
    mix: "4 bardzo łatwe + 1 łatwe",
    reward: 50,
  },
  {
    slug: "easy",
    label: "Łatwy",
    shortLabel: "Łatwy",
    description: "Spokojny poziom z jednym pytaniem średnim.",
    mix: "3 bardzo łatwe + 1 łatwe + 1 średnie",
    reward: 50,
  },
  {
    slug: "medium",
    label: "Średni",
    shortLabel: "Średni",
    description: "Standardowy quiz dla regularnych fanów piłki.",
    mix: "1 łatwe + 3 średnie + 1 trudne",
    reward: 50,
  },
  {
    slug: "hard",
    label: "Trudny",
    shortLabel: "Trudny",
    description: "Wymaga dobrej wiedzy o klubach, ligach i historii futbolu.",
    mix: "1 średnie + 3 trudne + 1 bardzo trudne",
    reward: 50,
  },
  {
    slug: "very_hard",
    label: "Bardzo trudny",
    shortLabel: "Bardzo trudny",
    description: "Poziom ekspercki. Najtrudniejszy wariant quizu dnia.",
    mix: "1 średnie + 2 trudne + 2 bardzo trudne",
    reward: 50,
  },
];

const OPTIONS = [
  { key: "A", field: "option_a" },
  { key: "B", field: "option_b" },
  { key: "C", field: "option_c" },
  { key: "D", field: "option_d" },
] as const;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function isQuizLevelSlug(value: unknown): value is QuizLevelSlug {
  return QUIZ_LEVELS.some((level) => level.slug === value);
}

function formatTomorrowLabel() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  return tomorrow.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
}

function formatBalance(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value.toFixed(2);
}

export default function QuizPage() {
  const [mode, setMode] = useState<QuizMode>("checking");

  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [selectedLevel, setSelectedLevel] = useState<QuizLevelSlug>("easy");

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<SelectedAnswers>({});
  const [result, setResult] = useState<QuizResult | null>(null);

  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME_SECONDS);
  const [error, setError] = useState<string | null>(null);

  const answerLockRef = useRef(false);

  const currentQuestion = questions[currentIndex] ?? null;

  const selectedLevelMeta = useMemo(() => {
    return QUIZ_LEVELS.find((level) => level.slug === selectedLevel) ?? QUIZ_LEVELS[1];
  }, [selectedLevel]);

  const answeredCount = useMemo(() => {
    return Object.keys(answers).length;
  }, [answers]);

  const progressPercent = questions.length
    ? ((currentIndex + 1) / questions.length) * 100
    : 0;

  const timerPercent = (timeLeft / QUESTION_TIME_SECONDS) * 100;

  const checkExistingAttempt = useCallback(async () => {
    setMode("checking");
    setError(null);

    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("quiz_daily_attempts")
      .select(
        "id, status, score, total_questions, reward_granted, reward_amount, level_slug"
      )
      .eq("quiz_date", today)
      .maybeSingle();

    if (error) {
      setMode("idle");
      return;
    }

    const row = (data ?? null) as QuizAttemptRow | null;

    if (isQuizLevelSlug(row?.level_slug)) {
      setSelectedLevel(row.level_slug);
    }

    if (row?.status === "completed") {
      setResult({
        attempt_id: toNumber(row.id),
        score: toNumber(row.score),
        total_questions: toNumber(row.total_questions, 5),
        reward_granted: Boolean(row.reward_granted),
        reward_amount: toNumber(row.reward_amount),
        balance_after: null,
      });

      setQuestions([]);
      setAnswers({});
      setCurrentIndex(0);
      setMode("completed");
      return;
    }

    setMode("idle");
  }, []);

  useEffect(() => {
    void checkExistingAttempt();
  }, [checkExistingAttempt]);

  const startQuiz = async () => {
    if (starting) return;

    setStarting(true);
    setError(null);
    setResult(null);
    setQuestions([]);
    setAnswers({});
    setCurrentIndex(0);
    setTimeLeft(QUESTION_TIME_SECONDS);
    answerLockRef.current = false;

    try {
      const { data, error } = await supabase.rpc("start_daily_quiz", {
        p_level_slug: selectedLevel,
      });

      if (error) {
        const msg = String(error.message || "");

        if (msg.includes("Daily quiz already completed")) {
          await checkExistingAttempt();
          return;
        }

        setError(msg || "Nie udało się rozpocząć quizu.");
        setMode("idle");
        return;
      }

      const loadedQuestions = ((data ?? []) as QuizQuestion[]).sort(
        (a, b) => Number(a.question_position) - Number(b.question_position)
      );

      if (loadedQuestions.length !== 5) {
        setError("Quiz nie ma poprawnej liczby pytań.");
        setMode("idle");
        return;
      }

      setQuestions(loadedQuestions);
      setMode("running");
    } finally {
      setStarting(false);
    }
  };

  const submitQuiz = useCallback(
    async (finalAnswers: SelectedAnswers) => {
      if (submitting) return;

      setSubmitting(true);
      setError(null);

      try {
        const payload = questions.map((q) => ({
          questionId: q.question_id,
          selectedOption: finalAnswers[q.question_id] ?? null,
        }));

        const { data, error } = await supabase.rpc("submit_daily_quiz", {
          p_answers: payload,
        });

        if (error) {
          const msg = String(error.message || "");

          if (msg.includes("Daily quiz already completed")) {
            await checkExistingAttempt();
            return;
          }

          setError(msg || "Nie udało się zakończyć quizu.");
          return;
        }

        const first = Array.isArray(data) ? data[0] : null;

        if (!first) {
          setError("Nie udało się odczytać wyniku quizu.");
          return;
        }

        const raw = first as Record<string, unknown>;

        const quizResult: QuizResult = {
          attempt_id: toNumber(raw.attempt_id),
          score: toNumber(raw.score),
          total_questions: toNumber(raw.total_questions, 5),
          reward_granted: Boolean(raw.reward_granted),
          reward_amount: toNumber(raw.reward_amount),
          balance_after:
            raw.balance_after === null || raw.balance_after === undefined
              ? null
              : toNumber(raw.balance_after),
        };

        setResult(quizResult);
        setMode("completed");

        if (quizResult.reward_granted) {
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
    },
    [checkExistingAttempt, questions, submitting]
  );

  const answerCurrentQuestion = useCallback(
    async (selectedOption: OptionKey | null) => {
      if (mode !== "running") return;
      if (!currentQuestion) return;
      if (answerLockRef.current) return;

      answerLockRef.current = true;

      const nextAnswers: SelectedAnswers = {
        ...answers,
        [currentQuestion.question_id]: selectedOption,
      };

      setAnswers(nextAnswers);

      const isLastQuestion = currentIndex >= questions.length - 1;

      if (isLastQuestion) {
        await submitQuiz(nextAnswers);
        answerLockRef.current = false;
        return;
      }

      setCurrentIndex((value) => value + 1);
      setTimeLeft(QUESTION_TIME_SECONDS);

      window.setTimeout(() => {
        answerLockRef.current = false;
      }, 80);
    },
    [
      answers,
      currentIndex,
      currentQuestion,
      mode,
      questions.length,
      submitQuiz,
    ]
  );

  useEffect(() => {
    if (mode !== "running") return;
    if (!currentQuestion) return;

    setTimeLeft(QUESTION_TIME_SECONDS);

    const intervalId = window.setInterval(() => {
      setTimeLeft((previous) => {
        if (previous <= 1) return 0;
        return previous - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentIndex, currentQuestion, mode]);

  useEffect(() => {
    if (mode !== "running") return;
    if (timeLeft !== 0) return;

    void answerCurrentQuestion(null);
  }, [answerCurrentQuestion, mode, timeLeft]);

  const renderStartScreen = () => {
    return (
      <div className="p-5 sm:p-6">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-5 sm:p-6">
          <div className="max-w-3xl">
            <div className="text-xl font-semibold text-white">
              Gotowy na quiz dnia?
            </div>

            <p className="mt-3 text-sm leading-7 text-neutral-400">
              Wybierz poziom trudności i kliknij start. System wylosuje 5 pytań.
              Każde pytanie pojawi się pojedynczo, a na odpowiedź masz{" "}
              <span className="font-semibold text-white">10 sekund</span>.
              Po wybraniu odpowiedzi automatycznie przejdziesz dalej.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                  Pytań
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">5</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                  Czas
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  10s
                </div>
              </div>

              <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-yellow-500/80">
                  Nagroda
                </div>
                <div className="mt-2 text-2xl font-semibold text-yellow-200">
                  {selectedLevelMeta.reward} VB
                </div>
              </div>
            </div>
          </div>

          <div className="mt-7">
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              Wybierz poziom
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {QUIZ_LEVELS.map((level) => {
                const active = selectedLevel === level.slug;

                return (
                  <button
                    key={level.slug}
                    type="button"
                    disabled={starting}
                    onClick={() => setSelectedLevel(level.slug)}
                    className={cn(
                      "rounded-2xl border p-4 text-left transition",
                      starting && "cursor-not-allowed opacity-70",
                      active
                        ? "border-white bg-white text-black shadow-[0_12px_50px_rgba(255,255,255,0.08)]"
                        : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:border-neutral-700 hover:bg-neutral-900"
                    )}
                  >
                    <div className="text-sm font-semibold">{level.label}</div>

                    <div
                      className={cn(
                        "mt-2 text-xs leading-5",
                        active ? "text-black/70" : "text-neutral-500"
                      )}
                    >
                      {level.description}
                    </div>

                    <div
                      className={cn(
                        "mt-3 rounded-xl border px-3 py-2 text-[11px] leading-5",
                        active
                          ? "border-black/10 bg-black/5 text-black/70"
                          : "border-neutral-800 bg-neutral-900 text-neutral-400"
                      )}
                    >
                      {level.mix}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={startQuiz}
              disabled={starting}
              className={cn(
                "rounded-2xl px-5 py-3 text-sm font-semibold transition",
                starting
                  ? "cursor-not-allowed bg-neutral-800 text-neutral-500"
                  : "bg-white text-black hover:bg-neutral-200"
              )}
            >
              {starting ? "Losuję pytania…" : "Rozpocznij quiz"}
            </button>

            <div className="text-sm text-neutral-500">
              Wybrany poziom:{" "}
              <span className="font-semibold text-white">
                {selectedLevelMeta.label}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderRunningScreen = () => {
    if (!currentQuestion) return null;

    return (
      <div className="p-5 sm:p-6">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                Pytanie {currentIndex + 1} z {questions.length}
              </div>

              <div className="mt-2 text-sm text-neutral-400">
                Poziom:{" "}
                <span className="font-semibold text-neutral-200">
                  {selectedLevelMeta.label}
                </span>
                . Wybierz odpowiedź. Po kliknięciu przejdziesz dalej.
              </div>
            </div>

            <div
              className={cn(
                "rounded-2xl border px-4 py-3 text-center",
                timeLeft <= 3
                  ? "border-red-500/30 bg-red-500/10"
                  : "border-neutral-800 bg-neutral-950"
              )}
            >
              <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                Czas
              </div>
              <div
                className={cn(
                  "mt-1 text-2xl font-semibold",
                  timeLeft <= 3 ? "text-red-300" : "text-white"
                )}
              >
                {timeLeft}s
              </div>
            </div>
          </div>

          <div className="mt-5 h-2 overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-white transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-800">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                timeLeft <= 3 ? "bg-red-400" : "bg-yellow-300"
              )}
              style={{ width: `${timerPercent}%` }}
            />
          </div>

          <div className="mt-8">
            <div className="text-2xl font-semibold leading-snug text-white">
              {currentQuestion.question}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {OPTIONS.map((opt) => {
                const label = currentQuestion[opt.field];

                return (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={answerLockRef.current || submitting}
                    onClick={() => void answerCurrentQuestion(opt.key)}
                    className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-4 text-left text-neutral-100 transition hover:border-neutral-600 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-xs font-semibold text-neutral-300">
                        {opt.key}
                      </span>

                      <span className="text-sm font-semibold">{label}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 text-sm text-neutral-500">
              Odpowiedzi zapisane:{" "}
              <span className="font-semibold text-white">{answeredCount}</span>
              /5
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCompletedScreen = () => {
    const score = result?.score ?? 0;
    const total = result?.total_questions ?? 5;
    const wonReward = Boolean(result?.reward_granted);
    const rewardAmount = toNumber(result?.reward_amount, selectedLevelMeta.reward);
    const balanceAfter = formatBalance(result?.balance_after);

    return (
      <div className="p-5 sm:p-6">
        <div
          className={cn(
            "rounded-3xl border p-6",
            wonReward
              ? "border-green-500/20 bg-green-500/10"
              : "border-neutral-800 bg-neutral-900/40"
          )}
        >
          <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            Quiz ukończony
          </div>

          <div className="mt-3 text-3xl font-semibold text-white">
            Wynik: {score}/{total}
          </div>

          <div className="mt-2 text-sm text-neutral-400">
            Poziom:{" "}
            <span className="font-semibold text-white">
              {selectedLevelMeta.label}
            </span>
          </div>

          <div className="mt-3 max-w-2xl text-sm leading-7 text-neutral-300">
            {wonReward ? (
              <>
                Brawo. Wszystkie odpowiedzi są poprawne. Otrzymujesz{" "}
                <span className="font-semibold text-white">
                  {rewardAmount.toFixed(0)} VB
                </span>
                {balanceAfter ? (
                  <>
                    . Nowe saldo:{" "}
                    <span className="font-semibold text-white">
                      {balanceAfter} VB
                    </span>
                    .
                  </>
                ) : (
                  "."
                )}
              </>
            ) : (
              <>
                Nie udało się zdobyć nagrody. Aby otrzymać{" "}
                <span className="font-semibold text-white">
                  {selectedLevelMeta.reward} VB
                </span>
                , trzeba odpowiedzieć poprawnie na wszystkie 5 pytań.
              </>
            )}
          </div>

          <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-400">
            Dzisiejszy quiz jest już zakończony. Kolejna próba będzie dostępna
            jutro:{" "}
            <span className="font-semibold text-white">
              {formatTomorrowLabel()}
            </span>
            .
          </div>
        </div>
      </div>
    );
  };

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
                5 pytań, 10 sekund na każde pytanie. Wybierz poziom trudności,
                odpowiedz bezbłędnie i zgarnij{" "}
                <span className="font-semibold text-white">
                  {selectedLevelMeta.reward} VB
                </span>
                .
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:min-w-[360px]">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                  Pytanie
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {mode === "running" ? `${currentIndex + 1}/5` : "5"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                  Czas
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {mode === "running" ? `${timeLeft}s` : "10s"}
                </div>
              </div>

              <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-yellow-500/80">
                  Nagroda
                </div>
                <div className="mt-2 text-2xl font-semibold text-yellow-200">
                  {selectedLevelMeta.reward} VB
                </div>
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="border-b border-red-500/20 bg-red-500/10 p-5 text-sm text-red-200 sm:p-6">
            {error}
          </div>
        ) : null}

        {mode === "checking" ? (
          <div className="p-5 sm:p-6">
            <div className="animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6">
              <div className="h-5 w-52 rounded bg-neutral-800" />
              <div className="mt-4 h-4 w-96 max-w-full rounded bg-neutral-800" />
              <div className="mt-6 h-12 w-40 rounded-2xl bg-neutral-800" />
            </div>
          </div>
        ) : mode === "idle" ? (
          renderStartScreen()
        ) : mode === "running" ? (
          renderRunningScreen()
        ) : (
          renderCompletedScreen()
        )}
      </section>
    </div>
  );
}