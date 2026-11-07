import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function AccordionPanel({
  title,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
}: {
  title: ReactNode;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(defaultOpen);
  const isOpen = open ?? expanded;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        id={`${id}-trigger`}
        aria-expanded={isOpen}
        aria-controls={`${id}-panel`}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => {
          setExpanded(!isOpen);
          onOpenChange?.(!isOpen);
        }}
      >
        {title}
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-muted-foreground motion-safe:transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      <section
        id={`${id}-panel`}
        aria-labelledby={`${id}-trigger`}
        hidden={!isOpen}
        className="border-t border-border px-4 py-4"
      >
        {children}
      </section>
    </section>
  );
}
