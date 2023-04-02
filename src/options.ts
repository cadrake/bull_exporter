import yargs from 'yargs';

import { version } from '../package.json';

export interface ExporterOptions {
  url: string;
  prefix: string;
  metricPrefix: string;
  once: boolean;
  port: number;
  bindAddress: string;
  autoDiscover: boolean;
  caCertFile: string;
  clientCertFile: string;
  clientPrivateKeyFile: string;
  username: string;
  password: string;
  queues: string[];
}

class OptionsBuilderFactory {
  static newOptions(): OptionsBuilder {
    return new OptionsBuilder();
  }
}

class OptionsBuilder {
  opts: ExporterOptions

  constructor() {
    // Defaults for the options
    this.opts = {
      url: 'redis://127.0.0.1:6379',
      prefix: 'bull',
      metricPrefix: 'bull_queue_',
      once: false,
      port: 9538,
      bindAddress: '0.0.0.0',
      autoDiscover: false,
      caCertFile: '',
      clientCertFile: '',
      clientPrivateKeyFile: '',
      username: '',
      password: '',
      queues: [],
    } as ExporterOptions;
  }

  readEnv(): OptionsBuilder {
    const envOptions = Object.fromEntries(Object.entries({
      url: process.env.EXPORTER_REDIS_URL,
      prefix: process.env.EXPORTER_PREFIX,
      metricPrefix: process.env.EXPORTER_STAT_PREFIX,
      port: process.env.EXPORTER_PORT,
      bindAddress: process.env.EXPORTER_BIND_ADDRESS,
      autoDiscover: (process.env.EXPORTER_AUTODISCOVER === 'true'),
      caCertFile: process.env.EXPORTER_CA_CERT_FILE,
      clientCertFile: process.env.EXPORTER_CLIENT_CERT_FILE,
      clientPrivateKeyFile: process.env.EXPORTER_CLIENT_PRIVATE_KEY_FILE,
      username: process.env.EXPORTER_AUTH_USER,
      password: process.env.EXPORTER_AUTH_PASSWORD,
      queues: process?.env?.EXPORTER_QUEUES?.split(',').map((str) => str.trim()),
    }).filter(([_, v]) => v != null));

    Object.assign(this.opts, envOptions);

    return this;
  }

  updateFromArgs(...args: string[]): OptionsBuilder {
    const cliOptions = yargs.version(version)
      .alias('V', 'version')
      .options({
        url: {
          alias: 'u',
          description: 'A redis connection url',
        },
        prefix: {
          alias: 'f',
          description: 'Prefix of all bull queues to monitor'
        },
        metricPrefix: {
          alias: 'm',
          description: 'prefix for all exported metrics',
        },
        once: {
          alias: 'n',
          type: 'boolean',
          description: 'Print stats and exit without starting a server',
        },
        port: {
          description: 'Port to expose metrics on'
        },
        autoDiscover: {
          alias: 'a',
          description: 'Set to auto discover bull queues',
          type: 'boolean',
        },
        queues: {
          alias: 'q',
          type: 'array',
          description: 'Comma separated list of queues to monitor',
          coerce: arr => {
            return arr.flatMap((v: string) => v.split(','));
          },
        },
        bindAddress: {
          alias: 'b',
          description: 'Address to listen on',
        },
        caCertFile: {
          description: 'Additional certificate authority certificates to load when starting the exporter',
        },
        clientCertFile: {
          description: 'Client certificate for tls connections with Redis',
        },
        clientPrivateKeyFile: {
          description: 'Client private key for tls connections with Redis',
        },
        username: {
          alias: 'u',
          description: 'User name to use when interacting with Redis AUTH commands',
        },
        password: {
          alias: 'p',
          description: 'Password to use when interacting with Redis AUTH commands',
        },
      }).parse(args);

    Object.assign(this.opts, cliOptions);

    return this;
  }

  values(): ExporterOptions {
    return this.opts
  }
}

export { OptionsBuilderFactory as Options }
