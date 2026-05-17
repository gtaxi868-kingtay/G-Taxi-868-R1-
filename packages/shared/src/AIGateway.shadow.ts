/**
 * G-TAXI AI GATEWAY (SHADOW LAYER)
 * 
 * Manages all AI interactions (Vision, NLP, Concierge) with fallback safety 
 * and performance monitoring.
 */

export class AIGatewayShadow {
    private static instance: AIGatewayShadow;

    private constructor() {}

    public static getInstance(): AIGatewayShadow {
        if (!AIGatewayShadow.instance) {
            AIGatewayShadow.instance = new AIGatewayShadow();
        }
        return AIGatewayShadow.instance;
    }

    private log(flow: string, input: any, output: any, duration: number) {
        console.log(`[SHADOW_AI][${flow}]`, {
            timestamp: new Date().toISOString(),
            durationMs: duration,
            inputSize: JSON.stringify(input).length,
            outputSize: JSON.stringify(output).length,
            success: !output.error
        });
    }

    /**
     * SHADOW WRAPPER: identifyProduct
     */
    public async identifyProduct(image: string, originalFn: Function): Promise<any> {
        const start = Date.now();
        try {
            const result = await originalFn(image);
            this.log('identifyProduct', { imageSize: image.length }, result, Date.now() - start);
            return result;
        } catch (error) {
            this.log('identifyProduct', { imageSize: image.length }, { error }, Date.now() - start);
            // Fallback: If AI fails, we already have UI handling in the original screen,
            // but the gateway ensures we don't crash.
            throw error;
        }
    }

    /**
     * SHADOW WRAPPER: generateGreeting
     */
    public async generateGreeting(context: any, originalFn: Function): Promise<any> {
        const start = Date.now();
        try {
            const result = await originalFn(context);
            this.log('generateGreeting', context, result, Date.now() - start);
            return result;
        } catch (error) {
            this.log('generateGreeting', context, { error }, Date.now() - start);
            return { greeting: "Welcome back to G-Taxi!" }; // Safe fallback
        }
    }
}

export const AIGateway = AIGatewayShadow.getInstance();
