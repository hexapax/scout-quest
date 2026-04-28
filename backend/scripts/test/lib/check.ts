/**
 * Tiny PASS/FAIL helper, modeled on scripts/verify-role-lookup.ts. No
 * test framework dependency — keeps this harness self-contained until
 * the backend gains a real test runner.
 */

export interface CheckContext {
  failures: number;
  scenario: string;
}

export function makeChecker(scenario: string): {
  check: (name: string, cond: boolean, detail?: unknown) => void;
  result: () => CheckContext;
} {
  const ctx: CheckContext = { failures: 0, scenario };
  return {
    check(name: string, cond: boolean, detail?: unknown) {
      const mark = cond ? "PASS" : "FAIL";
      console.log(`    ${mark}: ${name}`);
      if (!cond) {
        ctx.failures++;
        if (detail !== undefined) {
          const text = typeof detail === "string" ? detail : JSON.stringify(detail);
          console.log(`      detail: ${text.slice(0, 400)}`);
        }
      }
    },
    result: () => ctx,
  };
}
