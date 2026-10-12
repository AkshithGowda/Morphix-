import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const DitherMaterial = {
  uniforms: {
    u_time: { value: 0 },
    u_mouse: { value: new THREE.Vector2(0, 0) },
    u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    u_threshold: { value: 0.5 },
    u_color1: { value: new THREE.Color('#000000') },
    u_color2: { value: new THREE.Color('#00FF41') },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float u_time;
    uniform vec2 u_mouse;
    uniform vec2 u_resolution;
    uniform float u_threshold;
    uniform vec3 u_color1;
    uniform vec3 u_color2;
    
    varying vec2 vUv;

    void main() {
      float l = sin(vUv.x * 5.0 + u_time) * cos(vUv.y * 3.0 + u_time * 0.5) * 0.5 + 0.5;
      
      // Zero-branch Bayer dither approximation
      vec2 fc = gl_FragCoord.xy;
      float d0 = mod(fc.x, 2.0) * 0.5 + mod(fc.y, 2.0) * 0.5;
      float d1 = mod(floor(fc.x / 2.0), 2.0) * 0.5 + mod(floor(fc.y / 2.0), 2.0) * 0.5;
      float limit = (d0 + d1 * 0.5) * 0.5;
      
      vec3 ditheredColor = mix(u_color1, u_color2, step(limit * u_threshold, l));
      vec3 sharpColor = mix(vec3(0.0), vec3(0.0, 1.0, 0.25), l);

      vec2 mousePos = u_mouse;
      mousePos.y = u_resolution.y - mousePos.y;
      float dist = distance(gl_FragCoord.xy, mousePos);
      
      float radius = min(u_resolution.x, u_resolution.y) * 0.25;
      float blend = smoothstep(radius, radius + 40.0, dist);
      
      vec3 finalColor = mix(sharpColor, ditheredColor, blend);
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `
};

const ShaderPlane = () => {
  const mesh = useRef();
  const material = useRef();
  const { size } = useThree();

  const uniforms = useMemo(() => THREE.UniformsUtils.clone(DitherMaterial.uniforms), []);

  useFrame((state) => {
    if (material.current) {
      material.current.uniforms.u_time.value = state.clock.elapsedTime;
      material.current.uniforms.u_resolution.value.set(size.width, size.height);
    }
  });

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (material.current) {
        material.current.uniforms.u_mouse.value.set(e.clientX, e.clientY);
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <mesh ref={mesh}>
      <planeGeometry args={[size.width, size.height]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={DitherMaterial.vertexShader}
        fragmentShader={DitherMaterial.fragmentShader}
      />
    </mesh>
  );
};

const CameraSetup = () => {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.position.z = 1;
    camera.left = -size.width / 2;
    camera.right = size.width / 2;
    camera.top = size.height / 2;
    camera.bottom = -size.height / 2;
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
};

export default function DitherBackground() {
  return (
    <div id="webgl-bg">
      <Canvas orthographic camera={{ position: [0, 0, 1] }}>
        <CameraSetup />
        <ShaderPlane />
      </Canvas>
    </div>
  );
}
