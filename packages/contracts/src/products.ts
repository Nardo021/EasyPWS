/** Canonical product — retailer-agnostic identity. */
export interface CanonicalProduct {
  id: string;
  barcode?: string;
  brand?: string;
  name: string;
  size?: string;
  category?: string;
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export type ProductIdentifierType =
  | "barcode"
  | "gtin"
  | "brand_name_size"
  | "manual";

export interface ProductIdentifier {
  id: string;
  productId: string;
  type: ProductIdentifierType;
  value: string;
}
