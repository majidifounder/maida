import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture what would be sent to Resend without any network/Redis/DB.
const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ data: { id: 'msg_1' }, error: null }),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
    constructor(_key?: string) {}
  },
}));

// notifyOnce normally claims a Redis idempotency key; make it a passthrough so
// this stays a pure unit test.
vi.mock('../lib/notify-once.js', () => ({
  notifyOnce: (_key: string, fn: () => Promise<void>) => fn(),
}));

const { sendReservationCreated, sendReservationReminder } = await import(
  '../services/email.service.js'
);
import type { ReservationEmailData } from '../services/email.service.js';

const XSS_NAME = '<img src=x onerror=alert(1)>';

function baseData(
  overrides: Partial<ReservationEmailData> = {},
): ReservationEmailData {
  return {
    dinerEmail: 'diner@example.com',
    ownerEmail: 'owner@example.com',
    restaurantName: XSS_NAME,
    startsAt: new Date('2026-08-01T18:00:00Z').toISOString(),
    endsAt: new Date('2026-08-01T20:00:00Z').toISOString(),
    partySize: 2,
    reservationId: 'abcd1234-0000-0000-0000-000000000000',
    restaurantTimezone: 'UTC',
    ...overrides,
  };
}

function dinerHtml(): string {
  const call = sendMock.mock.calls.find(
    ([o]) => (o as { to?: string }).to === 'diner@example.com',
  );
  if (!call) throw new Error('no diner email captured');
  return (call[0] as { html: string }).html;
}

describe('email HTML injection hardening', () => {
  beforeEach(() => sendMock.mockClear());

  it('escapes an owner-controlled restaurant name in the diner confirmation', async () => {
    await sendReservationCreated(baseData());
    const html = dinerHtml();
    expect(html).not.toContain('<img src=x onerror=');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes owner-controlled address/city in the reminder email', async () => {
    await sendReservationReminder(
      baseData({
        restaurantName: 'Fine',
        restaurantAddress: '<b>evil</b>',
        restaurantCity: 'Town',
      }),
    );
    const html = dinerHtml();
    expect(html).not.toContain('<b>evil</b>');
    expect(html).toContain('&lt;b&gt;evil&lt;/b&gt;');
  });
});
