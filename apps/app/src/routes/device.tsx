import { createFileRoute } from "@tanstack/react-router";
import { AccessApp } from "@/components/access/app";

export const Route = createFileRoute("/device")({ component: () => <AccessApp capture /> });
