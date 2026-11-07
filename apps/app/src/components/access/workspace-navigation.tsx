import { Link, linkOptions } from "@tanstack/react-router";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useId } from "react";

const destinations = linkOptions([
  { to: "/devices", label: "Devices" },
  { to: "/team", label: "Team" },
  { to: "/incidents", label: "Incidents" },
  { to: "/triggers", label: "Triggers" },
]);

export function WorkspaceNavigation() {
  const id = useId();
  const reducedMotion = useReducedMotion();
  return (
    <LayoutGroup id={id}>
      <nav
        aria-label="Workspace"
        className="order-last flex w-full gap-6 sm:order-none sm:ml-2 sm:w-auto sm:self-stretch"
      >
        {destinations.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            activeProps={{ className: "text-foreground" }}
            inactiveProps={{ className: "text-muted-foreground" }}
            className="relative inline-flex h-11 items-center text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:h-full"
          >
            {({ isActive }) => (
              <>
                {label}
                {isActive && (
                  <motion.span
                    aria-hidden="true"
                    data-slot="workspace-nav-indicator"
                    layoutId="active-destination"
                    initial={false}
                    transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                  />
                )}
              </>
            )}
          </Link>
        ))}
      </nav>
    </LayoutGroup>
  );
}
