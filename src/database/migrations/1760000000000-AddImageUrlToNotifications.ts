import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * notifications.image_url: la URL de imagen (QR de retiro, comprobante de entrega) que hoy
 * solo viaja de forma transitoria (BuiltNotification -> DispatchRequest -> ChannelMessage)
 * y nunca se persistía. Sin esto, un reintento de entrega (job de reintentos) perdía la
 * imagen en canales como WHATSAPP porque no había de dónde reconstruirla.
 */
export class AddImageUrlToNotifications1760000000000 implements MigrationInterface {
  name = 'AddImageUrlToNotifications1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "image_url" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN IF EXISTS "image_url"`,
    );
  }
}
