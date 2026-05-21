export interface UserProfile {
    id: string;
    full_name: string | null;
    name?: string | null;
    phone_number: string | null;
    email: string | null;
    avatar_url: string | null;
    created_at: string;
    last_active_at: string | null;
}

export interface UserPreferences {
    user_id: string;
    preferred_vehicle_type: 'Standard' | 'XL' | 'Premium';
    preferred_payment_method: 'cash' | 'card';
    favorite_driver_ids: string[];
}

export interface NotificationSettings {
    user_id: string;
    ride_updates: boolean;
    promotions: boolean;
    service_alerts: boolean;
}
