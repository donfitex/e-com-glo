export interface Category {
  id: string;
  name: string;
  slug: string;
}
export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  stock: number;
  active: boolean;
  attributes: Record<string, string>;
  categoryId: string;
  category: Category;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'CUSTOMER' | 'ADMIN';
}
export interface CartItem {
  productId: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  lineTotal: number;
}
export interface Cart {
  items: CartItem[];
  currency: string | null;
  subtotal: number;
  total: number;
}
export interface Address {
  name: string;
  email?: string;
  phone?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
}
export interface Order {
  id: string;
  status: string;
  paymentStatus: string;
  currency: string;
  total: number;
  subtotal: number;
  shipping: number;
  tax: number;
  createdAt: string;
  items?: CartItem[];
  shippingAddress: Address;
}
export interface Quote {
  currency: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  ruleVersion: string;
}
export const currencies = [
  'USD',
  'EUR',
  'GBP',
  'NGN',
  'CAD',
  'AUD',
  'JPY',
  'INR',
] as const;
export function money(amount: number, currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(
    amount /
      10 **
        new Intl.NumberFormat('en', {
          style: 'currency',
          currency,
        }).resolvedOptions().maximumFractionDigits!,
  );
}
