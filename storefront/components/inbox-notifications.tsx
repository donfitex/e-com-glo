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
const Context = createContext({
  unread: 0,
  conversationUnread: 0,
  announcementUnread: 0,
  refresh: async () => {},
});
export const useInboxNotifications = () => useContext(Context);
export function notifyInboxChanged() {
  window.dispatchEvent(new Event('inbox-changed'));
}
export function InboxNotifications({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const userId = user?.id;
  const admin = user?.role === 'ADMIN';
  const [unread, setUnread] = useState(0);
  const [conversationUnread, setConversations] = useState(0);
  const [announcementUnread, setAnnouncements] = useState(0);
  const [legacy, setLegacy] = useState(0);
  const [toast, setToast] = useState(false);
  const previous = useRef<number | null>(null);
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    if (!userId) return;
    const version = epoch.current;
    const results = await Promise.allSettled([
      api<{ unread: number }>('/conversations/summary'),
      api<{ unread: number }>('/announcements/summary'),
      ...(admin ? [api<{ unread: number }>('/admin/inbox/summary')] : []),
    ]);
    if (version !== epoch.current) return;
    const count = (i: number) => {
      const r = results[i];
      return r?.status === 'fulfilled' ? r.value.unread : 0;
    };
    const sum = count(0) + count(1) + count(2);
    if (previous.current !== null && sum > previous.current) setToast(true);
    previous.current = sum;
    setUnread(sum);
    setConversations(count(0));
    setAnnouncements(count(1));
    setLegacy(count(2));
  }, [userId, admin]);
  useEffect(() => {
    epoch.current++;
    previous.current = null;
    setUnread(0);
    setConversations(0);
    setAnnouncements(0);
    setToast(false);
    if (!userId) return;
    void refresh();
    const update = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = setInterval(update, 30000);
    window.addEventListener('focus', update);
    window.addEventListener('inbox-changed', update);
    return () => {
      epoch.current++;
      clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('inbox-changed', update);
    };
  }, [userId, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(false), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const href = admin
    ? legacy
      ? '/admin?section=inbox'
      : '/admin?section=conversations'
    : announcementUnread && !conversationUnread
      ? '/account/updates'
      : '/account/inbox';
  return (
    <Context.Provider
      value={{ unread, conversationUnread, announcementUnread, refresh }}
    >
      {children}
      {user && toast && (
        <div className="inbox-toast" role="status">
          <Bell size={17} />
          <span>{admin ? 'New support message' : 'New inbox update'}</span>
          <Link href={href} onClick={() => setToast(false)}>
            Open inbox →
          </Link>
        </div>
      )}
    </Context.Provider>
  );
}
export function InboxBell() {
  const { unread, conversationUnread } = useInboxNotifications();
  const { user } = useSession();
  const admin = user?.role === 'ADMIN';
  return (
    <Link
      className="inbox-bell icon-button"
      href={
        admin
          ? conversationUnread
            ? '/admin?section=conversations'
            : '/admin?section=inbox'
          : '/account/inbox'
      }
      aria-label={`${admin ? 'Admin inbox' : 'Your inbox'}, ${unread} unread messages`}
    >
      <Bell size={20} />
      {unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}
