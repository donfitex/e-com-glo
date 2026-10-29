const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const object = (
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
) => ({ type: 'object', properties, required, additionalProperties: false });
const text = { type: 'string' };
const uuid = { type: 'string', format: 'uuid' };
const identifier = { name: 'id', in: 'path', required: true, schema: uuid };
const secured = (summary: string, schema?: unknown, status = '200') => ({
  summary,
  security: [{ BearerAuth: [] }],
  ...(schema ? { requestBody: json(schema) } : {}),
  responses: {
    [status]: { description: 'Success' },
    '400': {
      description: 'Invalid request',
      content: { 'application/json': { schema: ref('Error') } },
    },
    '401': { description: 'Authentication required' },
    '403': { description: 'Insufficient role' },
    '409': { description: 'State or inventory conflict' },
    '429': { description: 'Rate limited; inspect Retry-After' },
    '503': { description: 'Dependency unavailable' },
  },
});
const publicOperation = (
  summary: string,
  schema?: unknown,
  status = '200',
) => ({ ...secured(summary, schema, status), security: [] });
const item = (operation: unknown) => ({
  parameters: [identifier],
  ...(operation as object),
});
const address = object(
  {
    name: { ...text, maxLength: 120 },
    email: { ...text, format: 'email' },
    phone: {
      ...text,
      description: 'International number with country code; spacing normalized',
      example: '+2348012345678',
    },
    line1: text,
    line2: text,
    city: text,
    region: text,
    postalCode: text,
    country: { ...text, pattern: '^[A-Z]{2}$', example: 'NG' },
  },
  ['name', 'email', 'phone', 'line1', 'city', 'postalCode', 'country'],
);
const product = object(
  {
    sku: text,
    name: text,
    description: text,
    price: { type: 'integer', minimum: 0, maximum: 1000000000 },
    currency: {
      type: 'string',
      enum: ['NGN', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR'],
    },
    stock: { type: 'integer', minimum: 0 },
    categoryId: uuid,
    active: { type: 'boolean' },
    attributes: {
      type: 'object',
      additionalProperties: { type: 'string', maxLength: 500 },
    },
  },
  ['sku', 'name', 'description', 'price', 'currency', 'stock', 'categoryId'],
);
export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'E-com Global API',
    version: '1.1.0',
    description:
      'Integer minor-unit pricing, one currency per order. CUSTOMER/ADMIN JWT roles. Paystack is test-only. Browser clients use the same-origin /api/commerce BFF and its HTTP-only session cookie; never put JWTs in browser storage. Documented /api/v1 paths are backend paths. See README for shipping configuration and release instructions.',
  },
  tags: [{ name: 'Commerce' }, { name: 'Operations' }],
  paths: {
    '/health': { get: publicOperation('Shallow service liveness') },
    '/ready': { get: publicOperation('PostgreSQL and Redis readiness') },
    '/api/v1/openapi.json': { get: publicOperation('This OpenAPI contract') },
    '/api/v1/auth/register': {
      post: publicOperation(
        'Register a customer',
        object({
          name: text,
          email: { ...text, format: 'email' },
          password: { ...text, minLength: 12, maxLength: 128 },
        }),
        '201',
      ),
    },
    '/api/v1/auth/login': {
      post: publicOperation(
        'Login; five attempts per normalized account per 900 seconds',
        object({
          email: { ...text, format: 'email' },
          password: { ...text, minLength: 12, maxLength: 128 },
        }),
      ),
    },
    '/api/v1/auth/me': { get: secured('Current account') },
    '/api/v1/categories': {
      get: publicOperation('List categories'),
      post: secured(
        'Admin: create category',
        object({ name: text, slug: text }),
        '201',
      ),
    },
    '/api/v1/categories/{id}': item({
      patch: secured(
        'Admin: update category',
        object({ name: text, slug: text }),
      ),
      delete: secured('Admin: delete empty category', undefined, '204'),
    }),
    '/api/v1/products': {
      get: {
        ...publicOperation('Paginated active catalog'),
        parameters: [
          'q',
          'categoryId',
          'currency',
          'sort',
          'minPrice',
          'maxPrice',
          'available',
          'page',
          'limit',
        ].map((name) => ({ name, in: 'query', schema: { type: 'string' } })),
      },
      post: secured('Admin: create product', ref('ProductInput'), '201'),
    },
    '/api/v1/products/{id}': item({
      get: publicOperation('Active product detail'),
      patch: secured('Admin: update product; SKU currency is immutable', {
        ...product,
        required: [],
      }),
      delete: secured('Admin: deactivate product', undefined, '204'),
    }),
    '/api/v1/admin/products': {
      get: secured('Admin: paginated active and inactive products'),
    },
    '/api/v1/admin/images': {
      post: {
        ...secured('Admin: validated product photo upload', undefined, '201'),
        requestBody: {
          required: true,
          description:
            'JPEG, PNG or WebP up to 3 MiB and 20 megapixels. Re-encoded to WebP.',
          content: Object.fromEntries(
            ['image/jpeg', 'image/png', 'image/webp'].map((type) => [
              type,
              { schema: { type: 'string', format: 'binary' } },
            ]),
          ),
        },
      },
    },
    '/api/v1/media/{id}': item({
      get: {
        ...publicOperation('Immutable product image'),
        responses: {
          '200': {
            description: 'WebP bytes',
            content: {
              'image/webp': { schema: { type: 'string', format: 'binary' } },
            },
          },
          '404': { description: 'Image not found' },
        },
      },
    }),
    '/api/v1/search': {
      get: {
        ...publicOperation(
          'Product search with optional vector ranking and text fallback',
        ),
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 200 },
          },
        ],
      },
    },
    '/api/v1/cart': {
      get: secured('Current customer cart'),
      delete: secured('Clear current customer cart', undefined, '204'),
    },
    '/api/v1/cart/items': {
      post: secured(
        'Add product to cart',
        object({
          productId: uuid,
          quantity: { type: 'integer', minimum: 1, maximum: 100 },
        }),
      ),
    },
    '/api/v1/cart/items/{id}': item({
      patch: secured(
        'Update product quantity',
        object({ quantity: { type: 'integer', minimum: 1, maximum: 100 } }),
      ),
      delete: secured('Remove cart product', undefined, '204'),
    }),
    '/api/v1/checkout/options': {
      get: publicOperation(
        'Configured delivery countries/currencies and payment currencies',
      ),
    },
    '/api/v1/orders/preview': { get: secured('Current cart price preview') },
    '/api/v1/orders/quote': {
      post: secured(
        'Validated shipping/tax and delivery-window quote',
        object({ shippingAddress: ref('ShippingAddress') }),
      ),
    },
    '/api/v1/orders/checkout': {
      post: {
        ...secured(
          'Atomically persist an order, reserve stock and record OrderCreated',
          object(
            {
              shippingAddress: ref('ShippingAddress'),
              quote: object({ total: { type: 'integer' }, ruleVersion: text }),
            },
            ['shippingAddress'],
          ),
          '201',
        ),
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: {
              type: 'string',
              minLength: 8,
              maxLength: 100,
              pattern: '^[A-Za-z0-9_-]+$',
            },
          },
        ],
      },
    },
    '/api/v1/orders': { get: secured('Paginated customer-owned orders') },
    '/api/v1/orders/{id}': item({
      get: secured('Customer-owned order, items and shipment tracking'),
    }),
    '/api/v1/orders/{id}/payment': item({
      post: secured(
        'Initialize or reuse Paystack hosted checkout for the order owner',
        object({}, []),
      ),
    }),
    '/api/v1/payments/paystack/webhook': {
      post: {
        ...publicOperation(
          'Raw signed Paystack event; verification precedes payment confirmation',
          { type: 'object' },
        ),
        parameters: [
          {
            name: 'x-paystack-signature',
            in: 'header',
            required: true,
            schema: { type: 'string', pattern: '^[a-fA-F0-9]{128}$' },
          },
        ],
      },
    },
    '/api/v1/admin/orders': {
      get: secured('Admin: paginated order management'),
    },
    '/api/v1/admin/orders/{id}/status': item({
      patch: secured(
        'Admin: enforce paid fulfillment transitions and record milestones',
        object({
          status: {
            type: 'string',
            enum: ['CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
          },
        }),
      ),
    }),
    '/api/v1/admin/orders/{id}/shipment': item({
      patch: secured(
        'Admin: edit tracking for paid orders awaiting delivery',
        object(
          {
            carrier: { type: ['string', 'null'] },
            trackingNumber: { type: ['string', 'null'] },
            trackingUrl: {
              type: ['string', 'null'],
              format: 'uri',
              description: 'HTTPS without credentials',
            },
            expectedDeliveryDate: { type: 'string', format: 'date' },
          },
          [],
        ),
      ),
    }),
    '/api/v1/site-content': {
      get: publicOperation(
        'Published homepage, announcement, footer and FAQ content',
      ),
    },
    '/api/v1/admin/content': {
      get: secured('Admin: read editable storefront content and revision'),
      put: secured(
        'Admin: publish validated content with optimistic revision control',
      ),
    },
    '/api/v1/contact/key': {
      get: publicOperation(
        'Active RSA-OAEP public encryption key and fingerprint',
      ),
    },
    '/api/v1/contact/messages': {
      post: publicOperation(
        'Submit an opaque AES-GCM encrypted envelope; plaintext is rejected',
        undefined,
        '201',
      ),
    },
    '/api/v1/admin/inbox/keys': {
      get: secured(
        'Admin: public key history; private keys never reach this API',
      ),
      post: secured(
        'Admin: activate a browser-generated public key with expectedCurrentId',
        undefined,
        '201',
      ),
    },
    '/api/v1/admin/inbox/summary': {
      get: secured('Admin: unread and total message counts'),
    },
    '/api/v1/admin/inbox/messages': {
      get: secured(
        'Admin: paginated message metadata, optionally filtered by status',
      ),
    },
    '/api/v1/admin/inbox/messages/{id}': item({
      get: secured('Admin: encrypted envelope for local browser decryption'),
      patch: secured(
        'Admin: update message status',
        object({
          status: { type: 'string', enum: ['NEW', 'READ', 'RESOLVED'] },
        }),
      ),
      delete: secured(
        'Admin: permanently delete an encrypted message',
        undefined,
        '204',
      ),
    }),
    '/api/v1/conversations/key': {
      get: secured('Current participant public encryption key'),
      post: secured(
        'Customer: register an immutable public key and password-encrypted backup',
        undefined,
        '201',
      ),
    },
    '/api/v1/conversations/vault': {
      get: secured(
        'Customer: own encrypted key backup for automatic browser sign-in sync',
      ),
    },
    '/api/v1/conversations/summary': {
      get: secured(
        'Unread conversation count for the authenticated participant',
      ),
    },
    '/api/v1/conversations': {
      get: secured(
        'Paginated own conversations; administrators see customer support threads',
      ),
      post: secured(
        'Customer: create a support thread bound to both recipient public keys',
        undefined,
        '201',
      ),
    },
    '/api/v1/conversations/{id}': item({
      get: secured(
        'Authorized encrypted history, newest 50 messages; before sequence loads earlier messages',
      ),
      patch: secured(
        'Participant: resolve or reopen conversation',
        object({ resolved: { type: 'boolean' } }),
      ),
    }),
    '/api/v1/conversations/{id}/messages': item({
      post: secured(
        'Append a version 2 encrypted envelope; retries with same ID and bytes are idempotent',
        undefined,
        '201',
      ),
    }),
    '/api/v1/conversations/{id}/read': item({
      post: secured(
        'Advance own read watermark, never beyond an existing message',
        object({ sequence: { type: 'integer', minimum: 0 } }),
      ),
    }),
    '/api/v1/announcements': {
      get: secured(
        'Published business messages and enabled promotions for users registered at publication',
      ),
    },
    '/api/v1/announcements/summary': {
      get: secured('Unread announcement count'),
    },
    '/api/v1/announcements/{id}/read': item({
      post: secured('Mark one eligible announcement read for this account'),
    }),
    '/api/v1/preferences': {
      get: secured('Customer notification preferences'),
      patch: secured(
        'Enable or disable inbox promotions',
        object({ promotions: { type: 'boolean' } }),
      ),
    },
    '/api/v1/admin/broadcasts': {
      get: secured(
        'Admin: paginated announcement drafts, publications and archives',
      ),
      post: secured(
        'Admin: save or update an unpublished announcement; safe store links and uploaded image only',
        undefined,
        '201',
      ),
    },
    '/api/v1/admin/broadcasts/{id}/publish': item({
      post: secured(
        'Admin: idempotently publish to registered users’ store inboxes',
      ),
    }),
    '/api/v1/admin/broadcasts/{id}/archive': item({
      post: secured('Admin: withdraw announcement from customer inboxes'),
    }),
    '/api/v1/addresses': {
      get: secured('Own saved delivery addresses, default first'),
      post: secured(
        'Save a validated delivery address, deduplicated and capped at ten per account',
        undefined,
        '201',
      ),
    },
    '/api/v1/addresses/{id}': item({
      delete: secured(
        'Remove own saved address without changing existing orders',
        undefined,
        '204',
      ),
    }),
    '/api/v1/addresses/{id}/default': item({
      patch: secured('Set own default delivery destination'),
    }),
    '/api/v1/wishlist': {
      get: secured(
        'Paginated saved products belonging to the authenticated customer',
      ),
    },
    '/api/v1/wishlist/ids': {
      get: secured('Saved product identifiers for the authenticated customer'),
    },
    '/api/v1/wishlist/{id}': item({
      post: secured(
        'Idempotently save an active product; at most 200 per customer',
      ),
      delete: secured(
        'Remove an item from the authenticated customer’s saved products',
        undefined,
        '204',
      ),
    }),
    '/api/v1/admin/events': {
      get: secured('Admin: recent durable dead-letter events'),
    },
    '/api/v1/admin/events/{id}/retry': item({
      post: secured(
        'Admin: record an audited dead-letter redrive',
        undefined,
        '202',
      ),
    }),
    '/api/v1/admin/health': {
      get: secured(
        'Admin: dependency timing, worker heartbeat, queue and memory diagnostics',
      ),
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      ShippingAddress: address,
      ProductInput: product,
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            properties: { code: text, message: text, requestId: text },
          },
        },
      },
    },
  },
};
