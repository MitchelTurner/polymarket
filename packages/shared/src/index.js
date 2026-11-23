const CYRILLIC_FOLDS = {
  "\u1c80": "\u0432", "\u1c81": "\u0434", "\u1c82": "\u043e",
  "\u1c83": "\u0441", "\u1c84": "\u0442", "\u1c85": "\u0442",
  "\u1c86": "\u044a", "\u1c87": "\u0463", "\u1c88": "\ua64b",
};

/** NFKD, remove combining marks, then Unicode default case folding. */
export function foldedKey(text) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[ßς\u1c80-\u1c88\u13f8-\u13fd\uab70-\uabbf]/gu, (char) => {
      if (char === "ß") return "ss";
      if (char === "ς") return "σ";
      return CYRILLIC_FOLDS[char] ?? char.toUpperCase();
    });
}

function nonnegative(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and nonnegative`);
  }
  return value;
}

function finite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
  return value;
}

function sum(values, name) {
  const result = values.reduce((total, x) => total + nonnegative(x, name), 0);
  return finite(result, `${name} sum`);
}

/**
 * Normalize a batch against a common anchor. The input values and both means
 * must be on the same Trends scale; callers determine anchor overlap/means.
 */
export function normalizeChain(values, referenceAnchorMean, batchAnchorMean) {
  if (!Array.isArray(values)) throw new TypeError("values must be an array");
  nonnegative(referenceAnchorMean, "referenceAnchorMean");
  nonnegative(batchAnchorMean, "batchAnchorMean");
  if (batchAnchorMean < 2) throw new RangeError("batch anchor mean must be at least 2");
  return values.map((value) => finite(
    nonnegative(value, "value") * (referenceAnchorMean / batchAnchorMean),
    "normalized value",
  ));
}

/**
 * Previous and current arrays contain oldest-first weekly values.
 * spikeRecency is weeks since the most recent current-period maximum.
 */
export function extractFeatures(previous, current) {
  if (!Array.isArray(previous) || !Array.isArray(current) || !previous.length || !current.length) {
    throw new RangeError("previous and current must be nonempty weekly arrays");
  }
  const prevSum = sum(previous, "previous");
  const curSum = sum(current, "current");
  const prevMean = prevSum / previous.length;
  const peakWeek = current.reduce((max, value) => Math.max(max, value), 0);
  const top8 = [...current].sort((a, b) => b - a).slice(0, 8);
  return {
    prevSum,
    curSum,
    absIncrease: finite(curSum - prevSum, "absIncrease"),
    ratio: finite(curSum / (prevSum + 0.25), "ratio"),
    peakWeek,
    peakAboveBaseline: finite(peakWeek - prevMean, "peakAboveBaseline"),
    top8Mean: sum(top8, "top8") / top8.length,
    prevMean,
    weeksAbove5: current.filter((value) => value > 5).length,
    weeksAbove10: current.filter((value) => value > 10).length,
    spikeRecency: current.length - 1 - current.lastIndexOf(peakWeek),
  };
}

/**
 * Alias rows: {name, previous, current, ambiguous?}. H1 selects the largest
 * individual non-ambiguous increase; H2 first sums same-folded non-ambiguous
 * rows; H3 sums every row. Period arrays must align.
 */
export function aliasHypotheses(aliases) {
  if (!Array.isArray(aliases)) throw new TypeError("aliases must be an array");
  if (!aliases.length) return { H1: null, H2: null, H3: null };
  let prevLength;
  let curLength;
  const groups = new Map();
  let all;
  let h1 = null;
  function add(row, aggregate) {
    if (!aggregate) aggregate = { names: [], previous: Array(prevLength).fill(0), current: Array(curLength).fill(0) };
    aggregate.names.push(row.name);
    for (let i = 0; i < prevLength; i++) aggregate.previous[i] = finite(aggregate.previous[i] + row.previous[i], "previous sum");
    for (let i = 0; i < curLength; i++) aggregate.current[i] = finite(aggregate.current[i] + row.current[i], "current sum");
    return aggregate;
  }
  function candidate(row) {
    return { names: row.names, features: extractFeatures(row.previous, row.current) };
  }
  for (const row of aliases) {
    if (!row || typeof row.name !== "string" ||
        (row.ambiguous !== undefined && typeof row.ambiguous !== "boolean")) {
      throw new TypeError("invalid alias row");
    }
    const features = extractFeatures(row.previous, row.current);
    if (prevLength === undefined) {
      prevLength = row.previous.length;
      curLength = row.current.length;
    }
    if (row.previous.length !== prevLength || row.current.length !== curLength) {
      throw new RangeError("alias periods must have matching lengths");
    }
    all = add(row, all);
    if (!row.ambiguous) {
      const individual = { names: [row.name], features };
      if (!h1 || features.absIncrease > h1.features.absIncrease) h1 = individual;
      const key = foldedKey(row.name);
      groups.set(key, add(row, groups.get(key)));
    }
  }
  let h2 = null;
  for (const group of groups.values()) {
    const item = candidate(group);
    if (!h2 || item.features.absIncrease > h2.features.absIncrease) h2 = item;
  }
  return { H1: h1, H2: h2, H3: candidate(all) };
}

const FEATURE_NAMES = Object.freeze([
  "prevSum", "curSum", "absIncrease", "ratio", "peakWeek",
  "peakAboveBaseline", "top8Mean", "prevMean", "weeksAbove5",
  "weeksAbove10", "spikeRecency",
]);

/** Returns null for undefined R6 at ratio zero; R7 is a supplied linear model. */
export function scoreRule(rule, features, fittedModel) {
  if (!features || typeof features !== "object") throw new TypeError("features must be an object");
  const feature = (name) => finite(features[name], name);
  switch (rule) {
    case "R1": return feature("absIncrease");
    case "R2": return feature("ratio");
    case "R3": return feature("peakWeek");
    case "R4": return feature("peakAboveBaseline");
    case "R5": return finite(feature("top8Mean") - feature("prevMean"), "R5");
    case "R6": {
      const ratio = feature("ratio");
      if (ratio < 0) throw new RangeError("ratio must be nonnegative");
      return ratio === 0 ? null : finite(feature("absIncrease") * Math.log(ratio), "R6");
    }
    case "R7": {
      if (!fittedModel || typeof fittedModel !== "object" || !fittedModel.coefficients ||
          typeof fittedModel.coefficients !== "object" || Array.isArray(fittedModel.coefficients)) {
        throw new TypeError("R7 requires fitted coefficients and an intercept");
      }
      let result = finite(fittedModel.intercept, "intercept");
      const entries = Object.entries(fittedModel.coefficients);
      if (!entries.length) throw new RangeError("R7 requires at least one fitted coefficient");
      for (const [name, coefficient] of entries) {
        if (!FEATURE_NAMES.includes(name)) throw new RangeError(`unknown feature: ${name}`);
        result += finite(coefficient, name) * feature(name);
      }
      return finite(result, "R7");
    }
    default: throw new RangeError(`unknown rule: ${rule}`);
  }
}

/** Blend probabilities for the same binary event, skipping missing estimates. */
export function blendProbabilities(inputs, { fallback = null } = {}) {
  if (!Array.isArray(inputs)) throw new TypeError("inputs must be an array");
  function probability(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError("probability must be in [0, 1]");
    }
    return value;
  }
  if (fallback !== null) probability(fallback);
  const valid = [];
  for (const input of inputs) {
    if (!input || typeof input !== "object") throw new TypeError("invalid input");
    const weight = nonnegative(input.weight ?? 1, "weight");
    if (input.probability != null) {
      const p = probability(input.probability);
      if (weight > 0) valid.push({ p, weight });
    }
  }
  if (!valid.length) return fallback;
  const scale = valid.reduce((max, row) => Math.max(max, row.weight), 0);
  const total = valid.reduce((s, row) => s + row.weight / scale, 0);
  return Math.min(1, Math.max(0, valid.reduce((s, row) => s + row.p * (row.weight / scale) / total, 0)));
}

/**
 * Each event has candidates with score, unique actualRank (1 = winner), and
 * optionally probability for every candidate. Probability vectors sum to one.
 */
export function backtestMetrics(events) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  let hit1 = 0, hit3 = 0, reciprocal = 0, spearmanSum = 0, spearmanCount = 0;
  let loss = 0, lossCount = 0;
  for (const event of events) {
    if (!event || !Array.isArray(event.candidates) || !event.candidates.length) {
      throw new RangeError("each event needs candidates");
    }
    const rows = event.candidates.map((row, index) => {
      if (!row || typeof row !== "object") throw new TypeError("invalid candidate");
      finite(row.score, "score");
      if (!Number.isInteger(row.actualRank) || row.actualRank < 1 || row.actualRank > event.candidates.length) {
        throw new RangeError("actualRank must be between 1 and candidate count");
      }
      return { ...row, index };
    });
    if (new Set(rows.map((row) => row.actualRank)).size !== rows.length) {
      throw new RangeError("actual ranks must be unique");
    }
    rows.sort((a, b) => b.score - a.score || a.index - b.index);
    const winnerRank = rows.findIndex((row) => row.actualRank === 1) + 1;
    hit1 += Number(winnerRank === 1);
    hit3 += Number(winnerRank <= 3);
    reciprocal += 1 / winnerRank;
    const top = rows.map((row, index) => ({ ...row, predictedRank: index + 1 }))
      .filter((row) => row.actualRank <= 5);
    if (top.length >= 2) {
      const meanX = top.reduce((s, row) => s + row.actualRank, 0) / top.length;
      const meanY = top.reduce((s, row) => s + row.predictedRank, 0) / top.length;
      const xy = top.reduce((s, row) => s + (row.actualRank - meanX) * (row.predictedRank - meanY), 0);
      const xx = top.reduce((s, row) => s + (row.actualRank - meanX) ** 2, 0);
      const yy = top.reduce((s, row) => s + (row.predictedRank - meanY) ** 2, 0);
      spearmanSum += xy / Math.sqrt(xx * yy);
      spearmanCount++;
    }
    const hasProbability = rows.some((row) => row.probability != null);
    if (hasProbability) {
      let total = 0;
      for (const row of rows) {
        if (typeof row.probability !== "number" || !Number.isFinite(row.probability) ||
            row.probability < 0 || row.probability > 1) throw new RangeError("all probabilities must be in [0, 1]");
        total += row.probability;
      }
      if (Math.abs(total - 1) > 1e-9) throw new RangeError("probabilities must sum to 1");
      const p = rows.find((row) => row.actualRank === 1).probability;
      loss -= Math.log(Math.max(p, 1e-15));
      lossCount++;
    }
  }
  const count = events.length;
  return {
    count, hitAt1: count ? hit1 / count : null, hitAt3: count ? hit3 / count : null,
    mrr: count ? reciprocal / count : null,
    spearmanTop5: spearmanCount ? spearmanSum / spearmanCount : null,
    logLoss: lossCount ? loss / lossCount : null,
    logLossCount: lossCount,
  };
}
