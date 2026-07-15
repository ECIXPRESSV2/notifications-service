import { registerAs } from '@nestjs/config';

/**
 * Configuración general de la aplicación.
 *
 * `frontendUrl` es la URL base del front de ECIExpress; las plantillas de correo la
 * usan para construir enlaces (ej. "Ver mi billetera"). Llega por la variable de entorno
 * FRONTEND_URL; en desarrollo apunta al Vite local. Al desplegar, basta con cambiar la
 * variable de entorno (sin tocar plantillas ni código).
 */
export const appConfig = registerAs('app', () => ({
  frontendUrl: (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  wakeupEmail: process.env.WAKEUP_REPORT_EMAIL,
  /** Cron del job de reintento de entregas FAILED/SKIPPED(recipient_offline). Cada 5 min. */
  retryJobCron: process.env.RETRY_JOB_CRON ?? '*/5 * * * *',
  /** Ventana hacia atrás (minutos) de entregas candidatas a reintento. */
  retryWindowMinutes: Number(process.env.RETRY_WINDOW_MINUTES ?? 30),
  /** Tope de intentos totales por entrega (evita reintentar por siempre algo que sigue fallando). */
  retryMaxAttempts: Number(process.env.RETRY_MAX_ATTEMPTS ?? 4),
}));
