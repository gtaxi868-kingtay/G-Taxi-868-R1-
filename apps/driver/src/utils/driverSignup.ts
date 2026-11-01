import { decode } from 'base64-arraybuffer';

// Driver sign-up helpers, kept out of the screen so they can be tested.

// Photo bytes from the picker's base64. Reading the file back with
// fetch(uri).blob() + FileReader fails on many Android phones ("Network
// request failed"), which stopped sign-up at the upload step; the rider
// safety selfie had the same bug and the same fix.
export function photoBytes(base64: string): ArrayBuffer {
    const clean = base64.replace(/^data:[^,]*,/, '');
    if (!clean) throw new Error('That photo could not be read. Please choose it again.');
    return decode(clean);
}

// Supabase says "User already registered" when someone taps Submit again
// after a half-finished first attempt. That is a retry, not a new person.
export function isAlreadyRegistered(message: string): boolean {
    return /already registered|already been registered|user already exists/i.test(message);
}

// Plain-English version of whatever went wrong, for the alert.
export function friendlySignupError(message: string): { title: string; body: string } {
    if (/already registered as a (rider|driver)/i.test(message)) {
        return {
            title: 'Phone Already Registered',
            body: 'This phone number is already linked to a G-Taxi account. Each phone number can only be used for one account.',
        };
    }
    if (/invalid login credentials/i.test(message)) {
        return {
            title: 'Email Already Used',
            body: 'An account with this email already exists and the password does not match. Sign in instead, or use a different email.',
        };
    }
    if (/network request failed|failed to fetch|timeout|timed out/i.test(message)) {
        return {
            title: 'No Connection',
            body: 'Your application did not finish sending. Check your signal and tap Submit again. Nothing is lost.',
        };
    }
    if (/duplicate key.*plate|plate_number/i.test(message)) {
        return { title: 'Plate Already Registered', body: 'That licence plate is already on another driver account. Check the plate and try again.' };
    }
    if (/row-level security|not authorized|permission denied|jwt/i.test(message)) {
        return {
            title: 'Almost There',
            body: 'Please confirm your email first, then come back here and tap Submit again to finish sending your documents.',
        };
    }
    return { title: 'Could Not Submit', body: `${message}\n\nTap Submit again. Your details are still filled in.` };
}
