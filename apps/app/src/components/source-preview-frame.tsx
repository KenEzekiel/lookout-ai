import { type ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function SourcePreviewFrame({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative isolate aspect-[1.35] min-h-[260px] w-full overflow-hidden rounded-[18px]",
        "border border-white/10 bg-[radial-gradient(ellipse_at_65%_25%,#354b50,#172126_60%,#10171b)]",
        "shadow-[0_22px_60px_#0003] sm:aspect-[1.56] sm:min-h-[420px]",
        className,
      )}
      {...props}
    />
  );
}
