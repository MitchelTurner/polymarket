import test from "node:test";
import assert from "node:assert/strict";
import {
  foldedKey, normalizeChain, aliasHypotheses, extractFeatures,
  scoreRule, blendProbabilities, backtestMetrics,
} from "../src/index.js";

const near = (a, b, epsilon = 1e-12) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test("foldedKey decomposes accents and case-folds without changing punctuation or spaces", () => {
  assert.equal(foldedKey(" ÉLODIE,  D’Angelo! "), " elodie,  d’angelo! ");
  assert.equal(foldedKey("Cafe\u0301"), foldedKey("CAFÉ"));
  assert.equal(foldedKey("Straße Σς"), "strasse σσ");
  assert.equal(foldedKey("Ꭰ"), foldedKey("ꭰ"));
  assert.equal(foldedKey("ᲀ"), foldedKey("в"));
  assert.notEqual(foldedKey("a-b"), foldedKey("a b"));
  assert.throws(() => foldedKey(null), TypeError);
});

test("batch chain rescales using means and rejects tiny or invalid anchors", () => {
  assert.deepEqual(normalizeChain([0, 10, 50], 20, 10), [0, 20, 100]);
  assert.deepEqual(normalizeChain([10], 20, 2), [100]);
  assert.throws(() => normalizeChain([10], 20, 1.99), /at least 2/);
  assert.throws(() => normalizeChain([NaN], 20, 10), RangeError);
  assert.throws(() => normalizeChain([10], Infinity, 10), RangeError);
  assert.throws(() => normalizeChain([Number.MAX_VALUE], 20, 2), RangeError);
});

test("H1 picks d4vd over Pope even though Leo aliases total more", () => {
  const d4vd = aliasHypotheses([
    { name: "d4vd", previous: [1, 1], current: [9, 9] },
  ]);
  const pope = aliasHypotheses([
    { name: "Pope Leo", previous: [1, 1], current: [5, 5] },
    { name: "Pope Léo", previous: [1, 1], current: [5, 5] },
    { name: "Leo", previous: [1, 1], current: [3, 3] },
  ]);
  assert.equal(d4vd.H1.features.absIncrease, 16);
  assert.equal(pope.H1.features.absIncrease, 8);
  assert.equal(pope.H2.features.absIncrease, 16);
  assert.equal(pope.H3.features.absIncrease, 20);
  assert.ok(d4vd.H1.features.absIncrease > pope.H1.features.absIncrease);
  assert.ok(pope.H3.features.absIncrease > d4vd.H1.features.absIncrease);
});

test("H2 sums only aliases with equal folded keys; H3 includes ambiguous aliases", () => {
  const rows = [
    { name: "Léo", previous: [1], current: [5] },
    { name: "LEO", previous: [1], current: [6] },
    { name: "Leo!", previous: [0], current: [8] },
    { name: "LEO", previous: [0], current: [100], ambiguous: true },
  ];
  const result = aliasHypotheses(rows);
  assert.deepEqual(result.H1.names, ["Leo!"]);
  assert.deepEqual(result.H2.names, ["Léo", "LEO"]);
  assert.equal(result.H2.features.absIncrease, 9);
  assert.equal(result.H3.features.absIncrease, 117);
  assert.deepEqual(aliasHypotheses([]), { H1: null, H2: null, H3: null });
  const onlyAmbiguous = aliasHypotheses([rows[3]]);
  assert.equal(onlyAmbiguous.H1, null);
  assert.equal(onlyAmbiguous.H2, null);
  assert.throws(() => aliasHypotheses([rows[0], { name: "x", previous: [1, 2], current: [3] }]), RangeError);
});

test("weekly features and all seven rules have their specified formulas", () => {
  const f = extractFeatures([1, 3], [0, 6, 12, 8]);
  assert.deepEqual(f, {
    prevSum: 4, curSum: 26, absIncrease: 22, ratio: 26 / 4.25,
    peakWeek: 12, peakAboveBaseline: 10, top8Mean: 6.5, prevMean: 2,
    weeksAbove5: 3, weeksAbove10: 1, spikeRecency: 1,
  });
  assert.equal(scoreRule("R1", f), 22);
  assert.equal(scoreRule("R2", f), 26 / 4.25);
  assert.equal(scoreRule("R3", f), 12);
  assert.equal(scoreRule("R4", f), 10);
  assert.equal(scoreRule("R5", f), 4.5);
  near(scoreRule("R6", f), 22 * Math.log(26 / 4.25));
  assert.equal(scoreRule("R7", f, { intercept: 3, coefficients: { absIncrease: 2, ratio: -1 } }), 47 - 26 / 4.25);
  assert.throws(() => scoreRule("R7", f), /fitted coefficients/);
  assert.throws(() => scoreRule("R7", f, { intercept: 0, coefficients: {} }), RangeError);
  assert.throws(() => scoreRule("R7", f, { intercept: 0, coefficients: { typo: 1 } }), RangeError);
  assert.equal(scoreRule("R6", extractFeatures([1], [0])), null);
  assert.equal(extractFeatures([1], [10, 12, 12]).spikeRecency, 0);
  assert.equal(extractFeatures([1], Array.from({ length: 10 }, (_, i) => i)).top8Mean, 5.5);
  assert.throws(() => extractFeatures([], [1]), RangeError);
});

test("probability blending ignores missing entries and is stable with large weights", () => {
  near(blendProbabilities([{ probability: 0.2 }, { probability: 0.8, weight: 3 }]), 0.65);
  near(blendProbabilities([{ probability: 0, weight: Number.MAX_VALUE }, { probability: 1, weight: Number.MAX_VALUE }]), 0.5);
  assert.equal(blendProbabilities([{ probability: null }], { fallback: 0.4 }), 0.4);
  assert.throws(() => blendProbabilities([{ probability: NaN }]), RangeError);
  assert.throws(() => blendProbabilities([{ probability: 0.5, weight: -1 }]), RangeError);
});

test("backtest ranking, top-5 Spearman and multiclass log-loss", () => {
  const a = { candidates: [
    { score: 2, actualRank: 1, probability: 0.8 },
    { score: 1, actualRank: 2, probability: 0.2 },
  ] };
  const b = { candidates: [
    { score: 3, actualRank: 2, probability: 0.6 },
    { score: 2, actualRank: 1, probability: 0.3 },
    { score: 1, actualRank: 3, probability: 0.1 },
  ] };
  const result = backtestMetrics([a, b]);
  assert.equal(result.hitAt1, 0.5);
  assert.equal(result.hitAt3, 1);
  assert.equal(result.mrr, 0.75);
  near(result.spearmanTop5, 0.75);
  near(result.logLoss, (-Math.log(0.8) - Math.log(0.3)) / 2);
  assert.equal(result.logLossCount, 2);
  assert.equal(backtestMetrics([]).hitAt1, null);
  assert.equal(backtestMetrics([{ candidates: [{ score: 1, actualRank: 1 }] }]).spearmanTop5, null);
  assert.throws(() => backtestMetrics([{ candidates: [{ score: 1, actualRank: 1, probability: 0.5 }] }]), /sum to 1/);
  assert.throws(() => backtestMetrics([{ candidates: [{ score: 1, actualRank: 1 }, { score: 0, actualRank: 1 }] }]), /unique/);
});
