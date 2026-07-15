import { Injectable } from '@nestjs/common';
import { loggingStorage } from './logging.context';
import { getTelemetryClient } from '../telemetry/app-insights';
import { SERVICE_NAME } from '../telemetry/service-name';

export type NotificationLogEvent =
  | 'event.received'
  | 'event.ignored'
  | 'event.duplicate'
  | 'notification.created'
  | 'notification.dispatched'
  | 'delivery.sent'
  | 'delivery.failed'
  | 'delivery.skipped'
  | 'delivery.retried'
  | 'recipient.upserted'
  | 'device.registered';

export interface NotificationLogData {
  [key: string]: unknown;
}

/**
 * Logger inyectable para eventos de notificación estructurados.
 * Incluye automáticamente el userId del contexto HTTP (vía AsyncLocalStorage).
 *
 * Emite JSON a stdout/stderr y, si Application Insights está configurado, envía el
 * evento como customEvent (trackEvent) con serviceName + userId, de modo que en AI
 * se pueda filtrar por servicio (customDimensions.serviceName) y trazar por usuario
 * (customDimensions.userId) vía KQL sobre la tabla `customEvents`.
 */
@Injectable()
export class NotificationLogger {
  private userId(): string | undefined {
    return loggingStorage.getStore()?.userId;
  }

  private emit(
    level: 'info' | 'warn' | 'error',
    event: NotificationLogEvent,
    message: string,
    data?: NotificationLogData,
  ): void {
    const userId = this.userId();
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      service: SERVICE_NAME,
      event,
      userId,
      message,
      ...data,
    };
    const out = level === 'error' ? process.stderr : process.stdout;
    out.write(JSON.stringify(entry) + '\n');
    this.toAppInsights(level, event, message, userId, data);
  }

  private toAppInsights(
    level: 'info' | 'warn' | 'error',
    event: NotificationLogEvent,
    message: string,
    userId: string | undefined,
    data?: NotificationLogData,
  ): void {
    const client = getTelemetryClient();
    if (!client) return;

    const properties: Record<string, string> = {
      serviceName: SERVICE_NAME,
      level,
      message,
    };
    if (userId) properties.userId = userId;
    for (const [key, value] of Object.entries(data ?? {})) {
      if (value === undefined || value === null) continue;
      properties[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
    }

    client.trackEvent({ name: event, properties });
  }

  logEvent(
    event: NotificationLogEvent,
    message: string,
    data?: NotificationLogData,
  ): void {
    this.emit('info', event, message, data);
  }

  warnEvent(
    event: NotificationLogEvent,
    message: string,
    data?: NotificationLogData,
  ): void {
    this.emit('warn', event, message, data);
  }

  errorEvent(
    event: NotificationLogEvent,
    message: string,
    data?: NotificationLogData,
  ): void {
    this.emit('error', event, message, data);
  }
}
