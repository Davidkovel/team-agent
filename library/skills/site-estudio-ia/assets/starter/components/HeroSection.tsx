"use client";

import { motion } from "framer-motion";
import NeoLogo from "./NeoLogo";

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden px-6">
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 80%)",
        }}
      />

      <motion.div
        aria-hidden
        initial={{ y: "-10%" }}
        animate={{ y: "110%" }}
        transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
        className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent pointer-events-none"
      />

      <motion.div
        aria-hidden
        className="absolute w-[80vw] h-[80vw] max-w-[900px] max-h-[900px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(0,255,136,0.08) 0%, transparent 60%)",
        }}
        animate={{ scale: [1, 1.08, 1], opacity: [0.6, 0.9, 0.6] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative flex flex-col items-center text-center">
        <NeoLogo size="lg" withCircle animated />

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-10 text-5xl md:text-7xl font-medium tracking-tight"
        >
          NeoDaemon
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="mt-5 max-w-xl text-text-muted text-base md:text-lg leading-relaxed"
        >
          We design, build, and automate digital products and systems for the
          modern internet.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-10 flex items-center gap-4"
        >
          <a
            href="#products"
            className="group inline-flex items-center gap-2 border border-accent/40 bg-accent/5 hover:bg-accent/10 hover:border-accent px-5 py-3 font-mono text-sm text-accent hover:shadow-glow transition-all"
          >
            <span>See what we build</span>
            <span
              aria-hidden
              className="transition-transform group-hover:translate-x-1"
            >
              →
            </span>
          </a>
          <a
            href="#contact"
            className="inline-flex items-center gap-2 px-5 py-3 font-mono text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            <span>Contact</span>
          </a>
        </motion.div>
      </div>

      <motion.a
        href="#about"
        aria-label="Scroll down"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.6 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-widest text-text-muted hover:text-accent transition-colors flex flex-col items-center gap-2"
      >
        <span>SCROLL</span>
        <motion.span
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          ↓
        </motion.span>
      </motion.a>
    </section>
  );
}
