import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { google } from 'googleapis';
import { sendViaGmailApi } from '../channels/email.channel';

interface ServiceCheck {
  name: string;
  url: string;
  status: 'UP' | 'DOWN' | 'TIMEOUT';
  responseTimeMs: number;
}

const SERVICE_MAP: Record<string, string> = {
  'notifications-service': 'SERVICE_NOTIFICATIONS_URL',
  'identity-service': 'SERVICE_IDENTITY_URL',
  'financial-service': 'SERVICE_FINANCIAL_URL',
  'orders-service': 'SERVICE_ORDERS_URL',
  'products-service': 'SERVICE_PRODUCTS_URL',
  'fulfillment-service': 'SERVICE_FULFILLMENT_URL',
  'reporting-service': 'SERVICE_REPORTING_URL',
};

const WAKE_TRIGGER_TIMEOUT_MS = 5_000;   // solo dispara el cold start, no espera respuesta
const COLD_START_WAIT_MS = 90_000;        // pausa fija mientras Render arranca los servicios
const HEALTH_CHECK_TIMEOUT_MS = 20_000;  // timeout final para verificar que están UP

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

@Injectable()
export class WakeupService {
  private readonly logger = new Logger(WakeupService.name);

  constructor(private readonly config: ConfigService) {}

  async pingAndNotify(): Promise<void> {
    const services = this.resolveServices();

    if (!services.length) {
      this.logger.warn('No hay URLs de servicio configuradas (SERVICE_*_URL).');
      return;
    }

    // Fase 1: disparar una petición corta a cada servicio para activar el cold start.
    // Se intenta /health y / para cubrir servicios que no exponen /health.
    this.logger.log(`[Fase 1] Disparando señales de wakeup a ${services.length} servicio(s)...`);
    await Promise.allSettled(
      services.flatMap((s) => [
        axios.get(`${s.url}/health`, { timeout: WAKE_TRIGGER_TIMEOUT_MS }).catch(() => {}),
        axios.get(`${s.url}/`, { timeout: WAKE_TRIGGER_TIMEOUT_MS }).catch(() => {}),
      ]),
    );

    // Fase 2: esperar a que Render levante los servicios
    this.logger.log(
      `[Fase 2] Esperando ${COLD_START_WAIT_MS / 1000}s para que los servicios arranquen...`,
    );
    await sleep(COLD_START_WAIT_MS);

    // Fase 3: verificar cuáles respondieron
    this.logger.log(`[Fase 3] Verificando estado de los servicios...`);
    const results = await Promise.all(services.map((s) => this.checkService(s)));

    const upCount = results.filter((r) => r.status === 'UP').length;
    this.logger.log(`Wakeup completado: ${upCount}/${results.length} servicios activos.`);

    await this.sendReport(results);
  }

  private resolveServices(): { name: string; url: string }[] {
    return Object.entries(SERVICE_MAP)
      .map(([name, envKey]) => ({ name, url: process.env[envKey]?.replace(/\/$/, '') ?? '' }))
      .filter((s) => Boolean(s.url));
  }

  private async checkService(service: { name: string; url: string }): Promise<ServiceCheck> {
    const start = Date.now();
    // Intenta /health primero; si no existe (404/timeout) cae a la raíz /.
    // Necesario porque no todos los microservicios exponen /health.
    for (const path of ['/health', '/']) {
      try {
        await axios.get(`${service.url}${path}`, { timeout: HEALTH_CHECK_TIMEOUT_MS });
        this.logger.log(`[${service.name}] UP via ${path} (${Date.now() - start}ms)`);
        return { ...service, status: 'UP', responseTimeMs: Date.now() - start };
      } catch (err) {
        if (!axios.isAxiosError(err)) {
          this.logger.warn(`[${service.name}] DOWN — ${(err as Error).message}`);
          return { ...service, status: 'DOWN', responseTimeMs: Date.now() - start };
        }
        // 404 en /health → probar / en siguiente iteración; cualquier otro error → DOWN
        if (path === '/health' && err.response?.status === 404) continue;
        const reason = `${err.code ?? err.response?.status ?? 'error'}`;
        this.logger.warn(`[${service.name}] DOWN via ${path} (${reason})`);
        return { ...service, status: 'DOWN', responseTimeMs: Date.now() - start };
      }
    }
    return { ...service, status: 'DOWN', responseTimeMs: Date.now() - start };
  }

  private async sendReport(results: ServiceCheck[]): Promise<void> {
    const clientId = this.config.get<string>('channels.email.gmailClientId');
    const clientSecret = this.config.get<string>('channels.email.gmailClientSecret');
    const refreshToken = this.config.get<string>('channels.email.gmailRefreshToken');
    const from = this.config.get<string>('channels.email.from')!;
    const to = this.config.get<string>('app.wakeupEmail');

    if (!to) {
      this.logger.warn('WAKEUP_REPORT_EMAIL no configurado. Se omite el envío del reporte.');
      return;
    }

    const upCount = results.filter((r) => r.status === 'UP').length;
    const subject = `[ECIExpress] Wakeup Report - ${upCount}/${results.length} servicios activos`;
    const html = this.buildHtml(results);

    if (!clientId || !clientSecret || !refreshToken) {
      this.logger.log(
        `[SANDBOX EMAIL] Para: ${to} | Asunto: ${subject}\n` +
          results.map((r) => `  ${r.name}: ${r.status}`).join('\n'),
      );
      return;
    }

    try {
      const auth = new google.auth.OAuth2(clientId, clientSecret);
      auth.setCredentials({ refresh_token: refreshToken });
      await sendViaGmailApi(auth, { from, to, subject, html });
      this.logger.log(`Reporte de wakeup enviado a ${to}.`);
    } catch (err) {
      this.logger.error(`Error al enviar el reporte de wakeup: ${err}`);
    }
  }

