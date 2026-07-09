export interface TestResult {
  journey: string;
  name: string;
  passed: boolean;
  error?: string;
}

export class Reporter {
  private results: TestResult[] = [];
  private consecutiveUnreachable = 0;

  async test(
    journey: string,
    name: string,
    fn: () => void | Promise<void>,
  ): Promise<void> {
    const started = Date.now();
    process.stdout.write(`  … ${journey} / ${name}`);
    try {
      await fn();
      const ms = Date.now() - started;
      process.stdout.write(`\r  ✓ ${journey} / ${name} (${ms}ms)\n`);
      this.results.push({ journey, name, passed: true });
      this.consecutiveUnreachable = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const ms = Date.now() - started;
      process.stdout.write(`\r  ✗ ${journey} / ${name} (${ms}ms)\n`);
      this.results.push({ journey, name, passed: false, error: message });

      if (message.includes('API unreachable') || message.includes('fetch failed')) {
        this.consecutiveUnreachable += 1;
        if (this.consecutiveUnreachable >= 3) {
          throw new Error(
            'Stopping e2e early: API is unreachable (crashed, restarted, or Redis hung). Keep `pnpm --filter @restaurant/api dev` running and fix REDIS_URL.',
          );
        }
      } else {
        this.consecutiveUnreachable = 0;
      }
    }
  }

  assert(condition: boolean, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  get failed(): TestResult[] {
    return this.results.filter((r) => !r.passed);
  }

  get passed(): TestResult[] {
    return this.results.filter((r) => r.passed);
  }

  printSummary(): boolean {
    const failed = this.failed;
    const passed = this.passed;

    console.log('\n══════════════════════════════════════════════════');
    console.log('  E2E SUITE SUMMARY');
    console.log('══════════════════════════════════════════════════\n');

    const byJourney = new Map<string, TestResult[]>();
    for (const r of this.results) {
      const list = byJourney.get(r.journey) ?? [];
      list.push(r);
      byJourney.set(r.journey, list);
    }

    for (const [journey, tests] of byJourney) {
      const journeyFailed = tests.filter((t) => !t.passed);
      const icon = journeyFailed.length === 0 ? '✅' : '❌';
      console.log(`${icon} ${journey} (${tests.length - journeyFailed.length}/${tests.length})`);
      for (const t of journeyFailed) {
        console.log(`     ✗ ${t.name}`);
        if (t.error) console.log(`       → ${t.error}`);
      }
    }

    console.log('\n──────────────────────────────────────────────────');
    console.log(
      `  Total: ${passed.length} passed, ${failed.length} failed (${this.results.length} assertions)`,
    );
    console.log('──────────────────────────────────────────────────\n');

    return failed.length === 0;
  }
}
