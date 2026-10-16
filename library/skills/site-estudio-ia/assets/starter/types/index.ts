export type ProductStatus = "Live" | "Active" | "In Development";

export interface Product {
  name: string;
  tag: string;
  description: string;
  status: ProductStatus;
}

export interface Service {
  title: string;
  description: string;
}
