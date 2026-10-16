"use client";

import { motion } from "framer-motion";
import { products } from "@/lib/data";
import ProductCard from "./ProductCard";

export default function ProductsSection() {
  return (
    <section id="products" className="py-28 px-6 border-t border-subtle">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="mb-12"
        >
          <p className="font-mono text-xs text-accent tracking-widest mb-4">
            // PRODUCTS
          </p>
          <h2 className="text-3xl md:text-4xl font-medium tracking-tight">
            What we build and run.
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6">
          {products.map((p, i) => (
            <ProductCard key={p.name} product={p} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
