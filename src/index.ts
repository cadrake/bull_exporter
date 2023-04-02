import promClient from 'prom-client';

import { Options, ExporterOptions } from './options';
import { logger } from './logger';
import { MetricCollector } from './metricCollector';
import { startServer } from './server';

export async function initCollector(opts: ExporterOptions): Promise<MetricCollector> {
  const collector = new MetricCollector(opts.queues, {
    logger,
    metricPrefix: opts.metricPrefix,
    redis: opts.url,
    prefix: opts.prefix,
    autoDiscover: opts.autoDiscover,
    caCertFile: opts.caCertFile,
    clientCertFile: opts.clientCertFile,
    clientPrivateKeyFile: opts.clientPrivateKeyFile,
    username: opts.username,
    password: opts.password,
  });

  logger.info('Initializing metrics collector');

  if (opts.autoDiscover) {
    logger.info('Running queue autodiscovery');
    await collector.discoverAll();
    logger.info('Queue autodiscovery complete');
  }

  return collector;
}

export async function printOnce(collector: MetricCollector): Promise<void> {
  logger.info('Updating all queues and logging metric output');

  await collector.updateAll();
  await collector.close();
  await promClient.register.metrics().then((metrics) => console.log(metrics));
}

export async function runServer(bindAddress: string, bindPort: number, collector: MetricCollector): Promise<void> {
  const { done } = await startServer(bindAddress, bindPort, collector);
  await done;
}

export async function main(...args: string[]): Promise<void> {
  logger.info('Reading configuration');

  const opts = Options.newOptions()
    .readEnv()
    .updateFromArgs(...args)
    .values();

  const collector = await initCollector(opts);

  if (opts.once) {
    await printOnce(collector);
  } else {
    await runServer(opts.bindAddress, opts.port, collector);
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
