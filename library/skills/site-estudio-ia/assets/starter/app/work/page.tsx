import type { Metadata } from "next";
import ProductCard from "@/components/ProductCard";
import { products } from "@/lib/data";

export const metadata: Metadata = {
  title: "Work",
  description:
    "Products and systems built and operated by NeoDaemon — AI infrastructure, automation, e-commerce, and mobile.",
};

export default function WorkPage() {
  return (
    <section className="pt-32 pb-28 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-14">
          <p className="font-mono text-xs text-accent tracking-widest mb-4">
            // WORK
          </p>
          <h1 className="text-4xl md:text-5xl font-medium tracking-tight mb-4">
            Products we build and run.
          </h1>
          <p className="text-text-muted max-w-2xl">
            A rolling portfolio of live systems, side projects, and client
            builds. Everything here is in production or on the way there.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {products.map((p, i) => (
            <ProductCard key={p.name} product={p} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
