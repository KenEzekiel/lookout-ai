import { Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowRight,
  Camera,
  Check,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useState, type MouseEvent } from "react";
import { Brand } from "./access/brand";
import { SourcePreviewFrame } from "./source-preview-frame";
import { Badge } from "./ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import "./landing-page.css";

const steps = [
  {
    kind: "camera",
    icon: Camera,
    title: "Connect a camera",
    detail:
      "Pair a device you control and open its capture station. Lookout keeps the view tied to that device, so your team knows exactly where it comes from.",
  },
  {
    kind: "trigger",
    icon: SlidersHorizontal,
    title: "Define what matters",
    detail:
      "Choose a camera, describe the situation worth noticing, and decide who should receive the alert. A focused trigger gives your team a clear starting point.",
  },
  {
    kind: "incident",
    icon: ShieldCheck,
    title: "See the context",
    detail:
      "Open an incident to see when and where it happened. Review the available evidence together before choosing a response, with the same context in front of everyone.",
  },
] as const;

type JourneyKind = (typeof steps)[number]["kind"];

function JourneyExample({ kind }: { kind: JourneyKind }) {
  if (kind === "camera") {
    return (
      <div className="landing-example-camera">
        <img src="/landing-camera.jpg" alt="Example parking-area view from a camera" />
        <span>Example camera view · Parking area</span>
      </div>
    );
  }

  if (kind === "trigger") {
    return (
      <div className="landing-example-rule">
        <span className="landing-example-muted">Example trigger</span>
        <strong>Notice a possible vehicle collision</strong>
        <div>
          <span>Source</span>
          <b>Parking area</b>
        </div>
        <div>
          <span>Notify</span>
          <b>Response team</b>
        </div>
      </div>
    );
  }

  return (
    <div className="landing-example-incident">
      <img src="/landing-camera.jpg" alt="Example evidence from the parking area" />
      <div>
        <span className="landing-example-muted">Example incident</span>
        <strong>Possible crash</strong>
        <p>Parking area · 09:41</p>
        <span className="landing-example-ready">
          <Check size={15} aria-hidden="true" /> Replay ready
        </span>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [selectedKind, setSelectedKind] = useState<JourneyKind>("camera");
  const reducedMotion = useReducedMotion();
  const { scrollY } = useScroll();
  const previewLift = useTransform(scrollY, [0, 800], [0, -72]);
  const scrollToHowItWorks = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById("how-it-works")?.scrollIntoView?.({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <div className="landing-page">
      <a className="landing-skip" href="#main-content">
        Skip to content
      </a>
      <main id="main-content">
        <div className="landing-top">
          <div className="landing-header-bar">
            <header className="landing-header">
              <Link to="/" className="landing-brand">
                <Brand />
              </Link>
              <nav aria-label="Main navigation" className="landing-navigation">
                <a href="#how-it-works" onClick={scrollToHowItWorks}>
                  How it works
                </a>
                <a href="/pitch-deck.html" target="_blank" rel="noopener noreferrer">
                  Pitch deck
                </a>
              </nav>
              <Link to="/devices" className="landing-header-cta">
                Open app <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </header>
          </div>
          <div className="landing-light landing-light-left" aria-hidden="true" />
          <div className="landing-light landing-light-right" aria-hidden="true" />

          <section className="landing-hero" aria-labelledby="landing-title">
            <div className="landing-hero-copy">
              <h1 id="landing-title">
                Be there for the moments that <span className="landing-highlight">matter</span>.
              </h1>
              <p>
                Lookout helps your team notice a moment, see its context, and take the next step
                with confidence.
              </p>
              <div className="landing-actions">
                <Link to="/devices" className="landing-primary">
                  Get started <ArrowRight size={19} aria-hidden="true" />
                </Link>
                <a href="#how-it-works" className="landing-secondary" onClick={scrollToHowItWorks}>
                  See how it works <ArrowDown size={17} aria-hidden="true" />
                </a>
              </div>
              <div className="landing-hero-note">
                <Check size={16} aria-hidden="true" /> Your camera stays under your control.
              </div>
            </div>
            <div className="landing-hero-art-enter">
              <motion.div
                className="landing-hero-art"
                style={{ y: reducedMotion ? 0 : previewLift }}
              >
                <section
                  className="landing-side-panel landing-side-panel-left"
                  aria-label="Example incident"
                >
                  <span className="landing-side-label">Example incident</span>
                  <span className="landing-side-icon landing-side-icon-incident">
                    <ShieldCheck size={20} aria-hidden="true" />
                  </span>
                  <strong>Possible crash</strong>
                  <p>Parking area · 09:41</p>
                  <div className="landing-side-detail">
                    <span>Evidence</span>
                    <Badge variant="secondary" className="landing-side-status">
                      Replay ready
                    </Badge>
                  </div>
                </section>
                <section
                  className="landing-preview"
                  aria-label="Illustrative Lookout incident preview"
                >
                  <div className="landing-preview-top">
                    <div className="landing-preview-source">
                      <span className="landing-preview-source-icon">
                        <Radio size={15} aria-hidden="true" />
                      </span>
                      <span>
                        <strong>Parking area</strong>
                        <small>Camera 01 · Example scene</small>
                      </span>
                    </div>
                    <span className="landing-preview-label">Replayed example</span>
                  </div>
                  <SourcePreviewFrame className="landing-camera">
                    <img
                      src="/landing-camera.jpg"
                      alt="Example parking-area camera view with two cars"
                      fetchPriority="high"
                    />
                    <span className="landing-camera-target" aria-hidden="true" />
                    <span className="landing-camera-caption">
                      Replay example <span>09:41:24</span>
                    </span>
                  </SourcePreviewFrame>
                </section>
                <section
                  className="landing-side-panel landing-side-panel-right"
                  aria-label="Example review step"
                >
                  <span className="landing-side-label">Next step</span>
                  <span className="landing-side-icon landing-side-icon-response">
                    <Check size={20} aria-hidden="true" />
                  </span>
                  <strong>Review footage</strong>
                  <p>Confirm what happened before responding.</p>
                  <div className="landing-side-detail">
                    <span>Source</span>
                    <b>Camera 01</b>
                  </div>
                </section>
              </motion.div>
            </div>
          </section>
        </div>

        <section className="landing-how" id="how-it-works" aria-labelledby="landing-how-title">
          <div className="landing-section-intro">
            <h2 id="landing-how-title">A better way to stay in the know.</h2>
            <p>
              From a camera view to a decision your team can make, each step keeps the story clear.
            </p>
          </div>
          <div className="landing-walkthrough">
            <div className="landing-steps" data-selected={selectedKind}>
              {steps.map((step) => (
                <Collapsible
                  className="landing-step"
                  key={step.kind}
                  open={selectedKind === step.kind}
                  onOpenChange={(open) => {
                    if (open) setSelectedKind(step.kind);
                  }}
                >
                  <CollapsibleTrigger className="landing-step-trigger">
                    <span className="landing-step-icon">
                      <step.icon size={20} aria-hidden="true" />
                    </span>
                    <span className="landing-step-title">{step.title}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="landing-step-content">
                    <span className="landing-step-body">{step.detail}</span>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
            <section
              className="landing-journey"
              id="landing-journey-panel"
              aria-label="Selected Lookout example"
            >
              <motion.div
                key={selectedKind}
                className="landing-journey-visual"
                initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.32 }}
              >
                <JourneyExample kind={selectedKind} />
              </motion.div>
            </section>
          </div>
        </section>

        <section className="landing-close" aria-labelledby="landing-close-title">
          <div>
            <h2 id="landing-close-title">A little more clarity starts here.</h2>
          </div>
          <Link to="/devices" className="landing-primary">
            Open Lookout <ArrowRight size={19} aria-hidden="true" />
          </Link>
        </section>
      </main>
      <footer className="landing-footer">
        <div className="landing-footer-main">
          <Brand />
          <p>See clearly. Act thoughtfully.</p>
        </div>
        <div className="landing-footer-bottom">
          <span>© 2026 Lookout AI. All rights reserved.</span>
          <span className="landing-footer-team">
            Made by <strong>Lesgo Heketon</strong>
          </span>
        </div>
      </footer>
    </div>
  );
}
