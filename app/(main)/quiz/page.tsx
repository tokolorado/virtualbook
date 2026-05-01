// app/(main)/quiz/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type OptionKey = "A" | "B" | "C" | "D";

type QuizMode = "checking" | "idle" | "running" | "completed";

type QuizLevel = {
  slug: string;
  name: string;
  description: string | null;
  reward_amount: number | string | null;
  sort_order: number;
  question_count: number;
  time_limit_seconds: number;
  mix: Record<string, number> | null;
};

type QuizAttempt = {
  id: number;
  level_slug: string;
  status: string;
  score: number | null;
  total_questions: number | null;
  reward_granted: boolean | null;
  reward_amount: number | string | null;
  completed_at: string | null;
};

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

type SelectedAnswers = Record<number, OptionKey | null>;

const DEFAULT_QUESTION_TIME_SECONDS = 10;

const OPTIONS = [
  { key: "A", field: "option_a" },
  { key: "B", field: "option_b" },
  { key: "C", field: "option_c" },
  { key: "D", field: "option_d" },
] as const;

const DIFFICULTY_LABELS: Record<string, string> = {
  very_easy: "Bardzo łatwe",
  easy: "Łatwe",
  medium: "Średnie",
  hard: "Trudne",
  very_hard: "Bardzo trudne",
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toNumber(value: number | string | null | undefined, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function todayWarsawYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatMix(mix: Record<string, number> | null | undefined) {
  if (!mix) return "Mieszany zestaw pytań";

  const entries = Object.entries(mix)
    .filter(([, count]) => Number(count) > 0)
    .map(([key, count]) => {
      const label = DIFFICULTY_LABELS[key] ?? key;
      return `${count} ${label.toLowerCase()}`;
    });

  return entries.length ? entries.join(" + ") : "Mieszany zestaw pytań";
}

function getLevelAccent(slug: string) {
  if (slug === "very_easy") {
    return {
      border: "border-emerald-500/20",
      bg: "bg-emerald-500/10",
      text: "text-emerald-200",
      label: "text-emerald-400",
    };
  }

  if (slug === "easy") {
    return {
      border: "border-sky-500/20",
      bg: "bg-sky-500/10",
      text: "text-sky-200",
      label: "text-sky-400",
    };
  }

  if (slug === "medium") {
    return {
      border: "border-yellow-500/20",
      bg: "bg-yellow-500/10",
      text: "text-yellow-200",
      label: "text-yellow-400",
    };
  }

  if (slug === "hard") {
    return {
      border: "border-orange-500/20",
      bg: "bg-orange-500/10",
      text: "text-orange-200",
      label: "text-orange-400",
    };
  }

  return {
    border: "border-red-500/20",
    bg: "bg-red-500/10",
    text: "text-red-200",
    label: "text-red-400",
  };
}

function StatBox({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "yellow";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        tone === "yellow"
          ? "border-yellow-500/20 bg-yellow-500/10"
          : "border-neutral-800 bg-neutral-950/80"
      )}
    >
      <div
        className={cn(
          "text-[11px] uppercase tracking-[0.18em]",
          tone === "yellow" ? "text-yellow-500/80" : "text-neutral-500"
        )}
      >
        {label}
      </div>

      <div
        className={cn(
          "mt-2 text-2xl font-semibold",
          tone === "yellow" ? "text-yellow-200" : "text-white"
        )}
      >
        {value}
      </div>
    </div>
  );
}

