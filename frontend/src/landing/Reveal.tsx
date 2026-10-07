// Quiet scroll transitions for the landing sections: each block eases in once as it enters the view.
// A few variations, so scrolling has some rhythm without anything shouting. Reduced motion: none
// (MotionConfig in AppShell turns transforms off).
import type { ReactNode } from "react";
import { motion, type TargetAndTransition } from "motion/react";

type Kind = "rise" | "soften" | "slide" | "settle";

const FROM: Record<Kind, TargetAndTransition> = {
  rise: { opacity: 0, y: 28 }, // fades up
  soften: { opacity: 0, filter: "blur(8px)" }, // comes into focus
  slide: { opacity: 0, x: -24 }, // drifts in from the left
  settle: { opacity: 0, scale: 0.97 }, // settles into place
};

const TO: TargetAndTransition = { opacity: 1, y: 0, x: 0, scale: 1, filter: "blur(0px)" };

export function Reveal({ children, kind = "rise", delay = 0, className }: { children: ReactNode; kind?: Kind; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={FROM[kind]}
      whileInView={TO}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.8, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}
