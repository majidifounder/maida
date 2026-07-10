import { Resend } from 'resend';
import { env } from '../env.js';
import { notifyOnce } from '../lib/notify-once.js';

const resend = new Resend(env.RESEND_API_KEY);

export interface ReservationEmailData {
  dinerEmail: string | null; // null for staff-created walk-ins without an account
  ownerEmail: string;
  restaurantName: string;
  startsAt: string;
  partySize: number;
  reservationId: string;
  restaurantTimezone: string; // IANA tz — emails must show the restaurant's local time
}

/** @deprecated Use ReservationEmailData */
export type BookingEmailData = ReservationEmailData & {
  slotStartsAt?: string;
  bookingId?: string;
};

/**
 * Formats a reservation instant in the RESTAURANT's local timezone with an
 * explicit offset label. Never format reservation times in the server's tz —
 * that shows diners the wrong hour.
 */
function fmtTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  });
}

function reservationRef(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

async function sendEmail(
  options: Parameters<typeof resend.emails.send>[0],
): Promise<void> {
  const { error } = await resend.emails.send(options);
  if (error) throw new Error(error.message);
}

export async function sendReservationCreated(
  data: ReservationEmailData,
): Promise<void> {
  const time = fmtTime(data.startsAt, data.restaurantTimezone);
  const ref = reservationRef(data.reservationId);
  const dinerEmail = data.dinerEmail;

  if (dinerEmail) {
    await notifyOnce(`${data.reservationId}:created:diner`, () =>
      sendEmail({
        from: env.EMAIL_FROM,
        to: dinerEmail,
        subject: `Reservation confirmed — ${data.restaurantName}`,
        html: `
        <h2>Your reservation is confirmed!</h2>
        <p><strong>Restaurant:</strong> ${data.restaurantName}</p>
        <p><strong>Date &amp; time:</strong> ${time}</p>
        <p><strong>Party size:</strong> ${data.partySize}</p>
        <p style="color:#6b7280;font-size:13px">Reference: ${ref}</p>
        <p>We look forward to seeing you!</p>
      `,
      }),
    );
  }

  await notifyOnce(`${data.reservationId}:created:owner`, () =>
    sendEmail({
      from: env.EMAIL_FROM,
      to: data.ownerEmail,
      subject: `New reservation — ${data.restaurantName}`,
      html: `
        <h2>New reservation</h2>
        <p><strong>Date &amp; time:</strong> ${time}</p>
        <p><strong>Party size:</strong> ${data.partySize}</p>
        <p style="color:#6b7280;font-size:13px">Reference: ${ref}</p>
        <p>Log in to your dashboard to manage this reservation.</p>
      `,
    }),
  );
}

export async function sendReservationSeated(
  data: ReservationEmailData,
): Promise<void> {
  const time = fmtTime(data.startsAt, data.restaurantTimezone);
  const dinerEmail = data.dinerEmail;
  if (!dinerEmail) return;

  await notifyOnce(`${data.reservationId}:seated:diner`, () =>
    sendEmail({
      from: env.EMAIL_FROM,
      to: dinerEmail,
      subject: `You're seated — ${data.restaurantName}`,
      html: `
        <h2>Welcome!</h2>
        <p>Your party has been seated at ${data.restaurantName}.</p>
        <p><strong>Reservation time:</strong> ${time}</p>
        <p><strong>Party size:</strong> ${data.partySize}</p>
      `,
    }),
  );
}

export async function sendReservationCancelledByDiner(
  data: ReservationEmailData,
): Promise<void> {
  const time = fmtTime(data.startsAt, data.restaurantTimezone);
  const ref = reservationRef(data.reservationId);
  const dinerEmail = data.dinerEmail;

  if (dinerEmail) {
    await notifyOnce(`${data.reservationId}:cancelled-by-diner:diner`, () =>
      sendEmail({
        from: env.EMAIL_FROM,
        to: dinerEmail,
        subject: `Reservation cancelled — ${data.restaurantName}`,
        html: `
        <h2>Reservation cancelled</h2>
        <p>Your cancellation has been processed.</p>
        <p><strong>Restaurant:</strong> ${data.restaurantName}</p>
        <p><strong>Original time:</strong> ${time}</p>
        <p style="color:#6b7280;font-size:13px">Reference: ${ref}</p>
      `,
      }),
    );
  }

  await notifyOnce(`${data.reservationId}:cancelled-by-diner:owner`, () =>
    sendEmail({
      from: env.EMAIL_FROM,
      to: data.ownerEmail,
      subject: `Reservation cancelled by guest — ${data.restaurantName}`,
      html: `
        <h2>A guest has cancelled their reservation</h2>
        <p><strong>Original time:</strong> ${time}</p>
        <p><strong>Party size:</strong> ${data.partySize}</p>
        <p style="color:#6b7280;font-size:13px">Reference: ${ref}</p>
        <p>The table has been automatically freed.</p>
      `,
    }),
  );
}

export async function sendReservationCancelledByOwner(
  data: ReservationEmailData,
): Promise<void> {
  const time = fmtTime(data.startsAt, data.restaurantTimezone);
  const dinerEmail = data.dinerEmail;
  if (!dinerEmail) return;

  await notifyOnce(`${data.reservationId}:cancelled-by-owner:diner`, () =>
    sendEmail({
      from: env.EMAIL_FROM,
      to: dinerEmail,
      subject: `Your reservation at ${data.restaurantName} has been cancelled`,
      html: `
        <h2>Reservation cancelled by restaurant</h2>
        <p>We're sorry — the restaurant has had to cancel your reservation.</p>
        <p><strong>Restaurant:</strong> ${data.restaurantName}</p>
        <p><strong>Original time:</strong> ${time}</p>
      `,
    }),
  );
}

/** @deprecated Use sendReservationCreated */
export async function sendBookingCreated(
  data: BookingEmailData,
): Promise<void> {
  return sendReservationCreated({
    ...data,
    startsAt: data.startsAt ?? data.slotStartsAt!,
    reservationId: data.reservationId ?? data.bookingId!,
  });
}

/** @deprecated Use sendReservationSeated */
export const sendBookingConfirmed = sendReservationSeated;

/** @deprecated Use sendReservationCancelledByDiner */
export const sendBookingCancelledByDiner = sendReservationCancelledByDiner;

/** @deprecated Use sendReservationCancelledByOwner */
export const sendBookingCancelledByOwner = sendReservationCancelledByOwner;

export async function sendPasswordReset(opts: {
  toEmail: string;
  resetUrl: string;
}): Promise<void> {
  await sendEmail({
    from: env.EMAIL_FROM,
    to: opts.toEmail,
    subject: 'Reset your password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="font-size:20px;margin-bottom:8px">Reset your password</h2>
        <p style="color:#555;margin-bottom:24px">
          We received a request to reset the password for your account.
          Click the button below — this link expires in <strong>1 hour</strong>.
        </p>
        <a href="${opts.resetUrl}"
           style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;
                  padding:12px 24px;border-radius:6px;font-weight:600">
          Reset password
        </a>
        <p style="color:#888;font-size:13px;margin-top:24px">
          If you didn't request this, you can safely ignore this email.
          Your password will not be changed.
        </p>
        <p style="color:#bbb;font-size:12px;margin-top:8px">
          Link not working? Copy and paste into your browser:<br/>
          <span style="word-break:break-all">${opts.resetUrl}</span>
        </p>
      </div>
    `,
    text: `Reset your password\n\nClick this link to reset your password (expires in 1 hour):\n${opts.resetUrl}\n\nIf you didn't request this, ignore this email.`,
  });
}
