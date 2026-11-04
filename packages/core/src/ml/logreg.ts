/** Logistic regression with batch gradient descent + L2. No ML library. */
export interface LogRegModel {
  weights: number[];
  bias: number;
  means: number[];
  stds: number[];
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function standardize(X: number[][]): { means: number[]; stds: number[] } {
  const d = X[0]?.length ?? 0;
  const means = Array.from({ length: d }, (_, j) => X.reduce((s, r) => s + r[j]!, 0) / X.length);
  const stds = Array.from({ length: d }, (_, j) => {
    const v = X.reduce((s, r) => s + (r[j]! - means[j]!) ** 2, 0) / X.length;
    return Math.sqrt(v) || 1;
  });
  return { means, stds };
}

export function trainLogReg(X: number[][], y: number[], opts: { lr?: number; epochs?: number; l2?: number } = {}): LogRegModel {
  const lr = opts.lr ?? 0.3;
  const epochs = opts.epochs ?? 1500;
  const l2 = opts.l2 ?? 0.01;
  const { means, stds } = standardize(X);
  const Z = X.map((r) => r.map((v, j) => (v - means[j]!) / stds[j]!));
  const d = means.length;
  const w = new Array<number>(d).fill(0);
  let b = 0;
  const n = Z.length;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(Z[i]!.reduce((s, v, j) => s + v * w[j]!, b));
      const err = p - y[i]!;
      for (let j = 0; j < d; j++) gw[j]! += err * Z[i]![j]!;
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] = w[j]! - lr * (gw[j]! / n + l2 * w[j]!);
    b -= (lr * gb) / n;
  }
  return { weights: w, bias: b, means, stds };
}

export function predictProba(m: LogRegModel, x: number[]): number {
  return sigmoid(x.reduce((s, v, j) => s + ((v - m.means[j]!) / m.stds[j]!) * m.weights[j]!, m.bias));
}

export interface Metrics {
  precision: number;
  recall: number;
  accuracy: number;
  f1: number;
  support: { train: number; test: number; positivesTest: number };
  confusion: { tp: number; fp: number; tn: number; fn: number };
}

export function evaluate(m: LogRegModel, X: number[][], y: number[], threshold = 0.5): Omit<Metrics, "support"> {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  X.forEach((x, i) => {
    const pred = predictProba(m, x) >= threshold ? 1 : 0;
    if (pred === 1 && y[i] === 1) tp++;
    else if (pred === 1) fp++;
    else if (y[i] === 1) fn++;
    else tn++;
  });
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return {
    precision,
    recall,
    accuracy: X.length ? (tp + tn) / X.length : 0,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    confusion: { tp, fp, tn, fn },
  };
}
