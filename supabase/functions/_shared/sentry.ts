export async function captureException(
    error: Error | unknown,
    context?: Record<string, unknown>
): Promise<void> {
    try {
        const SENTRY_DSN = 'https://97cd39592148cc3b6e1d004e6b713f3a@o4510426117767168.ingest.us.sentry.io/4510970071285760';

        // Parse DSN into components needed for the Sentry envelope API
        const url = new URL(SENTRY_DSN);
        const publicKey = url.username;
        const projectId = url.pathname.replace('/', '');
        const endpoint = `${url.protocol}//${url.host}/api/${projectId}/envelope/`;

        const errorObj = error instanceof Error ? error : new Error(String(error));

        const envelope = [
            // Envelope header
            JSON.stringify({
                dsn: SENTRY_DSN,
                sdk: { name: 'sentry.javascript.deno', version: '1.0.0' }
            }),
            // Event header
            JSON.stringify({ type: 'event' }),
            // Event payload
            JSON.stringify({
                event_id: crypto.randomUUID().replace(/-/g, ''),
                timestamp: new Date().toISOString(),
                platform: 'node',
                level: 'error',
                exception: {
                    values: [{
                        type: errorObj.name,
                        value: errorObj.message,
                        stacktrace: errorObj.stack ? {
                            frames: errorObj.stack.split('\n').slice(1).map((line: string) => ({
                                filename: line.trim(),
                            }))
                        } : undefined,
                    }]
                },
                extra: context,
                tags: {
                    runtime: 'deno',
                    platform: 'supabase-edge-functions',
                },
            })
        ].join('\n');

        await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-sentry-envelope',
                'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${publicKey}`,
            },
            body: envelope,
        });
    } catch (sentryError) {
        // Never let Sentry errors break the main function
        console.error('[Sentry] Failed to capture exception:', sentryError);
    }
}
