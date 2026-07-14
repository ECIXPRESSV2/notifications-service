import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Carga plantillas HTML organizadas por microservicio de origen.
 *
 * El routing key del evento (`financial.wallet.topup.approved`) se convierte
 * en la ruta `templates/financial/wallet.topup.approved.html`. Así cada
 * servicio mantiene sus plantillas en su propia carpeta dentro de templates/.
 *
 * Si no existe el archivo devuelve null y el canal cae a texto plano.
 */
@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);
  private readonly dir = path.join(__dirname, '..', 'templates');

  render(sourceEvent: string, vars: Record<string, unknown>): string | null {
    const file = this.resolveFile(sourceEvent);
    if (!file) return null;
    if (!fs.existsSync(file)) return null;

    try {
      let html = fs.readFileSync(file, 'utf-8');
      for (const [key, value] of Object.entries(vars)) {
        html = html.replaceAll(`{{${key}}}`, String(value ?? ''));
      }
      return html;
    } catch (err) {
      this.logger.warn(`No se pudo renderizar la plantilla ${sourceEvent}: ${err}`);
      return null;
    }
  }

  /**
   * Convierte caracteres no-ASCII a entidades HTML (&#N;) para que el
   * mensaje MIME sea 100% ASCII y no dependa de la correcta interpretación
   * del charset por parte del cliente de correo.
   */
  static toAsciiHtml(text: string): string {
    return text.replace(/[^\x00-\x7F]/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  /**
   * Convierte "financial.wallet.topup.approved"
   * en   "<dir>/financial/wallet.topup.approved.html"
   */
  private resolveFile(sourceEvent: string): string | null {
    const dot = sourceEvent.indexOf('.');
    if (dot === -1) return null;
    const service = sourceEvent.slice(0, dot);
    const eventName = sourceEvent.slice(dot + 1);
    return path.join(this.dir, service, `${eventName}.html`);
  }
}
