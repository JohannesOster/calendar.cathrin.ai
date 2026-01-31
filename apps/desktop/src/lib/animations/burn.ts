import gsap from "gsap";

// Burn speed in pixels per second
const BURN_SPEED = 250;

const prefersReducedMotion = (): boolean => {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

export function burnElement(
  element: HTMLElement,
  onProgress: (percent: number) => void,
  onComplete: () => void
): gsap.core.Timeline | null {
  // Respect reduced motion preference - instant removal
  if (prefersReducedMotion()) {
    onComplete();
    return null;
  }

  // Calculate duration based on element height for consistent burn speed
  const height = element.offsetHeight;
  const duration = height / BURN_SPEED;

  // Track progress for syncing fire position
  const progress = { value: 0 };

  const timeline = gsap.timeline({
    onComplete,
  });

  // Animate clip-path and track progress for fire position
  timeline.to(progress, {
    value: 100,
    duration,
    ease: "linear",
    onUpdate: () => {
      const percent = progress.value;
      // Update clip-path
      element.style.clipPath = `inset(${percent}% 0 0 0)`;
      // Update fire position callback
      onProgress(percent);
    },
  });

  return timeline;
}
