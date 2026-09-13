import { Inject, Injectable, Optional } from '@nestjs/common';

// Coolify — единственный оркестратор контейнеров тенантов (спека §2). Никакого Docker API напрямую.
// Формы запросов/ответов — предположения из брифа Task 6, не проверены на живом API (Step 1 пропущен —
// нет токена write+deploy). См. docs/research/2026-09-13-coolify-services-api.md — перепроверить в Task 13.

export const COOLIFY_FETCH = 'COOLIFY_FETCH';
export const CLOUD_IMAGE = 'ghcr.io/bogbuk/loadlens-cloud-browser';

export class CoolifyError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

// Compose одного тенанта (спека §2). Лимиты — только здесь: UI-лимиты Coolify на compose не действуют.
export function renderCompose(p: { userId: string; instanceId: string; imageTag: string }): string {
  const host = `ll-${p.userId.slice(0, 8)}`;
  return [
    'services:',
    '  browser:',
    `    image: ${CLOUD_IMAGE}:${p.imageTag}`,
    `    hostname: ${host}`,
    '    environment:',
    '      - SERVICE_FQDN_BROWSER_6080',
    '      - NOVNC_PASSWORD=${NOVNC_PASSWORD}',
    '      - START_URL=https://one.dat.com/search-loads',
    '      - SCREEN=1440x900x24',
    `      - LL_INSTANCE_ID=${p.instanceId}`,
    '    volumes:',
    '      - profile:/data',
    '    shm_size: 512m',
    '    mem_limit: 2g',
    '    cpus: 1',
    '    pids_limit: 512',
    '    restart: unless-stopped',
    'volumes:',
    '  profile:',
    '',
  ].join('\n');
}

@Injectable()
export class CoolifyService {
  constructor(@Optional() @Inject(COOLIFY_FETCH) private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  get configured(): boolean { return !!process.env.COOLIFY_API_URL; }

  private async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.configured) throw new CoolifyError('cloud is not configured', 503);
    const res = await this.fetchFn(`${process.env.COOLIFY_API_URL}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.COOLIFY_API_TOKEN || ''}`,
        'Content-Type': 'application/json', Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new CoolifyError(`coolify ${method} ${path} → ${res.status} ${text.slice(0, 200)}`, res.status);
    }
    return res.json().catch(() => ({})) as Promise<T>;
  }

  async createService(p: { name: string; compose: string }): Promise<{ uuid: string }> {
    const r = await this.request<{ uuid: string }>('POST', '/services', {
      type: 'docker-compose-empty',
      name: p.name,
      server_uuid: process.env.COOLIFY_CLOUD_SERVER_UUID,
      project_uuid: process.env.COOLIFY_CLOUD_PROJECT_UUID,
      environment_name: process.env.COOLIFY_CLOUD_ENV_NAME || 'production',
      docker_compose_raw: Buffer.from(p.compose).toString('base64'),
      instant_deploy: false, // сначала env NOVNC_PASSWORD, потом start
    });
    return { uuid: r.uuid };
  }
  setEnv(uuid: string, key: string, value: string): Promise<void> {
    return this.request('POST', `/services/${uuid}/envs`, { key, value, is_preview: false });
  }
  start(uuid: string): Promise<void> { return this.request('POST', `/services/${uuid}/start`); }
  stop(uuid: string): Promise<void> { return this.request('POST', `/services/${uuid}/stop`); }
  restart(uuid: string): Promise<void> { return this.request('POST', `/services/${uuid}/restart`); }
  deleteService(uuid: string, o: { deleteVolumes: boolean }): Promise<void> {
    return this.request('DELETE', `/services/${uuid}?delete_volumes=${o.deleteVolumes}`);
  }
  // FQDN экрана, выданный Coolify по SERVICE_FQDN_BROWSER_6080 (после первого деплоя). Без схемы.
  async getFqdn(uuid: string): Promise<string | null> {
    const s = await this.request<{ applications?: Array<{ fqdn?: string | null }> }>('GET', `/services/${uuid}`);
    const fqdn = s.applications?.[0]?.fqdn || null;
    return fqdn ? fqdn.replace(/^https?:\/\//, '').split(',')[0].trim() : null;
  }
}
