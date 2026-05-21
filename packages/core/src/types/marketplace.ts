export type OrderStatus =
    | 'pending'
    | 'accepted'
    | 'preparing'
    | 'ready'
    | 'out_for_delivery'
    | 'delivered'
    | 'cancelled';

export interface Order {
    id: string;
    rider_id: string;
    merchant_id: string;
    status: OrderStatus;
    total_cents: number;
    delivery_address: string;
    delivery_lat: number;
    delivery_lng: number;
    created_at: string;
    rider?: { name: string };
}
