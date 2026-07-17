import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { NotificationsService } from './notifications.service';

const JOB_NAME = 'notification-delivery-retry';

/**
 * Reintenta cada `retryJobCron` (default cada 5 min) las entregas recientes que quedaron en
 * FAILED o en SKIPPED por `recipient_offline` — cubre el caso de un token/proveedor caído
 * transitoriamente, o un usuario que no tenía la pestaña abierta cuando llegó el tiempo real.
 * Se registra de forma dinámica (no con `@Cron`) para leer la expresión desde la config ya
 * validada al arrancar, igual que `ExpirationScheduler` de fulfillment-service.
 */
@Injectable()
export class DeliveryRetryScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryRetryScheduler.name);
  private readonly cronExpression: string;
  private readonly windowMinutes: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly schedulerRegistry: SchedulerRegistry,
    config: ConfigService,
  ) {
    this.cronExpression = config.get<string>('app.retryJobCron')!;
    this.windowMinutes = config.get<number>('app.retryWindowMinutes')!;
    this.maxAttempts = config.get<number>('app.retryMaxAttempts')!;
  }

  onApplicationBootstrap(): void {
    const job = CronJob.from({
      cronTime: this.cronExpression,
      onTick: () => void this.run(),
    });
    this.schedulerRegistry.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`Job de reintento de entregas programado (${this.cronExpression})`);
  }

  onModuleDestroy(): void {
    try {
      this.schedulerRegistry.getCronJob(JOB_NAME).stop();
    } catch {
      // el job pudo no haberse registrado; nada que detener
    }
  }

  private async run(): Promise<void> {
    try {
      const { retried, succeeded } = await this.notificationsService.retryStaleDeliveries(
        this.windowMinutes,
        this.maxAttempts,
      );
      if (retried > 0) {
        this.logger.log(`Reintento de entregas: ${succeeded}/${retried} exitosas`);
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Error ejecutando el job de reintento de entregas');
    }
  }
}
