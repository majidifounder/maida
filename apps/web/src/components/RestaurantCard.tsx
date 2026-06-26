import { Link } from 'react-router-dom';
import type { PublicRestaurant } from '../types/api.js';
import { Card } from './ui/Card.js';
import { Button } from './ui/Button.js';

function formatCuisine(cuisine: string): string {
  return cuisine.charAt(0) + cuisine.slice(1).toLowerCase();
}

export function RestaurantCard({ restaurant }: { restaurant: PublicRestaurant }) {
  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <div className="aspect-[16/10] bg-gray-100">
        {restaurant.imageUrl ? (
          <img
            src={restaurant.imageUrl}
            alt={restaurant.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl text-gray-300">
            🍽
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h2 className="text-lg font-semibold text-gray-900">{restaurant.name}</h2>
        <p className="mt-1 text-sm text-gray-500">
          {formatCuisine(restaurant.cuisine)} · {restaurant.city}
        </p>
        <p className="mt-2 line-clamp-2 flex-1 text-sm text-gray-600">
          {restaurant.description}
        </p>
        <Link to={`/restaurants/${restaurant.id}`} className="mt-4">
          <Button className="w-full">View</Button>
        </Link>
      </div>
    </Card>
  );
}

export function RestaurantCardSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="aspect-[16/10] bg-gray-200" />
      <div className="space-y-3 p-4">
        <div className="h-5 w-2/3 rounded bg-gray-200" />
        <div className="h-4 w-1/2 rounded bg-gray-200" />
        <div className="h-4 w-full rounded bg-gray-200" />
        <div className="h-9 w-full rounded-lg bg-gray-200" />
      </div>
    </div>
  );
}
