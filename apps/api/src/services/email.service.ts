import { Resend } from 'resend';
import { env } from '../env.js';
import { notifyOnce } from '../lib/notify-once.js';

const resend = new Resend(env.RESEND_API_KEY);

export interface BookingEmailData {
  dinerEmail: string;
  ownerEmail: string;
  restaurantName: string;
  slotStartsAt: string;
  partySize: number;
  bookingId: string;
}

function fmtSlot(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function bookingRef(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

async function sendEmail(
  options: Parameters<typeof resend.emails.send>[0],
): Promise<void> {
  const { error } = await resend.emails.send(options);
  if (error) throw new Error(error.message);
}

export async function sendBookingCreated(data: BookingEmailData): Promise<void> {
  const slot = fmtSlot(data.slotStartsAt);
  const ref = bookingRef(data.bookingId);

  await notifyOnce(`${data.bookingId}:created:diner`, () =>
    sendEmail({
      from: env.EMAIL_FROM,
      to: data.dinerEmail,
      subject: `Booking received — ${data.restaurantName}`,
      html: `
        <h2>Your booking request is received!</h2>
        <p><strong>Restaurant:</strong> ${data.restaurantName}</p>
        <p><strong>Date &amp; time:</strong> ${slot}</p>
        <p><strong>Party size:</strong> ${data.partySize}</p>
        <p><strong>Status:</strong> Pending owner confirmation</p>
        <p style="color:#6b7280;font-size:13px">Reference: ${ref}</p>
        <p>We'll email you once the restaurant confirms your reservation.</p>
      `,
    }),
  );

  await notifyOnce(`${data.bookingId}:created:owner`, () =>
    sendEmail({
      from: env.EMAIL_FROM,
      to: data.ownerEmail,
      subject: `New booking request — ${data.restaurantName}`,
      html: `
        <h2>New booking request</h2>
        <p><strong>Date &amp; time:</strong> ${slot}</p>
        <p><strong>Party size:</strong> ${data.partySize}</p>
        <p style="color:#6b7280;font-size:13px">Reference: ${ref}</p>
        <p>Log in to your dashboard to <strong>confirm</strong> or <strong>cancel</strong> this booking.</p>
      `,
    }),
  );
}

export async function sendBookingConfirmed(
  data: BookingEmailData,
): Promise<void> {
  const slot = fmtSlot(data.slotStartsAt);

  await notifyOnce(`${data.bookingId}:confirmed:diner`, () =>
    sendEmail({
      from: env.EMAIL_FROM,
      to: data.dinerEmail,
      subject: `Booking confirmed — ${data.restaurantName} ✓`,
      html: `
        <h2>Your booking is confirmed!</h2>
        <p>The restaurant has confirmed your reservation.</p>
        <p><strong>Restaurant:</strong> ${data.restaurantName}</p>
        <p><strong>Date &amp; time:</strong> ${slot}</p>
        <p><strong>Party size:</strong> ${data.partySize}</p>
        <p>See you there!</p>
      `,
    }),
  );
}

export async function sendBookingCancelledByDiner(
  data: BookingEmailData,
): Promise<void> {
  const slot = fmtSlot(data.slotStartsAt);
  const ref = bookingRef(data.bookingId);

  await notifyOnce(`${data.bookingId}:cancelled-by-diner:diner`, () =>
    sendEmail({
      from: env.EMAIL_FROM,
      to: data.dinerEmail,
      subject: `Booking cancelled — ${data.restaurantName}`,
      html: `
        <h2>Booking cancelled</h2>
        <p>Your cancellation has been processed.</p>
        <p><strong>Restaurant:</strong> ${data.restaurantName}</p>
        <p><strong>Original time:</strong> ${slot}</p>
        <p style="color:#6b7280;font-size:13px">Reference: ${ref}</p>
        <p>We hope to see you again soon.</p>
      `,
    }),
  );

  await notifyOnce(`${data.bookingId}:cancelled-by-diner:owner`, () =>
    sendEmail({
      from: env.EMAIL_FROM,
      to: data.ownerEmail,
      subject: `Booking cancelled by guest — ${data.restaurantName}`,
      html: `
        <h2>A guest has cancelled their booking</h2>
        <p><strong>Original time:</strong> ${slot}</p>
        <p><strong>Party size:</strong> ${data.partySize}</p>
        <p style="color:#6b7280;font-size:13px">Reference: ${ref}</p>
        <p>The seat capacity has been automatically restored.</p>
      `,
    }),
  );
}

export async function sendBookingCancelledByOwner(
  data: BookingEmailData,
): Promise<void> {
  const slot = fmtSlot(data.slotStartsAt);

  await notifyOnce(`${data.bookingId}:cancelled-by-owner:diner`, () =>
    sendEmail({
      from: env.EMAIL_FROM,
      to: data.dinerEmail,
      subject: `Your booking at ${data.restaurantName} has been cancelled`,
      html: `
        <h2>Booking cancelled by restaurant</h2>
        <p>We're sorry — the restaurant has had to cancel your reservation.</p>
        <p><strong>Restaurant:</strong> ${data.restaurantName}</p>
        <p><strong>Original time:</strong> ${slot}</p>
        <p>Please contact the restaurant directly or make a new reservation.</p>
      `,
    }),
  );
}

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
