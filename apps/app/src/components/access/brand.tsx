export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Lookout">
      <span className="h-6 w-9 shrink-0" aria-hidden="true">
        <svg viewBox="0 0 40 26" fill="none" className="size-full text-signal">
          <path d="M5 17a15 15 0 0 1 30 0" stroke="currentColor" strokeWidth="5" />
          <path d="M0 23.5h40" stroke="currentColor" strokeWidth="5" />
        </svg>
      </span>
      <span className="text-[23px] font-semibold tracking-[-0.04em]">lookout</span>
    </span>
  );
}
