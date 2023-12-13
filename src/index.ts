import promClient from 'prom-client';

import { Options, ExporterOptions } from './options';
import { logger } from './logger';
import { MetricCollector, MetricCollectorOptions } from './metricCollector';
import { startServer } from './server';

export async function initCollector(opts: ExporterOptions): Promise<MetricCollector> {
  const collectorOptions = {
    logger,
    metricPrefix: opts.metricPrefix,
    redis: opts.url,
    caCertFile: opts.tls?.caCertFile || '',
    clientCertFile: opts.tls?.clientCertFile || '',
    clientPrivateKeyFile: opts.tls?.clientPrivateKeyFile || '',
    username: opts.auth?.username || '',
    password: opts.auth?.password || '',
  } as MetricCollectorOptions

  const collector = new MetricCollector(collectorOptions, opts.queueTrackers);
  logger.info('Initializing metrics collector');
  await collector.initQueueTrackers()

  return collector;
}

export async function printOnce(collector: MetricCollector): Promise<void> {
  logger.info('Updating all queues and logging metric output');

  await collector.updateAll();
  await collector.close();
  await promClient.register.metrics().then((metrics) => console.log(metrics));
}

export async function runServer(listenAddress: string, collector: MetricCollector): Promise<void> {
  const { done } = await startServer(listenAddress, collector);
  await done;
}

export async function main(...args: string[]): Promise<void> {
  const opts = Options.newOptions()
    .loadConfigFileFromEnv()
    .updateFromEnv()
    .updateFromArgs(...args)
    .values();

  const collector = await initCollector(opts);

  logger.info('Collector initialization complete')

  if (opts.once) {
    await printOnce(collector);
  } else {
    await runServer(opts.listenAddress, collector);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);

  let exitCode = 0;
  main(...args)
    .catch(() => process.exitCode = exitCode = 1)
    .then(() => {
      setTimeout(
        () => {
          logger.error('No clean exit after 5 seconds, force exit');
          process.exit(exitCode);
        },
        5000,
      ).unref();
    })
    .catch(err => {
      console.error('Error forcing exit: ', err);
      console.error(err.stack);
      process.exit(-1);
    });
}
