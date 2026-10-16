"use client";

import { motion } from "framer-motion";
import { services } from "@/lib/data";

export default function ServicesSection() {
  return (
    <section id="services" className="py-28 px-6 border-t border-subtle">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="mb-12"
        >
          <p className="font-mono text-xs text-accent tracking-widest mb-4">
            // SERVICES
          </p>
          <h2 className="text-3xl md:text-4xl font-medium tracking-tight">
            What we take on for clients.
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-subtle border border-subtle">
          {services.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className="bg-bg p-8 hover:bg-surface transition-colors"
            >
              <h3 className="font-mono text-sm text-accent mb-3">
                {String(i + 1).padStart(2, "0")}.
              </h3>
              <h4 className="text-lg font-medium mb-2">{s.title}</h4>
              <p className="text-text-muted text-sm leading-relaxed">
                {s.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
