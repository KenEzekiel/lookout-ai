import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "@/components/landing-page";

export const Route = createFileRoute("/")({
  head: () => ({ links: [{ rel: "preload", as: "image", href: "/landing-camera.jpg" }] }),
  component: LandingPage,
});
