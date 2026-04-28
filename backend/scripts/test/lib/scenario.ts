/**
 * Scenario contract. Every scenario file under scripts/test/scenarios/ exports
 * a `scenario` constant matching this shape. The runner imports them
 * dynamically AFTER environment setup so backend-module imports inside the
 * scenario reach the isolated test DB.
 */

export interface ScenarioContext {
  /** Already-created and selected isolated test DB. */
  dbName: string;
  /** PASS/FAIL helper bound to this scenario's name. */
  check: (name: string, cond: boolean, detail?: unknown) => void;
}

export interface Scenario {
  name: string;
  /** One-line summary printed before the run. */
  description: string;
  /** Whether this scenario calls Anthropic — runner can skip when ANTHROPIC_API_KEY unset. */
  callsLLM?: boolean;
  /** Seed fixtures (writes to the isolated DB). */
  seed: (ctx: ScenarioContext) => Promise<void>;
  /** Execute assertions. */
  run: (ctx: ScenarioContext) => Promise<void>;
}
