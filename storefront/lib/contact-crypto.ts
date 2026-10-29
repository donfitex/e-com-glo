// Legacy contact intake and version 2 two-way browser encryption.
// No message plaintext or unencrypted private key is sent to the messaging API.
export interface ContactPayload {
  name: string;
  email: string;
  subject: string;
  message: string;
  orderReference: string;
}
export interface ContactKey {
  id: string;
  fingerprint: string;
  publicJwk: JsonWebKey;
}
export interface MessageEnvelope {
  version: 1;
  id: string;
  keyId: string;
  iv: string;
  wrappedKey: string;
  ciphertext: string;
}
export interface KeyBackup {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: 600000;
  keyId: string;
  fingerprint: string;
  publicJwk: JsonWebKey;
  salt: string;
  iv: string;
  ciphertext: string;
}
const encoder = new TextEncoder();
function b64(value: ArrayBuffer) {
  return btoa(
    Array.from(new Uint8Array(value), (byte) => String.fromCharCode(byte)).join(
      '',
    ),
  );
}
function bytes(value: string): ArrayBuffer {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
    .buffer as ArrayBuffer;
}
function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
async function fingerprint(jwk: JsonWebKey) {
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt'],
  );
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await crypto.subtle.exportKey('spki', key),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
function contactPayload(value: unknown): ContactPayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid message');
  const input = value as Record<string, unknown>;
  for (const [field, max] of [
    ['name', 120],
    ['email', 254],
    ['subject', 160],
    ['message', 5000],
    ['orderReference', 64],
  ] as const) {
    if (
      typeof input[field] !== 'string' ||
      input[field].length > max ||
      (field !== 'orderReference' && !input[field].trim())
    )
      throw new Error('Check your message fields');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email as string))
    throw new Error('Enter a valid email address');
  return {
    name: (input.name as string).trim(),
    email: (input.email as string).trim(),
    subject: (input.subject as string).trim(),
    message: (input.message as string).trim(),
    orderReference: (input.orderReference as string).trim(),
  };
}
async function backupKey(passphrase: string, salt: ArrayBuffer) {
  if (passphrase.length < 12 || passphrase.length > 256)
    throw new Error('Use a recovery passphrase between 12 and 256 characters');
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function createInboxKey(
  passphrase: string,
  recovery?: { publicKey: ContactKey; userId: string },
) {
  if (passphrase.length < 12 || passphrase.length > 256)
    throw new Error('Use a recovery passphrase between 12 and 256 characters');
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const keyId = crypto.randomUUID();
  const fp = await fingerprint(publicJwk);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapping = await backupKey(passphrase, salt.buffer);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(`ecom-backup:v1:${keyId}:${fp}`),
      tagLength: 128,
    },
    wrapping,
    encoder.encode(JSON.stringify(privateJwk)),
  );
  const backup: KeyBackup = {
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: 600000,
    keyId,
    fingerprint: fp,
    publicJwk,
    salt: b64(salt.buffer),
    iv: b64(iv.buffer),
    ciphertext: b64(ciphertext),
  };
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
  return {
    backup,
    recoveryEnvelope: recovery
      ? await encryptKeyRecovery(
          privateJwk,
          keyId,
          recovery.userId,
          recovery.publicKey,
        )
      : undefined,
    privateKey,
    publicKey: { id: keyId, publicJwk, fingerprint: fp },
  };
}
export async function unlockInboxKey(
  input: unknown,
  passphrase: string,
  recovery?: { publicKey: ContactKey; userId: string },
) {
  if (!input || typeof input !== 'object')
    throw new Error('Invalid recovery file');
  const backup = input as KeyBackup;
  if (
    backup.version !== 1 ||
    backup.kdf !== 'PBKDF2-SHA256' ||
    backup.iterations !== 600000 ||
    !uuid(backup.keyId) ||
    !/^[a-f0-9]{64}$/.test(backup.fingerprint) ||
    typeof backup.ciphertext !== 'string' ||
    backup.ciphertext.length > 16000 ||
    typeof backup.salt !== 'string' ||
    typeof backup.iv !== 'string'
  )
    throw new Error('Invalid recovery file');
  if (
    bytes(backup.salt).byteLength !== 16 ||
    bytes(backup.iv).byteLength !== 12 ||
    (await fingerprint(backup.publicJwk)) !== backup.fingerprint
  )
    throw new Error('Recovery file fingerprint mismatch');
  const wrapping = await backupKey(passphrase, bytes(backup.salt));
  const clear = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: bytes(backup.iv),
      additionalData: encoder.encode(
        `ecom-backup:v1:${backup.keyId}:${backup.fingerprint}`,
      ),
      tagLength: 128,
    },
    wrapping,
    bytes(backup.ciphertext),
  );
  const jwk = JSON.parse(new TextDecoder().decode(clear)) as JsonWebKey;
  if (jwk.n !== backup.publicJwk.n || jwk.e !== backup.publicJwk.e)
    throw new Error('Recovery key mismatch');
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
  return {
    privateKey,
    keyId: backup.keyId,
    fingerprint: backup.fingerprint,
    recoveryEnvelope: recovery
      ? await encryptKeyRecovery(
          jwk,
          backup.keyId,
          recovery.userId,
          recovery.publicKey,
        )
      : undefined,
  };
}
export async function encryptContact(
  input: ContactPayload,
  key: ContactKey,
): Promise<MessageEnvelope> {
  if (!uuid(key.id) || (await fingerprint(key.publicJwk)) !== key.fingerprint)
    throw new Error('Inbox public key fingerprint mismatch');
  const payload = contactPayload(input);
  const id = crypto.randomUUID();
  const secret = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  );
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    key.publicJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(`ecom-contact:v1:${key.id}:${id}`),
      tagLength: 128,
    },
    secret,
    encoder.encode(JSON.stringify(payload)),
  );
  const wrapped = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    await crypto.subtle.exportKey('raw', secret),
  );
  return {
    version: 1,
    id,
    keyId: key.id,
    iv: b64(iv.buffer),
    ciphertext: b64(ciphertext),
    wrappedKey: b64(wrapped),
  };
}
export async function decryptContact(
  envelope: MessageEnvelope,
  keyId: string,
  privateKey: CryptoKey,
) {
  if (envelope.version !== 1 || envelope.keyId !== keyId || !uuid(envelope.id))
    throw new Error('Unlock the recovery key for this message');
  const raw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    bytes(envelope.wrappedKey),
  );
  const secret = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const clear = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: bytes(envelope.iv),
      additionalData: encoder.encode(`ecom-contact:v1:${keyId}:${envelope.id}`),
      tagLength: 128,
    },
    secret,
    bytes(envelope.ciphertext),
  );
  return contactPayload(JSON.parse(new TextDecoder().decode(clear)));
}

