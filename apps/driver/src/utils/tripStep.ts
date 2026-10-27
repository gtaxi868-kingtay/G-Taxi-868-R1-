// What the driver should do right now on an active trip, in plain words,
// and which single big button to show. One place, so the panel and its
// tests agree.

export type TripAction = 'arrived' | 'verify' | 'deliveryPickup' | 'complete' | null;

export type TripStep = {
    step: 0 | 1 | 2;          // pickup · wait · drop-off
    title: string;
    hint: string;
    action: TripAction;
    actionLabel: string;
    actionIcon: 'location' | 'keypad' | 'cube' | 'flag' | 'time';
    actionEnabled: boolean;
};

export function tripStep(status: string, isDelivery: boolean, merchantPhotoReady: boolean): TripStep {
    if (status === 'assigned') {
        return isDelivery
            ? { step: 0, title: 'Head to the shop', hint: 'Tap when you reach the shop counter.', action: 'arrived', actionLabel: "I'm at the shop", actionIcon: 'location', actionEnabled: true }
            : { step: 0, title: 'Head to pickup', hint: 'Tap when you reach the rider.', action: 'arrived', actionLabel: "I've arrived", actionIcon: 'location', actionEnabled: true };
    }
    if (status === 'arrived') {
        if (isDelivery) {
            return merchantPhotoReady
                ? { step: 1, title: 'Collect the order', hint: 'The shop photographed the bag. Check it, then confirm.', action: 'deliveryPickup', actionLabel: 'I have the order', actionIcon: 'cube', actionEnabled: true }
                : { step: 1, title: 'Waiting for the shop', hint: 'The shop must photograph the order before you take it.', action: 'deliveryPickup', actionLabel: 'Waiting for shop photo', actionIcon: 'time', actionEnabled: false };
        }
        return { step: 1, title: 'Waiting for rider', hint: 'Ask the rider for their 4-digit PIN to start.', action: 'verify', actionLabel: 'Enter rider PIN', actionIcon: 'keypad', actionEnabled: true };
    }
    if (status === 'in_progress') {
        return isDelivery
            ? { step: 2, title: 'Deliver the order', hint: 'Tap once it is in the customer\'s hands.', action: 'complete', actionLabel: 'Mark delivered', actionIcon: 'flag', actionEnabled: true }
            : { step: 2, title: 'Drive to drop-off', hint: 'Tap when the rider is out of the car.', action: 'complete', actionLabel: 'Complete trip', actionIcon: 'flag', actionEnabled: true };
    }
    return { step: 2, title: 'Trip finished', hint: '', action: null, actionLabel: '', actionIcon: 'flag', actionEnabled: false };
}
