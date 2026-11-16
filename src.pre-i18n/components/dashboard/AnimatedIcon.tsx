import { motion, useReducedMotion } from 'motion/react';
import type { ComponentProps } from 'react';
import { Icon } from '../../modules/icons';

type IconName = ComponentProps<typeof Icon>['name'];

/**
 * Springs are tuned so the icon lands without overshooting: fast stiffness, heavy
 * damping, tiny mass. Nothing here animates layout — only transform and opacity —
 * so the tiles never reflow while the pointer moves across them.
 */
const SPRING = { type: 'spring', stiffness: 420, damping: 24, mass: 0.6 } as const;

export interface AnimatedIconProps {
  name: IconName;
  size?: number;
  /** True while the parent control is hovered or focused. */
  active: boolean;
  /** Degrees of tilt at rest; direction gives each row a bit of character. */
  tilt?: number;
}

/**
 * An icon that answers the pointer. It pops in when the dashboard mounts and
 * springs up while its control is lit, then settles back on release. Skipped
 * entirely under prefers-reduced-motion, where the plain icon is rendered.
 */
export function AnimatedIcon({ name, size = 14, active, tilt = -6 }: AnimatedIconProps) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <Icon name={name} size={size} />;
  return (
    <motion.span
      aria-hidden="true"
      style={{ display: 'inline-flex' }}
      initial={{ opacity: 0, scale: 0.55 }}
      animate={{
        opacity: 1,
        scale: active ? 1.16 : 1,
        rotate: active ? tilt : 0,
      }}
      transition={SPRING}
    >
      <Icon name={name} size={size} />
    </motion.span>
  );
}
