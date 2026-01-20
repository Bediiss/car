import React, { useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerspectiveCamera, Sky } from '@react-three/drei';
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import * as THREE from 'three';

// Car Component with physics and controls
function Car({ carRef }) {
  const [controls, setControls] = useState({
    forward: false,
    backward: false,
    left: false,
    right: false,
  });

  useEffect(() => {
    const handleKeyDown = (e) => {
      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          setControls((c) => ({ ...c, forward: true }));
          break;
        case 's':
        case 'arrowdown':
          setControls((c) => ({ ...c, backward: true }));
          break;
        case 'a':
        case 'arrowleft':
          setControls((c) => ({ ...c, left: true }));
          break;
        case 'd':
        case 'arrowright':
          setControls((c) => ({ ...c, right: true }));
          break;
      }
    };

    const handleKeyUp = (e) => {
      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          setControls((c) => ({ ...c, forward: false }));
          break;
        case 's':
        case 'arrowdown':
          setControls((c) => ({ ...c, backward: false }));
          break;
        case 'a':
        case 'arrowleft':
          setControls((c) => ({ ...c, left: false }));
          break;
        case 'd':
        case 'arrowright':
          setControls((c) => ({ ...c, right: false }));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useFrame((_, delta) => {
    if (!carRef.current) return;

    const baseSpeed = 1.3;
    const rotationSpeed = 2.0;
    const maxForward = baseSpeed * 10; // about 13 m/s
    const maxReverse = baseSpeed * 8; // slightly slower in reverse
    const accel = 30; // acceleration rate m/s^2
    const brakeAccel = 40; // stronger when changing direction
    const coastDrag = 0.6; // m/s^2 decay when coasting

    // Get current rotation (as quaternion) and velocity
    const rotation = carRef.current.rotation();
    const carQuat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const currentVel = carRef.current.linvel();
    const currentVelVec = new THREE.Vector3(currentVel.x, currentVel.y, currentVel.z);

    // Calculate forward direction based on car's rotation
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(carQuat).normalize();

    // Project velocity onto forward vector to get signed speed
    const speedAlongForward = forward.dot(currentVelVec);

    // Decide target speed based on input
    const noThrottle = !controls.forward && !controls.backward;
    let desiredSpeed = controls.forward
      ? maxForward
      : controls.backward
      ? -maxReverse
      : speedAlongForward;

    if (noThrottle) {
      // Allow momentum to carry with a gentle decay
      desiredSpeed = speedAlongForward * Math.max(1 - coastDrag * delta, 0);
    }

    // Limit how quickly we can change speed to avoid instant direction flips
    const speedDiff = desiredSpeed - speedAlongForward;
    const accelRate = Math.sign(speedDiff) === Math.sign(speedAlongForward) ? accel : brakeAccel;
    const maxStep = accelRate * delta;
    const clampedStep = THREE.MathUtils.clamp(speedDiff, -maxStep, maxStep);
    const newSpeed = speedAlongForward + clampedStep;

    // Rebuild velocity: keep lateral component so slides feel natural
    const forwardComponent = forward.clone().multiplyScalar(speedAlongForward);
    const lateralComponent = currentVelVec.clone().sub(forwardComponent).multiplyScalar(0.98);
    const newVelVec = forward.clone().multiplyScalar(newSpeed).add(lateralComponent);

    carRef.current.setLinvel(
      { x: newVelVec.x, y: currentVel.y, z: newVelVec.z },
      true
    );

    // Handle rotation
    const steerInput = (controls.left ? 1 : 0) + (controls.right ? -1 : 0);
    if (steerInput !== 0) {
      // Reverse steering when backing up to mimic real vehicles
      const directionMultiplier = controls.backward && !controls.forward ? -1 : 1;
      // Scale steering with horizontal speed: near-zero speed -> almost no steering
      const horizSpeed = Math.hypot(currentVel.x, currentVel.z);
      const lowSpeed = 1.5;
      const speedScale = Math.min((horizSpeed / lowSpeed) ** 2, 1); // quadratic falloff
      const coastingPenalty = !controls.forward && !controls.backward ? 0.4 : 1; // weaker when only turning
      const torque = rotationSpeed * steerInput * directionMultiplier * speedScale * coastingPenalty;
      carRef.current.applyTorqueImpulse({ x: 0, y: torque, z: 0 }, true);
    }
  });

  return (
    <RigidBody
      ref={carRef}
      position={[0, 2, 0]}
      colliders={false}
      mass={1}
        linearDamping={0.2}
        angularDamping={0.12}
    >
      <CuboidCollider args={[1, 0.5, 2]} />
      <group>
        {/* Car body */}
        <mesh castShadow position={[0, 0.5, 0]}>
          <boxGeometry args={[2, 1, 4]} />
          <meshStandardMaterial color="#3b82f6" metalness={0.6} roughness={0.4} />
        </mesh>

        {/* Car top */}
        <mesh castShadow position={[0, 1.25, -0.5]}>
          <boxGeometry args={[1.6, 0.8, 2]} />
          <meshStandardMaterial color="#2563eb" metalness={0.6} roughness={0.4} />
        </mesh>

        {/* Wheels */}
        {[
          [-0.9, -0.2, 1.2],
          [0.9, -0.2, 1.2],
          [-0.9, -0.2, -1.2],
          [0.9, -0.2, -1.2],
        ].map((pos, i) => (
          <mesh key={i} position={pos} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.4, 0.4, 0.3, 16]} />
            <meshStandardMaterial color="#1f2937" />
          </mesh>
        ))}
      </group>
    </RigidBody>
  );
}

