import { CoolifyService, renderCompose, CoolifyError } from './coolify.service';

describe('renderCompose', () => {
  const yaml = renderCompose({ userId: '123e4567-e89b-12d3-a456-426614174000', instanceId: 'inst-1', imageTag: 'sha-abc' });
  it('образ с тегом, фиксированный hostname, LL_INSTANCE_ID, лимиты', () => {
    expect(yaml).toContain('image: ghcr.io/bogbuk/loadlens-cloud-browser:sha-abc');
    expect(yaml).toContain('hostname: ll-123e4567');
    expect(yaml).toContain('LL_INSTANCE_ID=inst-1');
    expect(yaml).toContain('SERVICE_FQDN_BROWSER_6080');
    expect(yaml).toContain('NOVNC_PASSWORD=${NOVNC_PASSWORD}');
    expect(yaml).toContain('mem_limit: 2g');
    expect(yaml).toContain('shm_size: 512m');
    expect(yaml).toContain('pids_limit: 512');
    expect(yaml).toContain('START_URL=https://one.dat.com/search-loads');
    expect(yaml).not.toContain('ports:');
  });
});

function makeService(responses: Array<{ status: number; body: any }>) {
  process.env.COOLIFY_API_URL = 'http://coolify.test';
  process.env.COOLIFY_API_TOKEN = 'tok';
  process.env.COOLIFY_CLOUD_SERVER_UUID = 'srv';
  process.env.COOLIFY_CLOUD_PROJECT_UUID = 'prj';
  const calls: Array<{ method: string; url: string; body?: any }> = [];
  const fetchFn = jest.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined });
    const r = responses.shift() || { status: 200, body: {} };
    return { ok: r.status < 400, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  });
  return { svc: new CoolifyService(fetchFn as any), calls };
}

describe('CoolifyService', () => {
  afterEach(() => { delete process.env.COOLIFY_API_URL; });

  it('configured=false без COOLIFY_API_URL; вызовы бросают CoolifyError', async () => {
    const { svc } = makeService([]);
    delete process.env.COOLIFY_API_URL;
    expect(svc.configured).toBe(false);
    await expect(svc.start('u')).rejects.toBeInstanceOf(CoolifyError);
  });

  it('createService: POST /services с base64 compose, server/project из env, instant_deploy=false → uuid', async () => {
    const { svc, calls } = makeService([{ status: 201, body: { uuid: 'svc-1', domains: [] } }]);
    const r = await svc.createService({ name: 'll-abc', compose: 'services: {}' });
    expect(r).toEqual({ uuid: 'svc-1' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('http://coolify.test/api/v1/services');
    expect(calls[0].body.server_uuid).toBe('srv');
    expect(calls[0].body.project_uuid).toBe('prj');
    expect(calls[0].body.environment_name).toBe('production');
    expect(calls[0].body.instant_deploy).toBe(false);
    expect(calls[0].body.type).toBeUndefined(); // 4.3.18: type + docker_compose_raw → 422
    expect(Buffer.from(calls[0].body.docker_compose_raw, 'base64').toString()).toBe('services: {}');
  });

  it('createService: ответ без uuid → CoolifyError 502 (иначе POST /services/undefined/start)', async () => {
    const { svc } = makeService([{ status: 201, body: {} }]);
    await expect(svc.createService({ name: 'll-abc', compose: 'services: {}' })).rejects.toMatchObject({ status: 502 });
  });

  it('setEnv/start/stop/restart/deleteService — правильные пути и методы', async () => {
    const { svc, calls } = makeService([]);
    await svc.setEnv('s', 'NOVNC_PASSWORD', 'p');
    await svc.start('s'); await svc.stop('s'); await svc.restart('s');
    await svc.deleteService('s', { deleteVolumes: true });
    expect(calls.map((c) => `${c.method} ${c.url.replace('http://coolify.test/api/v1', '')}`)).toEqual([
      'PATCH /services/s/envs', 'POST /services/s/start', 'POST /services/s/stop', 'POST /services/s/restart',
      'DELETE /services/s?delete_volumes=true',
    ]);
    expect(calls[0].body).toEqual({ key: 'NOVNC_PASSWORD', value: 'p', is_preview: false });
  });

  it('setEnv: PATCH 404 (переменной нет) → фолбэк POST; другие ошибки — наружу', async () => {
    const { svc, calls } = makeService([{ status: 404, body: { message: 'not found' } }, { status: 201, body: {} }]);
    await svc.setEnv('s', 'K', 'v');
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'POST']);
    const bad = makeService([{ status: 500, body: {} }]);
    await expect(bad.svc.setEnv('s', 'K', 'v')).rejects.toMatchObject({ status: 500 });
  });

  it('getFqdn: берёт fqdn первого приложения сервиса без схемы; нет → null', async () => {
    const { svc } = makeService([
      { status: 200, body: { applications: [{ fqdn: 'https://browser-x.cloud.loadlens.krait.studio' }] } },
      { status: 200, body: { applications: [] } },
    ]);
    expect(await svc.getFqdn('s')).toBe('browser-x.cloud.loadlens.krait.studio');
    expect(await svc.getFqdn('s')).toBeNull();
  });

  it('ошибка HTTP → CoolifyError со статусом', async () => {
    const { svc } = makeService([{ status: 422, body: { message: 'bad' } }]);
    await expect(svc.start('s')).rejects.toMatchObject({ status: 422 });
  });

  it('сеть недоступна (fetch reject) → CoolifyError со статусом 502', async () => {
    process.env.COOLIFY_API_URL = 'http://coolify.test';
    process.env.COOLIFY_API_TOKEN = 'tok';
    process.env.COOLIFY_CLOUD_SERVER_UUID = 'srv';
    process.env.COOLIFY_CLOUD_PROJECT_UUID = 'prj';
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = new CoolifyService(fetchFn as any);
    await expect(svc.start('s')).rejects.toMatchObject({ status: 502 });
    await expect(svc.start('s')).rejects.toBeInstanceOf(CoolifyError);
  });
});