  private buildHtml(results: ServiceCheck[]): string {
    const upCount = results.filter((r) => r.status === 'UP').length;
    const downCount = results.length - upCount;
    const timestamp = new Date().toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      dateStyle: 'long',
      timeStyle: 'medium',
    });

    const serviceRows = results
      .map((r) => {
        const isUp = r.status === 'UP';
        const dotColor = isUp ? '#22c55e' : '#ef4444';
        const statusLabel = isUp ? 'En línea' : r.status === 'TIMEOUT' ? 'Sin respuesta' : 'Caído';
        const timeLabel = isUp
          ? `${r.responseTimeMs.toLocaleString('es-CO')} ms`
          : '—';

        return `
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#1e293b;font-weight:500;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};margin-right:10px;vertical-align:middle;"></span>
            ${r.name}
          </td>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;text-align:center;">
            <span style="
              display:inline-block;
              padding:4px 12px;
              border-radius:20px;
              font-size:12px;
              font-weight:600;
              letter-spacing:0.5px;
              background:${isUp ? '#dcfce7' : '#fee2e2'};
              color:${isUp ? '#15803d' : '#b91c1c'};
            ">
              ${isUp ? '✅' : '❌'}&nbsp;&nbsp;${statusLabel}
            </span>
          </td>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;color:${isUp ? '#64748b' : '#94a3b8'};">
            ${timeLabel}
          </td>
        </tr>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Wakeup Report — ECIExpress</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="
              background:linear-gradient(135deg,#1e3a5f 0%,#0f2d4a 60%,#0a1f35 100%);
              border-radius:16px 16px 0 0;
              padding:40px 40px 36px;
              text-align:center;
            ">
              <div style="
                display:inline-block;
                background:rgba(255,255,255,0.1);
                border:1px solid rgba(255,255,255,0.2);
                border-radius:12px;
                padding:8px 20px;
                margin-bottom:20px;
              ">
                <span style="color:#93c5fd;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
                  Sistema de Infraestructura
                </span>
              </div>
              <h1 style="margin:0 0 8px;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">
                Wakeup Report
              </h1>
              <p style="margin:0;color:#94a3b8;font-size:14px;">
                ECIExpress Microservices — Render Deployment
              </p>
            </td>
          </tr>

          <!-- SUMMARY CARDS -->
          <tr>
            <td style="background:#ffffff;padding:32px 40px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="48%" style="
                    background:#f0fdf4;
                    border:1px solid #bbf7d0;
                    border-radius:12px;
                    padding:20px 24px;
                    text-align:center;
                  ">
                    <div style="font-size:36px;font-weight:800;color:#15803d;line-height:1;">${upCount}</div>
                    <div style="font-size:12px;font-weight:600;color:#166534;margin-top:6px;text-transform:uppercase;letter-spacing:1px;">Activos</div>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" style="
                    background:${downCount > 0 ? '#fef2f2' : '#f8fafc'};
                    border:1px solid ${downCount > 0 ? '#fecaca' : '#e2e8f0'};
                    border-radius:12px;
                    padding:20px 24px;
                    text-align:center;
                  ">
                    <div style="font-size:36px;font-weight:800;color:${downCount > 0 ? '#b91c1c' : '#94a3b8'};line-height:1;">${downCount}</div>
                    <div style="font-size:12px;font-weight:600;color:${downCount > 0 ? '#991b1b' : '#94a3b8'};margin-top:6px;text-transform:uppercase;letter-spacing:1px;">Con fallas</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- DIVIDER -->
          <tr>
            <td style="background:#ffffff;padding:0 40px 8px;">
              <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;border-top:1px solid #f1f5f9;padding-top:20px;">
                Estado de los servicios
              </div>
            </td>
          </tr>

          <!-- TABLE -->
          <tr>
            <td style="background:#ffffff;padding:0 40px 16px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                <thead>
                  <tr style="background:#f8fafc;">
                    <th style="padding:12px 20px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid #e2e8f0;">
                      Servicio
                    </th>
                    <th style="padding:12px 20px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid #e2e8f0;">
                      Estado
                    </th>
                    <th style="padding:12px 20px;text-align:right;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid #e2e8f0;">
                      Tiempo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  ${serviceRows}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- NOTE -->
          <tr>
            <td style="background:#ffffff;padding:8px 40px 32px;">
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
                ⏱ Los tiempos de respuesta reflejan el arranque en frío desde Render Free Tier.
                Un tiempo elevado es normal si el servicio estaba inactivo.
              </p>
            </td>
          </tr>

          <!-- TIMESTAMP BANNER -->
          <tr>
            <td style="
              background:#1e293b;
              padding:20px 40px;
              text-align:center;
            ">
              <p style="margin:0;font-size:12px;color:#64748b;">
                Reporte generado el&nbsp;<strong style="color:#94a3b8;">${timestamp}</strong>
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="
              background:#0f172a;
              border-radius:0 0 16px 16px;
              padding:24px 40px;
              text-align:center;
            ">
              <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#3b82f6;letter-spacing:0.5px;">
                ECIExpress
              </p>
              <p style="margin:0;font-size:11px;color:#475569;">
                Plataforma de notificaciones &mdash; Generado automáticamente &mdash; No responder este correo
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
  }
}
