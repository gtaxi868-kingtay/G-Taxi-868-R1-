import { photoBytes, isAlreadyRegistered, friendlySignupError } from '../driverSignup';

describe('driver sign-up helpers', () => {
    it('turns picker base64 into the exact photo bytes', () => {
        const bytes = new Uint8Array(photoBytes('/9j/4AA='));
        expect(Array.from(bytes.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
        expect(new Uint8Array(photoBytes('data:image/jpeg;base64,/9j/4AA=')).length).toBe(bytes.length);
    });
    it('refuses an empty photo in plain words', () => {
        expect(() => photoBytes('')).toThrow(/choose it again/);
    });
    it('treats a second Submit as a retry, not a new person', () => {
        expect(isAlreadyRegistered('User already registered')).toBe(true);
        expect(isAlreadyRegistered('Password should be at least 6 characters')).toBe(false);
    });
    it('explains common failures in plain English', () => {
        expect(friendlySignupError('This phone is already registered as a rider').title).toBe('Phone Already Registered');
        expect(friendlySignupError('Network request failed').body).toMatch(/Nothing is lost/);
        expect(friendlySignupError('Invalid login credentials').title).toBe('Email Already Used');
        expect(friendlySignupError('new row violates row-level security policy').title).toBe('Almost There');
        expect(friendlySignupError('something odd').body).toMatch(/still filled in/);
    });
});
