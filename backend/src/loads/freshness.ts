export const FRESH_WINDOW_HOURS = 72;
export const MIN_OBS = 4;        // минимум наблюдений для инференса «ушёл»
export const GONE_FACTOR = 4;    // не виден > GONE_FACTOR×каденс ⇒ likelyGone

export interface LivenessInput {
  firstSeen: Date | string;
  lastSeen: Date | string;
  seenCount?: number | null;
}

export interface Liveness {
  liveness: number;   // 0..1, линейный decay по давности
  likelyGone: boolean;
}

// Свежесть груза по снимкам чужих сессий: recency-decay + (для часто виденных) каденс-инференс.
export function computeLiveness(row: LivenessInput, now: Date): Liveness {
  const lastSeenMs = new Date(row.lastSeen).getTime();
  const ageMs = now.getTime() - lastSeenMs;
  const ageH = ageMs / 3_600_000;
  const liveness = clamp01(1 - ageH / FRESH_WINDOW_HOURS);

  let likelyGone = false;
  const seen = row.seenCount ?? 1;
  if (seen >= MIN_OBS) {
    const spanMs = lastSeenMs - new Date(row.firstSeen).getTime();
    const cadenceMs = spanMs / Math.max(1, seen - 1);
    if (cadenceMs > 0 && ageMs > GONE_FACTOR * cadenceMs) likelyGone = true;
  }
  // round2 — для отображения/хранения, не для дальнейших вычислений.
  return { liveness: round2(liveness), likelyGone };
}

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
function round2(x: number): number { return Math.round(x * 100) / 100; }
