import { env } from '../env.js';
import { logger } from './logger.js';

export interface CriticalErrorContext {
  /** Short, stable label for grouping — e.g. 'notification-worker', 'uncaught-exception'. */
  source: string;
  /** Human-readable summary of what went wrong. */
  message: string;
  err?: unknown;
  /** Any extra structured context (ids, event types, …). */
  detail?: Record<string, unknown>;
}

function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (err == null) return undefined;
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}

/**
 * Reports a critical, operator-actionable failure for an unattended deployment.
 *
 * Always logs at error level with `alert: true` (so a log drain can page on it),
 * and additionally POSTs a compact payload to ALERT_WEBHOOK_URL when configured.
 * Delivery is best-effort and never throws — alerting must not crash the caller.
 */
export async function reportCriticalError(
  context: CriticalErrorContext,
): Promise<void> {
  const payload = {
    alert: true,
    source: context.source,
    message: context.message,
    ...(context.detail ? { detail: context.detail } : {}),
    ...(context.err ? { err: serializeError(context.err) } : {}),
  };

  logger.error(payload, `[ALERT] ${context.source}: ${context.message}`);

  if (!env.ALERT_WEBHOOK_URL) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      await fetch(env.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 [${env.NODE_ENV}] ${context.source}: ${context.message}`,
          ...payload,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.warn({ err }, '[ALERT] failed to deliver alert webhook (non-fatal)');
  }
}
