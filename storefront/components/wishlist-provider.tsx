'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/client-api';
import { useSession } from './session';
const Context = createContext<{
  ids: string[];
  loading: boolean;
  pending: Set<string>;
  revision: number;
  toggle: (id: string) => Promise<void>;
}>({
  ids: [],
  loading: false,
  pending: new Set(),
  revision: 0,
  toggle: async () => {},
});
export const useWishlist = () => useContext(Context);
export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const userId = user?.id;
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(new Set<string>());
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const owner = useRef<string | undefined>(userId);
  const running = useRef(new Set<string>());
  useEffect(() => {
    owner.current = userId;
    running.current.clear();
    setIds([]);
    setPending(new Set());
    setError('');
    setLoading(Boolean(userId));
    if (!userId) return;
    let active = true;
    api<string[]>('/wishlist/ids')
      .then((data) => {
        if (active) {
          setIds(data);
          setLoading(false);
          setRevision((value) => value + 1);
        }
      })
      .catch(() => {
        if (active)
          setError(
            'Saved products could not be loaded. Reload this page to retry.',
          );
      });
    return () => {
      active = false;
    };
  }, [userId]);
  async function toggle(id: string) {
    if (!userId || loading || running.current.has(id)) return;
    const saved = ids.includes(id);
    const requestOwner = userId;
    running.current.add(id);
    setPending(new Set(running.current));
    setError('');
    setIds((current) =>
      saved ? current.filter((value) => value !== id) : [...current, id],
    );
    try {
      await api(`/wishlist/${id}`, {
        method: saved ? 'DELETE' : 'POST',
        ...(saved ? {} : { body: '{}' }),
      });
      if (owner.current === requestOwner) setRevision((value) => value + 1);
    } catch (e) {
      if (owner.current === requestOwner) {
        setIds((current) =>
          saved
            ? [...new Set([...current, id])]
            : current.filter((value) => value !== id),
        );
        setError(
          e instanceof Error ? e.message : 'Could not update saved products.',
        );
      }
    } finally {
      if (owner.current === requestOwner) {
        running.current.delete(id);
        setPending(new Set(running.current));
      }
    }
  }
  return (
    <Context.Provider value={{ ids, loading, pending, revision, toggle }}>
      {children}
      {error && (
        <div className="inbox-toast" role="alert">
          {error}
          <button className="text-link" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
