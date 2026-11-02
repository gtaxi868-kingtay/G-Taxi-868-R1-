// Keeps a person signed in on their own phone. SecureStore warns above 2048 bytes
// and a session can be larger, so long values are split. Each write goes into a
// fresh generation and only then moves the pointer, so an app killed halfway
// leaves the previous session whole.

export type SecureLike = {
    getItemAsync: (key: string) => Promise<string | null>;
    setItemAsync: (key: string, value: string) => Promise<void>;
    deleteItemAsync: (key: string) => Promise<void>;
};

const CHUNK = 1800;
const pointer = (key: string) => `${key}.pointer`;
const part = (key: string, generation: string, i: number) => `${key}.${generation}.${i}`;

export function chunkedStore(store: SecureLike) {
    const clearGeneration = async (key: string, value: string | null) => {
        if (!value) return;
        const [generation, count] = value.split(':');
        for (let i = 0; i < Number(count); i += 1) await store.deleteItemAsync(part(key, generation, i)).catch(() => {});
    };

    return {
        async getItem(key: string): Promise<string | null> {
            const at = await store.getItemAsync(pointer(key));
            if (!at) return store.getItemAsync(key); // written before this change
            const [generation, count] = at.split(':');
            const pieces: string[] = [];
            for (let i = 0; i < Number(count); i += 1) {
                const piece = await store.getItemAsync(part(key, generation, i));
                if (piece === null) return null;
                pieces.push(piece);
            }
            return pieces.join('');
        },
        async setItem(key: string, value: string): Promise<void> {
            const before = await store.getItemAsync(pointer(key));
            const generation = before?.startsWith('a:') ? 'b' : 'a';
            const count = Math.max(1, Math.ceil(value.length / CHUNK));
            for (let i = 0; i < count; i += 1) await store.setItemAsync(part(key, generation, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
            await store.setItemAsync(pointer(key), `${generation}:${count}`);
            await clearGeneration(key, before);
            await store.deleteItemAsync(key).catch(() => {});
        },
        async removeItem(key: string): Promise<void> {
            const before = await store.getItemAsync(pointer(key));
            await store.deleteItemAsync(pointer(key)).catch(() => {});
            await clearGeneration(key, before);
            await store.deleteItemAsync(key).catch(() => {});
        },
    };
}