export default function QuizPage() {
  const [mode, setMode] = useState<QuizMode>("checking");
  const [quizDate, setQuizDate] = useState(() => todayWarsawYmd());

  const [levels, setLevels] = useState<QuizLevel[]>([]);
  const [attempts, setAttempts] = useState<Record<string, QuizAttempt>>({});

  const [activeLevel, setActiveLevel] = useState<QuizLevel | null>(null);
  const [activeAttemptId, setActiveAttemptId] = useState<number | null>(null);

  const [startingLevelSlug, setStartingLevelSlug] = useState<string | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<SelectedAnswers>({});
  const [result, setResult] = useState<QuizResult | null>(null);

  const [timeLeft, setTimeLeft] = useState(DEFAULT_QUESTION_TIME_SECONDS);
  const [timerAnimationKey, setTimerAnimationKey] = useState(0);
  const [timerAnimating, setTimerAnimating] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const answerLockRef = useRef(false);
  const answerCurrentQuestionRef = useRef<
    ((selectedOption: OptionKey | null) => Promise<void>) | null
  >(null);

  const currentQuestion = questions[currentIndex] ?? null;

  const questionTimeSeconds = activeLevel?.time_limit_seconds
    ? Number(activeLevel.time_limit_seconds)
    : DEFAULT_QUESTION_TIME_SECONDS;

  const answeredCount = useMemo(() => {
    return Object.keys(answers).length;
  }, [answers]);

  const completedCount = useMemo(() => {
    return Object.values(attempts).filter(
      (attempt) => attempt.status === "completed"
    ).length;
  }, [attempts]);

  const totalRewardAvailable = useMemo(() => {
    return levels.reduce(
      (sum, level) => sum + toNumber(level.reward_amount, 0),
      0
    );
  }, [levels]);

  const rewardEarnedToday = useMemo(() => {
    return Object.values(attempts).reduce((sum, attempt) => {
      if (attempt.status !== "completed") return sum;
      if (!attempt.reward_granted) return sum;

      return sum + toNumber(attempt.reward_amount, 0);
    }, 0);
  }, [attempts]);

  const getPreviousLevel = useCallback(
    (level: QuizLevel) => {
      const levelIndex = levels.findIndex((item) => item.slug === level.slug);

      if (levelIndex <= 0) return null;

      return levels[levelIndex - 1] ?? null;
    },
    [levels]
  );

  const getPreviousLevelName = useCallback(
    (level: QuizLevel) => {
      return getPreviousLevel(level)?.name ?? null;
    },
    [getPreviousLevel]
  );

  const isLevelUnlocked = useCallback(
    (level: QuizLevel) => {
      const previousLevel = getPreviousLevel(level);

      if (!previousLevel) return true;

      const previousAttempt = attempts[previousLevel.slug];

      return (
        previousAttempt?.status === "completed" &&
        Boolean(previousAttempt.reward_granted)
      );
    },
    [attempts, getPreviousLevel]
  );

  const loadQuizState = useCallback(async () => {
    setMode("checking");
    setError(null);

    const [levelsResult, attemptsResult] = await Promise.all([
      supabase
        .from("quiz_levels")
        .select(
          "slug, name, description, reward_amount, sort_order, question_count, time_limit_seconds, mix"
        )
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),

      supabase
        .from("quiz_daily_attempts")
        .select(
          "id, level_slug, status, score, total_questions, reward_granted, reward_amount, completed_at"
        )
        .eq("quiz_date", quizDate),
    ]);

    if (levelsResult.error) {
      setError(
        levelsResult.error.message || "Nie udało się pobrać poziomów quizu."
      );
      setMode("idle");
      return;
    }

    if (attemptsResult.error) {
      setError(
        attemptsResult.error.message || "Nie udało się pobrać dzisiejszych prób."
      );
      setMode("idle");
      return;
    }

    const loadedLevels = ((levelsResult.data ?? []) as QuizLevel[]).sort(
      (a, b) => Number(a.sort_order) - Number(b.sort_order)
    );

    const loadedAttempts = ((attemptsResult.data ?? []) as QuizAttempt[]).reduce<
      Record<string, QuizAttempt>
    >((acc, attempt) => {
      acc[attempt.level_slug] = attempt;
      return acc;
    }, {});

    setLevels(loadedLevels);
    setAttempts(loadedAttempts);
    setMode("idle");
  }, [quizDate]);

  useEffect(() => {
    void loadQuizState();
  }, [loadQuizState]);

 useEffect(() => {
    const checkQuizDate = () => {
      const nextDate = todayWarsawYmd();

      setQuizDate((currentDate) => {
        return currentDate === nextDate ? currentDate : nextDate;
      });
    };

    const intervalId = window.setInterval(checkQuizDate, 60_000);

    window.addEventListener("focus", checkQuizDate);
    document.addEventListener("visibilitychange", checkQuizDate);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", checkQuizDate);
      document.removeEventListener("visibilitychange", checkQuizDate);
    };
  }, []);

  const startQuiz = async (level: QuizLevel) => {
    if (startingLevelSlug || submitting || mode === "running") return;

    if (!isLevelUnlocked(level)) {
      const previousLevelName = getPreviousLevelName(level);

      setError(
        previousLevelName
          ? `Ten quiz jest jeszcze zablokowany. Najpierw zalicz bezbłędnie poziom: ${previousLevelName}.`
          : "Ten quiz jest jeszcze zablokowany."
      );

      return;
    }

    setStartingLevelSlug(level.slug);
    setError(null);
    setResult(null);
    setQuestions([]);
    setAnswers({});
    setCurrentIndex(0);
    setTimeLeft(Number(level.time_limit_seconds || DEFAULT_QUESTION_TIME_SECONDS));
    setTimerAnimating(false);
    setActiveLevel(level);
    setActiveAttemptId(null);
    answerLockRef.current = false;

    try {
      const { data, error } = await supabase.rpc("start_daily_quiz", {
        p_level_slug: level.slug,
      });

      if (error) {
        const msg = String(error.message || "");

        if (
          msg.includes("already completed") ||
          msg.includes("Daily quiz for this level already completed")
        ) {
          await loadQuizState();
          return;
        }

        setError(msg || "Nie udało się rozpocząć quizu.");
        setMode("idle");
        return;
      }

      const loadedQuestions = ((data ?? []) as QuizQuestion[]).sort(
        (a, b) => Number(a.question_position) - Number(b.question_position)
      );

      if (loadedQuestions.length !== Number(level.question_count || 5)) {
        setError("Quiz nie ma poprawnej liczby pytań.");
        setMode("idle");
        return;
      }

      const attemptId = Number(loadedQuestions[0]?.attempt_id);

      if (!Number.isFinite(attemptId)) {
        setError("Nie udało się odczytać ID próby quizu.");
        setMode("idle");
        return;
      }

      setActiveAttemptId(attemptId);
      setQuestions(loadedQuestions);
      setMode("running");
    } finally {
      setStartingLevelSlug(null);
    }
  };

  const submitQuiz = useCallback(
    async (finalAnswers: SelectedAnswers) => {
      if (submitting) return;

      if (!activeAttemptId) {
        setError("Brak aktywnej próby quizu.");
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const payload = questions.map((q) => ({
          questionId: q.question_id,
          selectedOption: finalAnswers[q.question_id] ?? null,
        }));

        const { data, error } = await supabase.rpc("submit_daily_quiz", {
          p_attempt_id: activeAttemptId,
          p_answers: payload,
        });

        if (error) {
          const msg = String(error.message || "");

          if (msg.includes("already completed")) {
            await loadQuizState();
            setMode("idle");
            return;
          }

          setError(msg || "Nie udało się zakończyć quizu.");
          return;
        }

        const first = Array.isArray(data) ? data[0] : null;
        const quizResult = first as QuizResult | null;

        setResult(quizResult);
        setMode("completed");

        if (quizResult?.reward_granted) {
          window.dispatchEvent(
            new CustomEvent("vb:refresh-balance", {
              detail: {
                balanceAfter: quizResult.balance_after,
              },
            })
          );
        }

        await loadQuizState();
        setMode("completed");
      } finally {
        setSubmitting(false);
      }
    },
    [activeAttemptId, loadQuizState, questions, submitting]
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
      setTimeLeft(questionTimeSeconds);
      setTimerAnimating(false);

      window.setTimeout(() => {
        answerLockRef.current = false;
      }, 80);
    },
    [
      answers,
      currentIndex,
      currentQuestion,
      mode,
      questionTimeSeconds,
      questions.length,
      submitQuiz,
    ]
  );

  useEffect(() => {
    answerCurrentQuestionRef.current = answerCurrentQuestion;
  }, [answerCurrentQuestion]);

  useEffect(() => {
    if (mode !== "running") return;
    if (!currentQuestion) return;

    answerLockRef.current = false;
    setTimeLeft(questionTimeSeconds);
    setTimerAnimating(false);
    setTimerAnimationKey((value) => value + 1);

    let frameOne: number | null = null;
    let frameTwo: number | null = null;

    frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(() => {
        setTimerAnimating(true);
      });
    });

    const intervalId = window.setInterval(() => {
      setTimeLeft((previous) => {
        if (previous <= 1) return 0;
        return previous - 1;
      });
    }, 1000);

    const timeoutId = window.setTimeout(() => {
      void answerCurrentQuestionRef.current?.(null);
    }, Math.max(questionTimeSeconds, 1) * 1000);

    return () => {
      if (frameOne !== null) window.cancelAnimationFrame(frameOne);
      if (frameTwo !== null) window.cancelAnimationFrame(frameTwo);
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [currentIndex, currentQuestion, mode, questionTimeSeconds]);

  const renderLevelCard = (level: QuizLevel) => {
    const attempt = attempts[level.slug] ?? null;
    const completed = attempt?.status === "completed";
    const wonReward = completed && Boolean(attempt?.reward_granted);
    const lostReward = completed && !Boolean(attempt?.reward_granted);

    const starting = startingLevelSlug === level.slug;
    const accent = getLevelAccent(level.slug);

    const unlocked = isLevelUnlocked(level);
    const previousLevelName = getPreviousLevelName(level);
    const locked = !completed && !unlocked;

    const rewardAmount = toNumber(level.reward_amount, 50);
    const questionCount = Number(level.question_count || 5);
    const timeLimit = Number(level.time_limit_seconds || 10);

    return (
      <div
        key={level.slug}
        className={cn(
          "rounded-3xl border p-5 transition",
          wonReward
            ? "border-green-500/30 bg-green-950/40 shadow-[0_0_36px_rgba(34,197,94,0.10)]"
            : lostReward
              ? "border-red-500/30 bg-red-950/40 shadow-[0_0_36px_rgba(239,68,68,0.10)]"
              : locked
                ? "border-neutral-800 bg-neutral-950/40 opacity-60"
                : "border-neutral-800 bg-neutral-950/70 hover:border-neutral-700"
        )}
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className={cn(
                  "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
                  accent.border,
                  accent.bg,
                  accent.label
                )}
              >
                {level.name}
              </div>

              {wonReward ? (
                <div className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-[11px] font-semibold text-green-300">
                  Ukończony dzisiaj · Nagroda przyznana
                </div>
              ) : lostReward ? (
                <div className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-300">
                  Ukończony dzisiaj · Bez nagrody
                </div>
              ) : locked ? (
                <div className="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-[11px] font-semibold text-neutral-500">
                  Zablokowany
                </div>
              ) : (
                <div className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[11px] font-semibold text-neutral-300">
                  Dostępny
                </div>
              )}
            </div>

            <div className="mt-3 text-xl font-semibold text-white">
              Quiz: {level.name}
            </div>

            <div className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
              {level.description ||
                "Osobny quiz dzienny dla tego poziomu trudności."}
            </div>

            {locked && previousLevelName ? (
              <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-400">
                Odblokujesz ten poziom po bezbłędnym ukończeniu quizu:{" "}
                <span className="font-semibold text-white">
                  {previousLevelName}
                </span>
                .
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-neutral-300">
              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1">
                {questionCount} pytań
              </span>

              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1">
                {timeLimit}s / pytanie
              </span>

              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1">
                Mix: {formatMix(level.mix)}
              </span>

              <span
                className={cn(
                  "rounded-full border px-3 py-1",
                  accent.border,
                  accent.bg,
                  accent.text
                )}
              >
                Nagroda: {rewardAmount.toFixed(0)} VB
              </span>
            </div>

            {completed ? (
              <div className="mt-4 text-sm text-neutral-300">
                Wynik:{" "}
                <span className="font-semibold text-white">
                  {Number(attempt?.score ?? 0)}/
                  {Number(attempt?.total_questions ?? 5)}
                </span>
                {wonReward ? (
                  <>
                    {" "}
                    · Nagroda:{" "}
                    <span className="font-semibold text-green-300">
                      {toNumber(attempt?.reward_amount, 0).toFixed(0)} VB
                    </span>
                  </>
                ) : (
                  <>
                    {" "}
                    ·{" "}
                    <span className="font-semibold text-red-300">
                      Bez nagrody
                    </span>
                  </>
                )}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col gap-2 xl:w-[180px]">
            <button
              type="button"
              onClick={() => void startQuiz(level)}
              disabled={completed || locked || starting || mode === "running"}
              className={cn(
                "rounded-2xl px-5 py-3 text-sm font-semibold transition",
                completed || locked || mode === "running"
                  ? "cursor-not-allowed bg-neutral-800 text-neutral-500"
                  : starting
                    ? "cursor-wait bg-neutral-800 text-neutral-400"
                    : "bg-white text-black hover:bg-neutral-200"
              )}
            >
              {completed
                ? "Zrobiony"
                : locked
                  ? "Zablokowany"
                  : starting
                    ? "Losuję…"
                    : "Rozpocznij"}
            </button>

            {completed ? (
              <div className="text-center text-xs text-neutral-500">
                Dostępny jutro
              </div>
            ) : locked && previousLevelName ? (
              <div className="text-center text-xs text-neutral-500">
                Najpierw zalicz: {previousLevelName}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderLevelList = () => {
    return (
      <div className="p-5 sm:p-6">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xl font-semibold text-white">
                Wybierz quiz dzienny
              </div>

              <p className="mt-2 max-w-3xl text-sm leading-7 text-neutral-400">
                Każdy poziom to osobny quiz. Każdy z nich możesz zrobić tylko raz
                dziennie. Kolejny poziom odblokujesz dopiero po bezbłędnym
                zaliczeniu poprzedniego.
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                Ukończone dzisiaj
              </div>

              <div className="mt-2 text-2xl font-semibold text-white">
                {completedCount}/{levels.length || 5}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {levels.length > 0 ? (
              levels.map((level) => renderLevelCard(level))
            ) : (
              <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-5 text-sm text-neutral-400">
                Brak aktywnych poziomów quizu w bazie.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderRunningScreen = () => {
    if (!currentQuestion || !activeLevel) return null;

    const accent = getLevelAccent(activeLevel.slug);

    return (
      <div className="p-5 sm:p-6">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div
                className={cn(
                  "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
                  accent.border,
                  accent.bg,
                  accent.label
                )}
              >
                Quiz: {activeLevel.name}
              </div>

              <div className="mt-3 text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                Pytanie {currentIndex + 1} z {questions.length}
              </div>

              <div className="mt-2 text-sm text-neutral-400">
                Wybierz odpowiedź. Po kliknięciu przejdziesz dalej.
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
              key={timerAnimationKey}
              className={cn(
                "h-full rounded-full",
                timeLeft <= 3 ? "bg-red-400" : "bg-yellow-300"
              )}
              style={{
                width: timerAnimating ? "0%" : "100%",
                transitionProperty: "width",
                transitionTimingFunction: "linear",
                transitionDuration: timerAnimating
                  ? `${Math.max(questionTimeSeconds, 1)}s`
                  : "0ms",
              }}
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
              <span className="font-semibold text-white">{answeredCount}</span>/
              {questions.length}
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
    const levelName = activeLevel?.name ?? "Quiz";

    return (
      <div className="p-5 sm:p-6">
        <div
          className={cn(
            "rounded-3xl border p-6",
            wonReward
              ? "border-green-500/30 bg-green-950/40 shadow-[0_0_36px_rgba(34,197,94,0.10)]"
              : "border-red-500/30 bg-red-950/40 shadow-[0_0_36px_rgba(239,68,68,0.10)]"
          )}
        >
          <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            Quiz ukończony
          </div>

          <div className="mt-2 text-sm font-semibold text-neutral-300">
            {levelName}
          </div>

          <div className="mt-3 text-3xl font-semibold text-white">
            Wynik: {score}/{total}
          </div>

          <div
            className={cn(
              "mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold",
              wonReward
                ? "border-green-500/30 bg-green-500/10 text-green-300"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            )}
          >
            {wonReward ? "Nagroda przyznana" : "Bez nagrody"}
          </div>

          <div className="mt-3 max-w-2xl text-sm leading-7 text-neutral-300">
            {wonReward ? (
              <>
                Brawo. Wszystkie odpowiedzi są poprawne. Otrzymujesz{" "}
                <span className="font-semibold text-white">
                  {Number(result?.reward_amount ?? 50).toFixed(0)} VB
                </span>
                {typeof result?.balance_after === "number" ? (
                  <>
                    . Nowe saldo:{" "}
                    <span className="font-semibold text-white">
                      {Number(result.balance_after).toFixed(2)} VB
                    </span>
                    .
                  </>
                ) : (
                  "."
                )}
              </>
            ) : (
              <>
                Quiz został ukończony, ale nagroda nie została przyznana. Kolejny
                poziom pozostaje zablokowany, bo do odblokowania trzeba
                odpowiedzieć poprawnie na wszystkie pytania.
              </>
            )}
          </div>

          <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-400">
            Ten poziom quizu jest już dzisiaj zakończony.{" "}
            {wonReward
              ? "Jeśli kolejny poziom nie był jeszcze grany, możesz przejść dalej."
              : "Kolejny poziom odblokujesz dopiero po bezbłędnym zaliczeniu tego poziomu."}
          </div>

          <button
            type="button"
            onClick={() => {
              setMode("idle");
              setResult(null);
              setActiveLevel(null);
              setActiveAttemptId(null);
              setQuestions([]);
              setAnswers({});
              setCurrentIndex(0);
              setTimeLeft(DEFAULT_QUESTION_TIME_SECONDS);
              setTimerAnimating(false);
            }}
            className="mt-5 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-neutral-200"
          >
            Wróć do listy quizów
          </button>
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
                Pięć osobnych quizów dziennych. Każdy poziom możesz ukończyć raz
                dziennie. Odpowiedz bezbłędnie i zgarnij nagrodę VB.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:min-w-[420px]">
              <StatBox
                label="Quizy"
                value={`${completedCount}/${levels.length || 5}`}
              />

              <StatBox label="Czas" value="8–12s" />

              <StatBox
                label="Zdobyto dziś"
                value={`${rewardEarnedToday.toFixed(0)} / ${totalRewardAvailable.toFixed(0)} VB`}
                tone="yellow"
              />
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

              <div className="mt-6 space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-24 rounded-3xl bg-neutral-800" />
                ))}
              </div>
            </div>
          </div>
        ) : mode === "running" ? (
          renderRunningScreen()
        ) : mode === "completed" ? (
          renderCompletedScreen()
        ) : (
          renderLevelList()
        )}
      </section>
    </div>
  );
}