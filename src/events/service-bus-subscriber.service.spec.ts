import { ConfigService } from '@nestjs/config';
import { ServiceBusClient } from '@azure/service-bus';
import { EventConsumerService } from './event-consumer.service';
import { ServiceBusSubscriberService } from './service-bus-subscriber.service';

describe('ServiceBusSubscriberService', () => {
  function build() {
    const handlers: { processMessage?: (m: unknown) => Promise<void>; processError?: (a: unknown) => Promise<void> } = {};
    const receiver = {
      subscribe: jest.fn((h: typeof handlers) => Object.assign(handlers, h)),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const client = { createReceiver: jest.fn().mockReturnValue(receiver) } as unknown as ServiceBusClient;
    const config = {
      getOrThrow: (k: string) => (k === 'serviceBus.topic' ? 'eciexpress_events' : 'notifications-service'),
    } as unknown as ConfigService;
    const consumer = { handleEvent: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<EventConsumerService>;
    return {
      subscriber: new ServiceBusSubscriberService(client, config, consumer),
      client,
      receiver,
      handlers,
      consumer,
    };
  }

  it('crea el receiver sobre topic+subscription y se suscribe', () => {
    const { subscriber, client, receiver } = build();
    subscriber.onModuleInit();
    expect(client.createReceiver).toHaveBeenCalledWith('eciexpress_events', 'notifications-service');
    expect(receiver.subscribe).toHaveBeenCalled();
  });

  it('processMessage delega en el consumer con el subject como routingKey', async () => {
    const { subscriber, handlers, consumer } = build();
    subscriber.onModuleInit();
    await handlers.processMessage!({ subject: 'fulfillment.qr.generated', body: { orderId: 'o1' } });
    expect(consumer.handleEvent).toHaveBeenCalledWith('fulfillment.qr.generated', { orderId: 'o1' });
  });

  it('processMessage cae a applicationProperties.routingKey si no hay subject', async () => {
    const { subscriber, handlers, consumer } = build();
    subscriber.onModuleInit();
    await handlers.processMessage!({ applicationProperties: { routingKey: 'order.order.created' }, body: {} });
    expect(consumer.handleEvent).toHaveBeenCalledWith('order.order.created', {});
  });

  it('processError no lanza', async () => {
    const { subscriber, handlers } = build();
    subscriber.onModuleInit();
    await expect(
      handlers.processError!({ entityPath: 'x', error: new Error('boom') }),
    ).resolves.toBeUndefined();
  });

  it('onModuleDestroy cierra el receiver', async () => {
    const { subscriber, receiver } = build();
    subscriber.onModuleInit();
    await subscriber.onModuleDestroy();
    expect(receiver.close).toHaveBeenCalled();
  });
});
