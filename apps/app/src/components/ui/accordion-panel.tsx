import { useId, type ReactNode } from "react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./collapsible";
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
  return (
    <Collapsible
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <CollapsibleTrigger
        id={`${id}-trigger`}
        className="group m-1 flex min-h-11 w-[calc(100%-0.5rem)] items-center justify-between gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {title}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent render={<section />} aria-labelledby={`${id}-trigger`}>
        <div className="border-t border-border px-4 py-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