export interface ConversationEnvelope {
  version: 2;
  id: string;
  conversationId: string;
  senderId: string;
  customerKeyId: string;
  adminKeyId: string;
  iv: string;
  ciphertext: string;
  customerWrappedKey: string;
  adminWrappedKey: string;
}
function conversationAAD(
  e: Pick<
    ConversationEnvelope,
    'id' | 'conversationId' | 'senderId' | 'customerKeyId' | 'adminKeyId'
  >,
) {
  return encoder.encode(
    `ecom-conversation:v2:${e.conversationId}:${e.id}:${e.senderId}:${e.customerKeyId}:${e.adminKeyId}`,
  );
}
export async function encryptReply(
  message: string,
  conversationId: string,
  senderId: string,
  customer: ContactKey,
  admin: ContactKey,
): Promise<ConversationEnvelope> {
  const body = message.trim();
  if (!body || body.length > 5000)
    throw new Error('Write a message between 1 and 5,000 characters.');
  if (!uuid(conversationId) || !uuid(senderId))
    throw new Error('Invalid conversation');
  const recipients = await Promise.all(
    [customer, admin].map(async (k) => {
      if (!uuid(k.id) || (await fingerprint(k.publicJwk)) !== k.fingerprint)
        throw new Error('Recipient fingerprint mismatch');
      return crypto.subtle.importKey(
        'jwk',
        k.publicJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['encrypt'],
      );
    }),
  );
  const secret = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  );
  const raw = await crypto.subtle.exportKey('raw', secret);
  const header = {
    version: 2 as const,
    id: crypto.randomUUID(),
    conversationId,
    senderId,
    customerKeyId: customer.id,
    adminKeyId: admin.id,
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const [ciphertext, customerWrappedKey, adminWrappedKey] = await Promise.all([
    crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: conversationAAD(header),
        tagLength: 128,
      },
      secret,
      encoder.encode(JSON.stringify({ message: body })),
    ),
    crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipients[0]!, raw),
    crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipients[1]!, raw),
  ]);
  return {
    ...header,
    iv: b64(iv.buffer),
    ciphertext: b64(ciphertext),
    customerWrappedKey: b64(customerWrappedKey),
    adminWrappedKey: b64(adminWrappedKey),
  };
}
export async function decryptReply(
  envelope: ConversationEnvelope,
  keyId: string,
  privateKey: CryptoKey,
) {
  if (
    envelope.version !== 2 ||
    !uuid(envelope.id) ||
    !uuid(envelope.conversationId) ||
    !uuid(envelope.senderId)
  )
    throw new Error('Invalid encrypted message');
  const wrapped =
    keyId === envelope.customerKeyId
      ? envelope.customerWrappedKey
      : keyId === envelope.adminKeyId
        ? envelope.adminWrappedKey
        : null;
  if (!wrapped)
    throw new Error('Import the recovery key for this conversation.');
  const raw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    bytes(wrapped),
  );
  const secret = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const clear = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: bytes(envelope.iv),
      additionalData: conversationAAD(envelope),
      tagLength: 128,
    },
    secret,
    bytes(envelope.ciphertext),
  );
  const value = JSON.parse(new TextDecoder().decode(clear)) as {
    message: unknown;
  };
  if (
    typeof value.message !== 'string' ||
    !value.message.trim() ||
    value.message.length > 5000
  )
    throw new Error('Invalid message content');
  return value.message;
}

export interface RecoveryEnvelope {
  version: 3;
  keyId: string;
  recoveryKeyId: string;
  userId: string;
  iv: string;
  wrappedKey: string;
  ciphertext: string;
}
async function encryptKeyRecovery(
  privateJwk: JsonWebKey,
  keyId: string,
  userId: string,
  recipient: ContactKey,
): Promise<RecoveryEnvelope> {
  if ((await fingerprint(recipient.publicJwk)) !== recipient.fingerprint)
    throw new Error('Recovery service fingerprint mismatch');
  const secret = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  );
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    recipient.publicJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const [ciphertext, wrappedKey] = await Promise.all([
    crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: encoder.encode(
          `ecom-key-recovery:v1:${userId}:${keyId}:${recipient.id}`,
        ),
        tagLength: 128,
      },
      secret,
      encoder.encode(JSON.stringify(privateJwk)),
    ),
    crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      await crypto.subtle.exportKey('raw', secret),
    ),
  ]);
  return {
    version: 3,
    keyId,
    recoveryKeyId: recipient.id,
    userId,
    iv: b64(iv.buffer),
    wrappedKey: b64(wrappedKey),
    ciphertext: b64(ciphertext),
  };
}
