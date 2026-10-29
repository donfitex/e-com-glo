import { webcrypto, randomUUID } from 'node:crypto';
import {
  createInboxKey,
  unlockInboxKey,
  encryptContact,
  decryptContact,
  encryptReply,
  decryptReply,
} from '../storefront/lib/contact-crypto';
jest.setTimeout(30000);
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});
const passphrase = 'Recovery-test-passphrase-123';
const payload = {
  name: 'Sensitive Buyer Name',
  email: 'private-buyer@example.com',
  subject: 'Delivery complaint',
  message:
    'Confidential complaint body that must never reach the server in plaintext.',
  orderReference: 'ORDER-123',
};
let key: Awaited<ReturnType<typeof createInboxKey>>;
beforeAll(async () => {
  key = await createInboxKey(passphrase);
});
test('browser-only hybrid encryption hides every contact field and decrypts with the recipient key', async () => {
  const envelope = await encryptContact(payload, key.publicKey);
  const serialized = JSON.stringify(envelope);
  for (const value of Object.values(payload))
    expect(serialized).not.toContain(value);
  expect(
    await decryptContact(envelope, key.publicKey.id, key.privateKey),
  ).toEqual(payload);
  expect(key.privateKey.extractable).toBe(false);
  const second = await encryptContact(payload, key.publicKey);
  expect(second.iv).not.toBe(envelope.iv);
  expect(second.ciphertext).not.toBe(envelope.ciphertext);
});
test('ciphertext tampering and message-ID substitution fail authentication', async () => {
  const envelope = await encryptContact(payload, key.publicKey);
  await expect(
    decryptContact(
      {
        ...envelope,
        ciphertext:
          (envelope.ciphertext[0] === 'A' ? 'B' : 'A') +
          envelope.ciphertext.slice(1),
      },
      key.publicKey.id,
      key.privateKey,
    ),
  ).rejects.toThrow();
  await expect(
    decryptContact(
      { ...envelope, id: randomUUID() },
      key.publicKey.id,
      key.privateKey,
    ),
  ).rejects.toThrow();
});
test('recovery backup is encrypted, rejects wrong passphrases and recovers the original private key', async () => {
  expect(JSON.stringify(key.backup)).not.toContain('"d":');
  expect(JSON.stringify(key.backup)).not.toContain(passphrase);
  await expect(
    unlockInboxKey(key.backup, 'Wrong-recovery-passphrase-123'),
  ).rejects.toThrow();
  const recovered = await unlockInboxKey(key.backup, passphrase);
  const envelope = await encryptContact(payload, key.publicKey);
  expect(
    await decryptContact(envelope, recovered.keyId, recovered.privateKey),
  ).toEqual(payload);
  await expect(
    unlockInboxKey({ ...key.backup, fingerprint: '0'.repeat(64) }, passphrase),
  ).rejects.toThrow();
});

test('both participants decrypt replies while thread, sender and recipient substitution fails', async () => {
  const customer = await createInboxKey(passphrase);
  const thread = randomUUID(),
    sender = randomUUID();
  const envelope = await encryptReply(
    'Private two-way message',
    thread,
    sender,
    customer.publicKey,
    key.publicKey,
  );
  expect(
    await decryptReply(envelope, customer.publicKey.id, customer.privateKey),
  ).toBe('Private two-way message');
  expect(await decryptReply(envelope, key.publicKey.id, key.privateKey)).toBe(
    'Private two-way message',
  );
  expect(JSON.stringify(envelope)).not.toContain('Private two-way message');
  for (const patch of [
    { conversationId: randomUUID() },
    { senderId: randomUUID() },
    { customerKeyId: randomUUID() },
  ])
    await expect(
      decryptReply({ ...envelope, ...patch }, key.publicKey.id, key.privateKey),
    ).rejects.toThrow();
  await expect(
    decryptReply(envelope, randomUUID(), key.privateKey),
  ).rejects.toThrow();
});
