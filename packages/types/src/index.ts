export type Role = 'diner' | 'owner' | 'admin';

export type Plan = 'STARTER' | 'PRO' | 'PREMIUM';

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAUSED'
  | 'PAST_DUE'
  | 'CANCELLED'
  | 'EXPIRED';

export interface PlanLimits {
  restaurants: number;
  bookingsPerMonth: number;
}

export interface Subscription {
  id: string | null;
  userId: string;
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  lemonSqueezyId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface JWTPayload {
  sub: string;       // user_id
  role: Role;
  jti: string;
  iat: number;
  exp: number;
}

export interface Booking {
  id: string;
  restaurantId: string;
  dinerId: string;
  slotId: string;
  partySize: number;
  status: 'pending' | 'confirmed' | 'cancelled';
  createdAt: string;
}

export interface TimeSlot {
  id: string;
  startsAt: string;   // ISO 8601
  capacity: number;
  booked: number;
}

export interface Restaurant {
  id: string;
  ownerId: string;
  name: string;
  cuisine: string;
  description: string;
  address: string;
  imageUrl?: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
}
