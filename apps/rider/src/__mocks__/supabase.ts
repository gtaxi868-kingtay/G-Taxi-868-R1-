export const supabase = {
    auth: {
        getSession: jest.fn(),
        signInWithPassword: jest.fn(),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
    from: jest.fn(() => ({
        select: jest.fn(() => ({
            eq: jest.fn(() => ({
                single: jest.fn(),
            })),
        })),
    })),
};
