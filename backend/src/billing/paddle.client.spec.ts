import { PaddleClient, PaddleError } from './paddle.client';

const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data }) });
const fail = (status: number, detail: string) =>
  Promise.resolve({ ok: false, status, json: () => Promise.resolve({ error: { detail } }) });

describe('PaddleClient', () => {
  let fetchMock: jest.Mock;
  let client: PaddleClient;
  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    process.env.PADDLE_ENV = 'sandbox';
    process.env.PADDLE_API_KEY = 'key_1';
    client = new PaddleClient();
  });

  it('findCustomerByEmail: GET /customers?email= с Bearer, sandbox-хост', async () => {
    fetchMock.mockReturnValue(ok([{ id: 'ctm_1' }]));
    expect(await client.findCustomerByEmail('a@b.co')).toBe('ctm_1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sandbox-api.paddle.com/customers?email=a%40b.co');
    expect(opts.headers.Authorization).toBe('Bearer key_1');
  });

  it('findCustomerByEmail: пусто — null', async () => {
    fetchMock.mockReturnValue(ok([]));
    expect(await client.findCustomerByEmail('a@b.co')).toBeNull();
  });

  it('createTransaction: items, customer_id, custom_data.userId → checkout.url', async () => {
    fetchMock.mockReturnValue(ok({ id: 'txn_1', checkout: { url: 'https://x/checkout.html?_ptxn=txn_1' } }));
    const url = await client.createTransaction({ priceId: 'pri_1', customerId: 'ctm_1', userId: 'u1' });
    expect(url).toBe('https://x/checkout.html?_ptxn=txn_1');
    const [u, opts] = fetchMock.mock.calls[0];
    expect(u).toBe('https://sandbox-api.paddle.com/transactions');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      items: [{ price_id: 'pri_1', quantity: 1 }], customer_id: 'ctm_1', custom_data: { userId: 'u1' },
    });
  });

  it('createPortalSession: ссылка overview', async () => {
    fetchMock.mockReturnValue(ok({ urls: { general: { overview: 'https://portal/x' } } }));
    expect(await client.createPortalSession('ctm_1', 'sub_1')).toBe('https://portal/x');
    const [u, opts] = fetchMock.mock.calls[0];
    expect(u).toBe('https://sandbox-api.paddle.com/customers/ctm_1/portal-sessions');
    expect(JSON.parse(opts.body)).toEqual({ subscription_ids: ['sub_1'] });
  });

  it('cancelSubscription: effective_from immediately', async () => {
    fetchMock.mockReturnValue(ok({ id: 'sub_1', status: 'canceled' }));
    await client.cancelSubscription('sub_1');
    const [u, opts] = fetchMock.mock.calls[0];
    expect(u).toBe('https://sandbox-api.paddle.com/subscriptions/sub_1/cancel');
    expect(JSON.parse(opts.body)).toEqual({ effective_from: 'immediately' });
  });

  it('не-2xx → PaddleError со статусом и detail', async () => {
    fetchMock.mockReturnValue(fail(400, 'bad price'));
    await expect(client.createCustomer('a@b.co')).rejects.toMatchObject({ status: 400, message: 'bad price' });
    fetchMock.mockReturnValue(fail(500, 'boom'));
    await expect(client.cancelSubscription('sub_1')).rejects.toBeInstanceOf(PaddleError);
  });

  it('сеть упала → PaddleError 502', async () => {
    fetchMock.mockReturnValue(Promise.reject(new Error('ECONNRESET')));
    await expect(client.findCustomerByEmail('a@b.co')).rejects.toMatchObject({ status: 502 });
  });
});
