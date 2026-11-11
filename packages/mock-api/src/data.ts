export interface User {
  id: number;
  username: string;
  password: string;
  name: string;
  email: string;
  role: 'admin' | 'customer';
  address: { street: string; city: string; country: string; zip: string | null };
  createdAt: string;
}

export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export type PaymentMethod =
  | { type: 'card'; brand: string; last4: string }
  | { type: 'paypal'; email: string };

export interface Order {
  id: number;
  userId: number;
  status: 'pending' | 'paid' | 'shipped' | 'cancelled';
  currency: string;
  total: number;
  items: OrderItem[];
  payment: PaymentMethod;
  notes: string | null;
  createdAt: string;
}

export const users: User[] = [
  {
    id: 1001,
    username: 'john',
    password: 'secret',
    name: 'John Carter',
    email: 'john@example.com',
    role: 'customer',
    address: { street: '1 Main St', city: 'London', country: 'GB', zip: 'EC1A 1BB' },
    createdAt: '2025-03-14T09:26:53.000Z',
  },
  {
    id: 1002,
    username: 'admin',
    password: 'admin',
    name: 'Ada Admin',
    email: 'ada@example.com',
    role: 'admin',
    address: { street: '9 Side Rd', city: 'Berlin', country: 'DE', zip: null },
    createdAt: '2024-11-02T12:00:00.000Z',
  },
];

export const orders: Order[] = [
  {
    id: 5001,
    userId: 1001,
    status: 'paid',
    currency: 'GBP',
    total: 59.97,
    items: [
      { sku: 'TSHIRT-M', name: 'T-shirt', quantity: 2, unitPrice: 19.99 },
      { sku: 'MUG', name: 'Mug', quantity: 1, unitPrice: 19.99 },
    ],
    payment: { type: 'card', brand: 'visa', last4: '4242' },
    notes: null,
    createdAt: '2025-06-01T10:00:00.000Z',
  },
  {
    id: 5002,
    userId: 1001,
    status: 'shipped',
    currency: 'GBP',
    total: 120,
    items: [{ sku: 'SHOES-42', name: 'Shoes', quantity: 1, unitPrice: 120 }],
    payment: { type: 'paypal', email: 'john@example.com' },
    notes: 'Leave at door',
    createdAt: '2025-07-12T15:30:00.000Z',
  },
  {
    id: 5003,
    userId: 1002,
    status: 'pending',
    currency: 'EUR',
    total: 9.5,
    items: [{ sku: 'PEN', name: 'Pen', quantity: 5, unitPrice: 1.9 }],
    payment: { type: 'card', brand: 'mastercard', last4: '4444' },
    notes: null,
    createdAt: '2025-08-20T08:15:00.000Z',
  },
];

export function publicUser(u: User) {
  const { password: _password, username: _username, ...rest } = u;
  return rest;
}
