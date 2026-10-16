"use client";

import { motion } from "framer-motion";

const roles = [
  "embedded systems engineer",
  "AI architect",
  "builder",
  "founder",
];

const stats = [
  { k: "4+", v: "live systems" },
  { k: "24/7", v: "automation" },
  { k: "100%", v: "AI-native" },
];

export default function AboutSection() {
  return (
    <section id="about" className="py-28 px-6 border-t border-subtle">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
        >
          <p className="font-mono text-xs text-accent tracking-widest mb-4">
            <span className="text-text-muted">$</span> whoami
          </p>
          <h2 className="text-3xl md:text-5xl font-medium mb-6 tracking-tight leading-tight">
            An AI-first studio.<br />
            <span className="text-text-muted">Built to ship.</span>
          </h2>

          <p className="text-text-muted leading-relaxed mb-5">
            NeoDaemon is an AI-first digital studio founded by{" "}
            <span className="text-text-primary">Fábio Cabaceira</span>,
            embedded systems engineer. We build
            real products, not presentations. Every system we ship has
            automation baked in from day one.
          </p>
          <p className="text-text-muted leading-relaxed mb-8">
            AI gateways, content factories, e-commerce pipelines, mobile apps —
            lean infrastructure, shipped fast, built to run without us.
          </p>

          <div className="flex flex-wrap gap-2 mb-10">
            {roles.map((r, i) => (
              <motion.span
                key={r}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 + i * 0.06, duration: 0.3 }}
                className="font-mono text-xs px-3 py-1.5 border border-subtle text-text-muted hover:border-accent/60 hover:text-accent transition-colors"
              >
                {r}
              </motion.span>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4 pt-6 border-t border-subtle">
            {stats.map((s, i) => (
              <motion.div
                key={s.v}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 + i * 0.08, duration: 0.4 }}
              >
                <div className="text-2xl md:text-3xl font-medium text-accent font-mono">
                  {s.k}
                </div>
                <div className="font-mono text-[10px] tracking-widest uppercase text-text-muted mt-1">
                  {s.v}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