// Camera that follows the car
function FollowCamera({ carRef }) {
  const targetVec = useRef(new THREE.Vector3());
  const desiredPos = useRef(new THREE.Vector3());
  const lookQuat = useRef(new THREE.Quaternion());
  const lookMatrix = useRef(new THREE.Matrix4());

  useFrame(({ camera }) => {
    if (!carRef.current) return;

    const pos = carRef.current.translation();
    const rot = carRef.current.rotation();
    const carQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

    // Place the camera behind and above the car using its heading
    const offset = new THREE.Vector3(0, 5, 12).applyQuaternion(carQuat);

    targetVec.current.set(pos.x, pos.y + 1.5, pos.z);
    desiredPos.current.copy(targetVec.current).add(offset);

    camera.position.lerp(desiredPos.current, 0.08);
    // Smooth camera rotation to keep facing the car
    lookMatrix.current.lookAt(camera.position, targetVec.current, new THREE.Vector3(0, 1, 0));
    lookQuat.current.setFromRotationMatrix(lookMatrix.current);
    camera.quaternion.slerp(lookQuat.current, 0.12);
  });

  return null;
}


// Ground plane
function Ground() {
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[50, 0.1, 50]} />
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#10b981" />
      </mesh>
    </RigidBody>
  );
}

// Procedural environment - this will be connected to Qdrant data
function ProceduralEnvironment() {
  // This is where you'll generate buildings/products based on vector distances
  const zones = [
    { pos: [10, 1, 10], color: '#ef4444', label: 'High-value' },
    { pos: [-10, 1, 10], color: '#f59e0b', label: 'Mid-range' },
    { pos: [10, 1, -10], color: '#8b5cf6', label: 'Budget' },
    { pos: [-10, 1, -10], color: '#06b6d4', label: 'Premium' },
  ];

  return (
    <>
      {zones.map((zone, i) => (
        <RigidBody key={i} type="fixed" position={zone.pos} colliders={false}>
          <CuboidCollider args={[2, 2, 2]} />
          <mesh castShadow>
            <boxGeometry args={[4, 4, 4]} />
            <meshStandardMaterial
              color={zone.color}
              metalness={0.3}
              roughness={0.7}
            />
          </mesh>
        </RigidBody>
      ))}
    </>
  );
}

// Main App Component
export default function App() {
  const carRef = useRef(null);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0f172a' }}>
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          color: 'white',
          fontFamily: 'monospace',
          background: 'rgba(0,0,0,0.7)',
          padding: '15px',
          borderRadius: '8px',
          zIndex: 10,
        }}
      >
        <h3 style={{ margin: '0 0 10px 0' }}>🚗 FinTech 3D Navigation</h3>
        <p style={{ margin: '5px 0' }}>W/↑ - Forward</p>
        <p style={{ margin: '5px 0' }}>S/↓ - Backward</p>
        <p style={{ margin: '5px 0' }}>A/← - Turn Left</p>
        <p style={{ margin: '5px 0' }}>D/→ - Turn Right</p>
        <p style={{ margin: '15px 0 5px 0', fontSize: '12px', opacity: 0.7 }}>
          Drive to colored zones to explore financial products
        </p>
      </div>

      <Canvas shadows>
        <PerspectiveCamera makeDefault position={[0, 15, 20]} fov={60} />
        <Sky sunPosition={[100, 20, 100]} />
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[10, 20, 10]}
          intensity={1}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={50}
          shadow-camera-left={-30}
          shadow-camera-right={30}
          shadow-camera-top={30}
          shadow-camera-bottom={-30}
        />

        <Physics gravity={[0, -9.81, 0]}>
          <Car carRef={carRef} />
          <Ground />
          <ProceduralEnvironment />
        </Physics>

        <FollowCamera carRef={carRef} />
      </Canvas>
    </div>
  );
}