import { expect } from "vitest";
import { formatProblem } from "../src/report.js";

/**
 * Assert nothing matched, printing a full report when something did.
 *
 * The report goes to stderr rather than into the assertion message for two
 * reasons: the runner strips ANSI from assertion messages, and it renders long
 * messages inside a diff view that mangles the layout. Keeping the assertion
 * line to one sentence leaves the readable version intact above it.
 *
 * @param {number} count
 * @param {Parameters<typeof formatProblem>[0]} problem
 */
export function expectNone(count, problem) {
  if (count > 0) process.stderr.write(formatProblem(problem));
  expect(
    count,
    `${problem.title}: ${count} found — see the report above`,
  ).toBe(0);
}

/**
 * Assert a count stays within a ceiling, printing a full report when it does
 * not. Reserved for measurements that move on their own, where there is no
 * stable instance to record in the known-issues file.
 *
 * @param {number} count
 * @param {number} budget
 * @param {Parameters<typeof formatProblem>[0]} problem
 */
export function expectWithinBudget(count, budget, problem) {
  if (count > budget) process.stderr.write(formatProblem(problem));
  expect(
    count,
    `${problem.title}: ${count} found, ceiling ${budget} — see the report above`,
  ).toBeLessThanOrEqual(budget);
}
