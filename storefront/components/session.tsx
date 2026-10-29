'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { api, announceCart } from '@/lib/client-api';
import type { User, Cart } from '@/lib/types';
const Context = createContext<{
  user: User | null;
  loading: boolean;
  count: number;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}>({
  user: null,
  loading: true,
  count: 0,
  refresh: async () => {},
  logout: async () => {},
});
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const me = await api<User>('/auth/me');
      setUser(me);
      try {
        const cart = await api<Cart>('/cart');
        setCount(cart.items.reduce((n, item) => n + item.quantity, 0));
      } catch {
        setCount(0);
      }
    } catch {
      setUser(null);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const listener = () => {
      void refresh();
    };
    window.addEventListener('cart-changed', listener);
    return () => window.removeEventListener('cart-changed', listener);
  }, [refresh]);
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
    setCount(0);
    announceCart();
  };
  return (
    <Context.Provider value={{ user, loading, count, refresh, logout }}>
      {children}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);
