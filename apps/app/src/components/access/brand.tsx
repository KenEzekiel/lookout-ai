import { lazy, Suspense, useEffect, useState } from "react";

const Metal = lazy(() =>
  import("@paper-design/shaders-react").then(({ LiquidMetal }) => ({ default: LiquidMetal })),
);

export function Brand() {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let supported: boolean | undefined;
    const update = () => {
      if (motion.matches || document.visibilityState !== "visible") {
        setAnimate(false);
        return;
      }
      if (supported === undefined) {
        const context = document.createElement("canvas").getContext("webgl2");
        supported = context !== null;
        context?.getExtension("WEBGL_lose_context")?.loseContext();
      }
      setAnimate(supported);
    };
    update();
    motion.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      motion.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Lookout">
      <span className="relative h-6 w-9 shrink-0" aria-hidden="true">
        <svg viewBox="0 0 40 26" fill="none" className="size-full text-signal">
          <path d="M5 17a15 15 0 0 1 30 0" stroke="currentColor" strokeWidth="5" />
          <path d="M0 23.5h40" stroke="currentColor" strokeWidth="5" />
        </svg>
        {animate && (
          <Suspense fallback={null}>
            <Metal
              className="pointer-events-none absolute inset-0"
              style={{ maskImage: "url('/horizon-mask.svg')", maskSize: "100% 100%" }}
              width={36}
              height={24}
              shape="none"
              colorBack="#3459e6"
              colorTint="#7094ff"
              repetition={2}
              softness={0.35}
              shiftRed={0}
              shiftBlue={0}
              distortion={0.12}
              contour={0}
              angle={65}
              speed={0.3}
              scale={1}
              maxPixelCount={3456}
            />
          </Suspense>
        )}
      </span>
      <span className="text-[23px] font-semibold tracking-[-0.04em]">lookout</span>
    </span>
  );
}
