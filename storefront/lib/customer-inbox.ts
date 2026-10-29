'use client';
import { api } from './client-api';
import {
  createInboxKey,
  unlockInboxKey,
  type KeyBackup,
  type ContactKey,
} from './contact-crypto';
export interface CustomerKey {
  keyId: string;
  privateKey: CryptoKey;
}
// Non-extractable browser key. Account password and decrypted JWK are never persisted.
let memory: { userId: string; key: CustomerKey } | null = null;
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ecom-private-inbox', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function stored(
  userId: string,
  value?: CustomerKey | null,
): Promise<CustomerKey | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        'keys',
        value === undefined ? 'readonly' : 'readwrite',
      );
      const store = tx.objectStore('keys');
      const request =
        value === undefined
          ? store.get(userId)
          : value === null
            ? store.delete(userId)
            : store.put(value, userId);
      tx.oncomplete = () =>
        resolve(
          value === undefined ? (request.result ?? null) : (value ?? null),
        );
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function customerInboxKey(userId: string) {
  if (memory?.userId === userId) return memory.key;
  try {
    const key = await stored(userId);
    if (key) memory = { userId, key };
    return key;
  } catch {
    return null;
  }
}
export async function initializeCustomerInbox(
  userId: string,
  password: string,
) {
  const [existing, recoveryKey] = await Promise.all([
    api<KeyBackup | null>('/conversations/vault'),
    api<ContactKey>('/conversations/recovery-key'),
  ]);
  let key: CustomerKey;
  if (existing) {
    const unlocked = await unlockInboxKey(existing, password, {
      publicKey: recoveryKey,
      userId,
    });
    await api('/conversations/recovery', {
      method: 'POST',
      body: JSON.stringify(unlocked.recoveryEnvelope),
    });
    key = unlocked;
  } else {
    const generated = await createInboxKey(password, {
      publicKey: recoveryKey,
      userId,
    });
    await api('/conversations/key', {
      method: 'POST',
      body: JSON.stringify({
        id: generated.publicKey.id,
        publicJwk: generated.publicKey.publicJwk,
        backup: generated.backup,
        recovery: generated.recoveryEnvelope,
      }),
    });
    key = { keyId: generated.publicKey.id, privateKey: generated.privateKey };
  }
  memory = { userId, key };
  try {
    await stored(userId, key);
  } catch {
    /* Restricted device storage: memory remains available for this sign-in. */
  }
  window.dispatchEvent(new Event('customer-key-ready'));
}
export async function forgetCustomerInbox(userId: string) {
  if (memory?.userId === userId) memory = null;
  try {
    await stored(userId, null);
  } catch {
    /* Storage may be blocked. */
  }
  window.dispatchEvent(new Event('customer-key-cleared'));
}
