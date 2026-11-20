export const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// One fragment shader: noisy breathing sphere + outer glow + blocked shield ring.
export const FRAG = `#version 300 es
precision highp float;

uniform vec2  u_res;
uniform float u_time;      // flow time: integrated on CPU, runs faster with turbulence
uniform float u_level;      // 0..1 smoothed audio RMS
uniform vec3  u_color;      // tier color (sprung on the CPU)
uniform float u_turbulence; // 0..1
uniform float u_spin;       // radians / s
uniform float u_glow;       // 0..1, blocked shield pulse

out vec4 outColor;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y) * 2.0;
  float r = length(uv);
  float t = u_time;

  // Boundary: breathing + audio swell + noisy wobble rotating with spin.
  vec2 dir = r > 0.0 ? uv / r : vec2(1.0, 0.0);
  vec2 rd = rot(t * u_spin) * dir;
  float wob = fbm(vec3(rd * 1.6, t * 0.45)) - 0.5;
  float R = 0.62 + 0.015 * sin(t * 1.5) + u_level * 0.07
          + wob * (0.03 + u_turbulence * 0.16 + u_level * 0.14);

  float body = 1.0 - smoothstep(R - 0.012, R + 0.004, r);

  // Interior swirl.
  vec2 p = rot(t * u_spin * 0.7) * uv;
  float sw = fbm(vec3(p * 2.2, t * 0.3));
  float sw2 = fbm(vec3(p * 4.5 + sw, t * 0.2));

  vec3 deep = u_color * 0.35;
  vec3 bright = mix(u_color, vec3(1.0), 0.45);
  vec3 col = mix(deep, u_color, smoothstep(0.25, 0.75, sw));
  col = mix(col, bright, smoothstep(0.55, 0.9, sw2) * (0.35 + u_level * 0.6));

  // Fake lighting: rim darkening + top-left specular.
  float rim = smoothstep(R * 0.55, R, r);
  col *= 1.0 - rim * 0.35;
  float spec = exp(-12.0 * length(uv - vec2(-0.22, 0.26)));
  col += vec3(spec * 0.35);
  col += u_color * smoothstep(R - 0.08, R, r) * 0.35; // inner rim light

  // Outer glow.
  float out_d = max(r - R, 0.0);
  float glow = exp(-out_d * 9.0) * (0.35 + u_level * 0.5) * (1.0 - body);

  // Blocked: slow red pulsing shield ring outside the body.
  float pulse = 0.55 + 0.45 * sin(t * 2.2);
  float ringR = R + 0.16 + 0.015 * sin(t * 2.2);
  float ring = exp(-pow((r - ringR) * 38.0, 2.0)) * u_glow * pulse;
  float ringHaze = exp(-abs(r - ringR) * 10.0) * u_glow * pulse * 0.35;
  vec3 red = vec3(0.937, 0.267, 0.267);

  vec3 rgb = col * body + u_color * glow + red * (ring + ringHaze);
  float alpha = clamp(body + glow + ring + ringHaze, 0.0, 1.0);
  // Premultiplied output.
  outColor = vec4(rgb, alpha);
}
`;
