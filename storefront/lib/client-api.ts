export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/commerce${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    cache: 'no-store',
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload.error?.code ?? 'REQUEST_FAILED',
      payload.error?.details?.length
        ? `${payload.error.message}: ${payload.error.details[0].path} ${payload.error.details[0].message}`
        : (payload.error?.message ?? 'Please try again.'),
    );
  return payload.data as T;
}
export function announceCart() {
  window.dispatchEvent(new Event('cart-changed'));
}
