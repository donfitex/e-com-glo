'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { api } from '@/lib/client-api';
import { useSession } from './session';
const Context = createContext({ unread: 0, refresh: async () => {} });
export const useInboxNotifications = () => useContext(Context);
export function notifyInboxChanged() {
  window.dispatchEvent(new Event('inbox-changed'));
}
export function InboxNotifications({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const admin = user?.role === 'ADMIN';
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState(false);
  const previous = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    if (!admin) return;
    try {
      const result = await api<{ unread: number }>('/admin/inbox/summary');
      if (previous.current !== null && result.unread > previous.current)
        setToast(true);
      previous.current = result.unread;
      setUnread(result.unread);
    } catch {
      /* Inbox page reports errors; notifications do not interrupt shopping. */
    }
  }, [admin]);
  useEffect(() => {
    previous.current = null;
    setUnread(0);
    if (!admin) return;
    void refresh();
    const update = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update);
    window.addEventListener('inbox-changed', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('inbox-changed', update);
    };
  }, [admin, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(false), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return (
    <Context.Provider value={{ unread, refresh }}>
      {children}
      {admin && toast && (
        <div className="inbox-toast" role="status">
          <Bell size={17} />
          <span>New support message</span>
          <Link href="/admin?section=inbox" onClick={() => setToast(false)}>
            Open inbox →
          </Link>
        </div>
      )}
    </Context.Provider>
  );
}
export function InboxBell() {
  const { unread } = useInboxNotifications();
  return (
    <Link
      className="inbox-bell icon-button"
      href="/admin?section=inbox"
      aria-label={`Admin inbox, ${unread} unread messages`}
    >
      <Bell size={20} />
      {unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}
