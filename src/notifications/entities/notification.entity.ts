import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NotificationDelivery } from './notification-delivery.entity';

/**
 * Notificación lógica: representa "un aviso a un usuario", independiente del canal.
 * Por cada notificación se crean una o varias filas en `notification_deliveries`
 * (una por canal). También funciona como bandeja de entrada in-app (campo `read_at`).
 *
 * `dedup_key` es la clave de idempotencia: cuando un evento del bus llega duplicado
 * (mismo `idempotencyKey` o misma combinación routingKey+entidad), no se crea una
 * notificación nueva. Los eventos pueden llegar duplicados.
 */
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_notifications_recipient')
  @Column({ name: 'recipient_user_id', type: 'uuid', nullable: true })
  recipientUserId?: string | null;

  /** Tipo/plantilla de la notificación, ej. `user.welcome`, `order.created`. */
  @Column({ type: 'varchar' })
  type: string;

  /** Routing key del evento que la originó (null si fue un envío directo). */
  @Column({ name: 'source_event', type: 'varchar', nullable: true })
  sourceEvent?: string | null;

  /** Servicio que originó la notificación, ej. `order`, `financial`. */
  @Column({ name: 'source_service', type: 'varchar', nullable: true })
  sourceService?: string | null;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text' })
  body: string;

  /** Datos extra para la app (deep-link, ids, etc.). */
  @Column({ type: 'jsonb', nullable: true })
  data?: Record<string, unknown> | null;

  /** URL de imagen (QR, comprobante) — se persiste para poder reconstruirla en reintentos. */
  @Column({ name: 'image_url', type: 'varchar', nullable: true })
  imageUrl?: string | null;

  @Index('idx_notifications_dedup_key', { unique: true })
  @Column({ name: 'dedup_key', type: 'varchar', nullable: true })
  dedupKey?: string | null;

  /** Fecha de lectura en la bandeja in-app; null mientras esté sin leer. */
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt?: Date | null;

  @OneToMany(() => NotificationDelivery, (delivery) => delivery.notification)
  deliveries: NotificationDelivery[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
