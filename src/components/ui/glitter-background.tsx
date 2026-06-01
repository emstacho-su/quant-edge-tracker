import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float iTime;
  uniform vec2 iResolution;
  uniform sampler2D iChannel0;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    float result = 0.0;

    result += texture2D(iChannel0, uv * 1.1 + vec2(iTime * -0.005)).r;
    result *= texture2D(iChannel0, uv * 0.9 + vec2(iTime *  0.005)).g;

    // Sharpen — high power gives discrete sparkle points instead of haze.
    result = pow(result, 12.0);

    gl_FragColor = vec4(vec3(5.0) * result, 1.0);
  }
`

function generateNoiseTexture(size = 512): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const stride = i * 4
    data[stride] = Math.random() * 255
    data[stride + 1] = Math.random() * 255
    data[stride + 2] = Math.random() * 255
    data[stride + 3] = 255
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

interface SparklesPlaneProps {
  speed: number
}

function SparklesPlane({ speed }: SparklesPlaneProps) {
  const meshRef = useRef<THREE.Mesh>(null!)
  const noiseTexture = useMemo(() => generateNoiseTexture(512), [])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          iTime: { value: 0 },
          iResolution: {
            value: new THREE.Vector2(
              typeof window !== 'undefined' ? window.innerWidth : 1920,
              typeof window !== 'undefined' ? window.innerHeight : 1080,
            ),
          },
          iChannel0: { value: noiseTexture },
        },
        vertexShader,
        fragmentShader,
        transparent: false,
        side: THREE.DoubleSide,
      }),
    [noiseTexture],
  )

  useFrame((state) => {
    const mat = meshRef.current?.material
    if (!(mat instanceof THREE.ShaderMaterial)) return
    mat.uniforms.iTime.value = state.clock.elapsedTime * speed
    mat.uniforms.iResolution.value.set(state.size.width, state.size.height)
  })

  return (
    <mesh ref={meshRef} material={material}>
      <planeGeometry args={[10, 10]} />
    </mesh>
  )
}

interface GlitterBackgroundProps {
  /** Time-multiplier driving the noise scroll (perceived twinkle rate). Default 0.1875 = 25% of original. */
  speed?: number
  className?: string
}

export default function GlitterBackground({
  speed = 0.1875,
  className,
}: GlitterBackgroundProps) {
  return (
    <div
      className={cn(
        'absolute inset-0 h-full w-full opacity-60 mix-blend-lighten',
        className,
      )}
    >
      <Canvas
        camera={{ position: [0, 0, 8], fov: 35 }}
        style={{ width: '100%', height: '100%' }}
        gl={{ powerPreference: 'high-performance', antialias: false }}
      >
        <SparklesPlane speed={speed} />
      </Canvas>
    </div>
  )
}
