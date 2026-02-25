import { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import {
    Canvas,
    Fill,
    Shader,
    Skia,
    vec,
} from '@shopify/react-native-skia';
// Removed Reanimated import to prevent installation errors


const { width, height } = Dimensions.get('window');

// GLSL Shader for Rain Drops on Glass
// Heavily inspired by "Heartfelt" by BigWings (ShaderToy) simplified for RN Skia
const rainShaderSource = `
uniform float iTime;
uniform vec2 iResolution;

vec3 N13(float p) {
   vec3 p3 = fract(vec3(p) * vec3(.1031, .11369, .13787));
   p3 += dot(p3, p3.yzx + 19.19);
   return fract(vec3((p3.x + p3.y) * p3.z, (p3.x+p3.z) * p3.y, (p3.y+p3.z) * p3.x));
}

vec4 N14(float t) {
    return fract(sin(t * vec4(123., 1024., 1456., 264.)) * vec4(6547., 345., 8799., 1564.));
}

float N(float t) {
    return fract(sin(t * 12345.564) * 7658.76);
}

// Draw a single drop
float Saw(float b, float t) {
    return smoothstep(0., b, t) * smoothstep(1., b, t);
}

vec2 DropLayer2(vec2 uv, float t) {
    vec2 UV = uv;
    
    // Grid
    uv.y += t * 0.75;
    vec2 a = vec2(6., 1.);
    vec2 grid = a * 2.;
    vec2 id = floor(uv * grid);
    
    float colShift = N(id.x); 
    uv.y += colShift;
    
    id = floor(uv * grid);
    vec3 n = N13(id.x * 35.2 + id.y * 2376.1);
    vec2 st = fract(uv * grid) - vec2(.5, 0);
    
    float x = n.x - .5;
    
    float y = UV.y * 20.;
    float wiggle = sin(y + sin(y));
    x += wiggle * (.5 - abs(x)) * (n.z - .5);
    x *= .7;
    float ti = fract(t + n.z);
    float y_pos = (Saw(.85, ti) - .5) * .9 + .5;
    vec2 p = vec2(x, y_pos);
    
    float d = length((st - p) * a.yx);
    float mainDrop = smoothstep(.4, .0, d);
    
    float r = sqrt(smoothstep(1., y_pos, st.y));
    float cd = abs(st.x - x);
    float trail = smoothstep(.23 * r, .15 * r * r, cd);
    float trailFront = smoothstep(-.02, .02, st.y - y_pos);
    trail *= trailFront * r * r;
    
    y = UV.y;
    float trail2 = smoothstep(.2 * r, .0, cd);
    float droplet = max(0., (sin(y * (1. - y) * 120.) - st.y)) * trail2 * trailFront * n.z;
    y = fract(y * 10.) + (st.y - .5);
    float dd = length(st - vec2(x, y));
    droplet = smoothstep(.3, .0, dd);
    float m = mainDrop + droplet * r * trailFront;
    
    return vec2(m, trail);
}

float StaticDrops(vec2 uv, float t) {
    uv *= 40.;
    
    vec2 id = floor(uv);
    uv = fract(uv) - .5;
    vec3 n = N13(id.x * 107.45 + id.y * 3543.654);
    vec2 p = (n.xy - .5) * .7;
    float d = length(uv - p);
    
    float fade = Saw(.025, fract(t + n.z));
    float c = smoothstep(.3, 0., d) * fract(n.z * 10.) * fade;
    return c;
}

vec2 Drops(vec2 uv, float t, float l0, float l1, float l2) {
    float s = StaticDrops(uv, t) * l0; 
    vec2 m1 = DropLayer2(uv, t) * l1;
    vec2 m2 = DropLayer2(uv * 1.85, t) * l2;
    
    float c = s + m1.x + m2.x;
    c = smoothstep(.3, 1., c);
    
    return vec2(c, max(m1.y * l0, m2.y * l1));
}

vec4 main(vec2 pos) {
    vec2 uv = pos / iResolution.xy;
    vec2 UV = (pos - .5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * .2;
    
    float rainAmount = 1.0; 
    
    vec2 drops = Drops(uv, t, 1., 1., 1.);
    
    // Distort UVs
    // Drops normalish
    vec2 offs = vec2(drops.x, drops.x); 
    
    // Background Color - Dark Blue/Purple Gradient Simulation
    vec3 bgBase = vec3(0.05, 0.05, 0.1); 
    vec3 bgTop = vec3(0.1, 0.1, 0.3);
    vec3 col = mix(bgBase, bgTop, uv.y);
    
    // Add "Street Lights" or blur blobs (simulated)
    float light1 = length(UV - vec2(0.3, 0.2));
    col += vec3(0.8, 0.4, 0.1) * smoothstep(0.5, 0.0, light1) * 0.3; // Orange light
    
    float light2 = length(UV - vec2(-0.4, -0.3));
    col += vec3(0.1, 0.4, 0.9) * smoothstep(0.4, 0.0, light2) * 0.3; // Blue light
    
    // Apply drop distortion/refraction
    // (In a real 3D scene we would sample a texture, here we just brighten the drops)
    col += drops.x * 0.5; // Make drops shine
    
    // Vignette
    col *= 1.0 - dot(UV, UV) * 0.8;

    return vec4(col, 1.0);
}
`;

const runtimeShader = Skia.RuntimeEffect.Make(rainShaderSource);

export function PremiumRainBackground() {
    if (!runtimeShader) {
        return <View style={styles.container} />;
    }

    // Use pure React state for time to avoid Reanimated dependency issues
    const [time, setTime] = useState(0);
    const startTime = useRef(Date.now()).current;

    useEffect(() => {
        let animationFrameId: number;

        const animate = () => {
            // Calculate elapsed time in seconds
            const now = Date.now();
            setTime((now - startTime) / 1000);
            animationFrameId = requestAnimationFrame(animate);
        };

        animate();

        return () => cancelAnimationFrame(animationFrameId);
    }, [startTime]);

    // Skia uniforms using simple object derived from state
    // Note: useComputedValue removed in newer versions, pass object directly or via useValue for performance
    // For this implementation, simple object passing is sufficient for proving the concept
    const uniforms = {
        iTime: time,
        iResolution: vec(width, height),
    };

    return (
        <View style={styles.container}>
            <Canvas style={{ flex: 1 }}>
                <Fill>
                    <Shader source={runtimeShader} uniforms={uniforms} />
                </Fill>
            </Canvas>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#000',
    },
});
