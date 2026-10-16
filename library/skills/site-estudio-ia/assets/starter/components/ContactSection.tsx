"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { contactEmail } from "@/lib/data";

export default function ContactSection() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = encodeURIComponent(
      `From: ${form.name} <${form.email}>\n\n${form.message}`
    );
    const subject = encodeURIComponent("New inquiry via neodaemon.com");
    window.location.href = `mailto:${contactEmail}?subject=${subject}&body=${body}`;
  };

  return (
    <section id="contact" className="py-28 px-6 border-t border-subtle">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="mb-10"
        >
          <p className="font-mono text-xs text-accent tracking-widest mb-4">
            // CONTACT
          </p>
          <h2 className="text-3xl md:text-4xl font-medium tracking-tight mb-4">
            Have something to build?
          </h2>
          <p className="text-text-muted">
            Reach out directly at{" "}
            <a
              href={`mailto:${contactEmail}`}
              className="text-accent hover:underline"
            >
              {contactEmail}
            </a>{" "}
            — or drop a note below.
          </p>
        </motion.div>

        <motion.form
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, delay: 0.1 }}
          onSubmit={handleSubmit}
          className="grid gap-4"
        >
          <input
            type="text"
            required
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-surface border border-subtle px-4 py-3 font-mono text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:shadow-glow transition-all"
          />
          <input
            type="email"
            required
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="bg-surface border border-subtle px-4 py-3 font-mono text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:shadow-glow transition-all"
          />
          <textarea
            required
            rows={5}
            placeholder="What do you want to build?"
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            className="bg-surface border border-subtle px-4 py-3 font-mono text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:shadow-glow transition-all resize-none"
          />
          <button
            type="submit"
            className="justify-self-start border border-subtle hover:border-accent px-5 py-3 font-mono text-sm hover:text-accent hover:shadow-glow transition-all"
          >
            Send →
          </button>
        </motion.form>
      </div>
    </section>
  );
}
