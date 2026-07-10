export type Role = 'diner' | 'owner' | 'admin';

export type Plan = 'STARTER' | 'PRO' | 'PREMIUM';

/** Effective tier for limits and UI — trial is distinct from paid STARTER. */
export type BillingTier = 'TRIAL' | Plan;

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAUSED'
  | 'PAST_DUE'
  | 'CANCELLED'
  | 'EXPIRED';

export interface PlanLimits {
  restaurants: number;
  reservationsPerMonth: number;
  tablesPerRestaurant: number;
  combinationsPerRestaurant: number;
  turnTimeRulesPerRestaurant: number;
  flexibleSeating: boolean;
  customReservations: boolean;
}

export interface Subscription {
  id: string | null;
  userId: string;
  plan: Plan;
  status: SubscriptionStatus;
  billingTier: BillingTier;
  currentPeriodEnd: string | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  lemonSqueezyId: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  isTrialActive: boolean;
  isTrialExpired: boolean;
  canOperate: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PlanComparisonRow {
  tier: BillingTier;
  label: string;
  price: string | null;
  limits: PlanLimits;
}

export interface JWTPayload {
  sub: string;       // user_id
  role: Role;
  jti: string;
  iat: number;
  exp: number;
}

// ─── Reservation engine ───────────────────────────────────────────────────────

export type SeatingMode = 'LOCKED' | 'FLEXIBLE';

export type ReservationStatus =
  | 'SCHEDULED'
  | 'SEATED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type ReservationType = 'STANDARD' | 'CUSTOM';

export type ReservationSource = 'ONLINE' | 'WALK_IN' | 'STAFF';

export interface Reservation {
  id: string;
  restaurantId: string;
  partySize: number;
  startsAt: string;   // ISO 8601
  endsAt: string;     // ISO 8601
  status: ReservationStatus;
  reservationType: ReservationType;
  source: ReservationSource;
  customFeeSnapshot: string | null;
  extraHourFeeSnapshot: string | null;
  feeCurrency: string | null;
  untilClose: boolean;
  wasCapped?: boolean;
  estimatedFee?: string | null;
  createdAt: string;
}

export interface DiningTable {
  id: string;
  restaurantId: string;
  name: string;
  minPartySize: number;
  maxPartySize: number;
  isActive: boolean;
}

export interface TableCombination {
  id: string;
  restaurantId: string;
  name: string;
  minPartySize: number;
  maxPartySize: number;
  isActive: boolean;
  tableIds: string[];
}

export interface TurnTimeRule {
  id: string;
  restaurantId: string;
  minPartySize: number;
  maxPartySize: number;
  durationMins: number;
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
  /** False until the verification link is clicked; gates booking/creation. */
  emailVerified?: boolean;
}
