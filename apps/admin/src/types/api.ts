import type { Plan } from '@restaurant/types';

export type { Plan };

export type DbRole = 'DINER' | 'OWNER' | 'ADMIN';

export interface AdminUser {
  id: string;
  email: string;
  role: string; // 'admin' for admin accounts; the API guards role server-side
}

export interface LoginSuccessResponse {
  accessToken: string;
  accessTokenExpiresAt: number;
  user: AdminUser;
}

export interface LoginTotpSetupResponse {
  requiresTOTPSetup: true;
  qrCodeDataUrl: string;
  pendingToken: string;
}

export interface LoginTotpVerifyResponse {
  requiresTOTP: true;
}

export type LoginResponse =
  | LoginSuccessResponse
  | LoginTotpSetupResponse
  | LoginTotpVerifyResponse;

export function isLoginSuccess(r: LoginResponse): r is LoginSuccessResponse {
  return 'accessToken' in r;
}

export function isTotpSetup(r: LoginResponse): r is LoginTotpSetupResponse {
  return 'requiresTOTPSetup' in r;
}

export function isTotpVerify(r: LoginResponse): r is LoginTotpVerifyResponse {
  return 'requiresTOTP' in r;
}

export interface AdminStats {
  users: { total: number; diners: number; owners: number };
  restaurants: { total: number };
  reservations: { total: number; thisMonth: number };
  subscriptions: { starter: number; pro: number; premium: number };
}

export interface AdminUserListItem {
  id: string;
  email: string;
  role: DbRole;
  createdAt: string;
  deletedAt: string | null;
  subscription?: { plan: Plan; status: string; currentPeriodEnd: string | null } | null;
  _count?: { restaurants: number };
}

export interface AdminUserDetail extends AdminUserListItem {
  restaurants: {
    id: string;
    name: string;
    city: string;
    isActive: boolean;
    createdAt: string;
  }[];
}

export interface AdminRestaurant {
  id: string;
  name: string;
  city: string;
  cuisine: string;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  owner: { id: string; email: string };
  _count: { reservations: number; tables: number };
}

export interface AdminReservation {
  id: string;
  partySize: number;
  status: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  restaurant: { id: string; name: string };
  diner: { id: string; email: string } | null;
}

/** @deprecated Use AdminReservation */
export type AdminBooking = AdminReservation & { slot?: { startsAt: string } };

export interface AdminSubscription {
  id: string;
  plan: Plan;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lemonSqueezyId: string | null;
  createdAt: string;
  user: { id: string; email: string };
}

export interface AdminAuditLog {
  id: string;
  actorId: string | null;
  actorRole: DbRole | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface PaginatedUsers {
  users: AdminUserListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface PaginatedRestaurants {
  restaurants: AdminRestaurant[];
  total: number;
  page: number;
  limit: number;
}

export interface PaginatedReservations {
  reservations: AdminReservation[];
  total: number;
  page: number;
  limit: number;
}

/** @deprecated Use PaginatedReservations */
export type PaginatedBookings = PaginatedReservations & {
  bookings?: AdminReservation[];
};

export interface PaginatedSubscriptions {
  subscriptions: AdminSubscription[];
  total: number;
  page: number;
  limit: number;
}

export interface PaginatedAuditLogs {
  logs: AdminAuditLog[];
  total: number;
  page: number;
  limit: number;
}
