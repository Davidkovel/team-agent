"use client";

import { motion } from "framer-motion";
import type { Product } from "@/types";

const statusColor: Record<Product["status"], string> = {
  Live: "text-accent border-accent/40",
  Active: "text-accent border-accent/40",
  "In Development": "text-text-muted border-subtle",
};

const isActive = (s: Product["status"]) => s === "Live" || s === "Active";

interface Props {
  product: Product;
  index?: number;
}

export default function ProductCard({ product, index = 0 }: Props) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, delay: index * 0.08 }}
      className="group relative bg-surface border border-subtle p-7 hover:border-accent/60 hover:shadow-glow transition-all overflow-hidden"
    >
      <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-accent/0 group-hover:border-accent transition-colors" />
      <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-accent/0 group-hover:border-accent transition-colors" />
      <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-accent/0 group-hover:border-accent transition-colors" />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-accent/0 group-hover:border-accent transition-colors" />

      <div
        aria-hidden
        className="absolute -inset-x-10 -top-px h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent translate-y-0 opacity-0 group-hover:opacity-100 group-hover:translate-y-[400%] transition-all duration-1000"
      />

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] tracking-widest text-text-muted">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="font-mono text-[11px] tracking-widest text-text-muted uppercase">
            {product.tag}
          </span>
        </div>
        <span
          className={`inline-flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase px-2 py-1 border ${statusColor[product.status]}`}
        >
          {isActive(product.status) && (
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-accent"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.6, repeat: Infinity }}
            />
          )}
          {product.status}
        </span>
      </div>

      <h3 className="text-2xl font-medium mb-3 tracking-tight group-hover:text-accent transition-colors">
        {product.name}
      </h3>

      <p className="text-text-muted leading-relaxed text-sm">
        {product.description}
      </p>
    </motion.article>
  );
}
