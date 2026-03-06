// lib/format.ts
export const formatVB = (value: number | null | undefined) => {
  if (value == null) return "...";
  const n = Number(value);
  if (!Number.isFinite(n)) return "...";

  return new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
};

// (opcjonalnie) kursy też 2 miejsca, ale bez separatorów tysięcy:
export const formatOdd = (value: number | null | undefined) => {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toFixed(2);
};