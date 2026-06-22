export type Role = 'diner' | 'owner';

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
