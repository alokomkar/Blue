/** Cover pitch is independent of movement; positive throttle tilts upward. */
export function coverPitch(
  pitch: number,
  throttle: number,
  mouseY: number,
  sensitivity: number,
  dt: number
): number {
  return Math.max(
    -0.8,
    Math.min(0.8, pitch + throttle * 0.9 * dt - mouseY * 0.0028 * sensitivity)
  );
}

/** A held backward stick must be released after Duck before it can leave cover. */
export function coverBackAction(
  aiming: boolean,
  latched: boolean,
  throttle: number
): 'none' | 'leave' {
  return !aiming && !latched && throttle < -0.5 ? 'leave' : 'none';
}

/** Fine joystick control while aiming; movement keeps its existing response. */
export function aimInput(value: number, touch: boolean, sensitivity = 1): number {
  return value * (touch ? 0.85 : 1) * sensitivity;
}
