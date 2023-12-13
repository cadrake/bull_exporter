import YAML from 'yaml';
import yargs from 'yargs';
import { logger } from './logger';
import { version } from '../package.json';
import * as fs from 'fs';

export class ExporterOptions {
  url: string = 'redis://127.0.0.1:6379'
  listenAddress: string = '0.0.0.0:9538'
  metricPrefix: string = 'bull_queue_'
  once: boolean = false
  tls?: TlsSettings
  auth?: AuthSettings
  queueTrackers: Map<string, QueueTracker> = new Map<string, QueueTracker>()
}

export class QueueTracker {
  autoDiscover: boolean = false
  queues: string[] = []
}

class TlsSettings {
  caCertFile: string = ''
  clientCertFile: string = ''
  clientPrivateKeyFile: string = ''
}

class AuthSettings {
  username: string = ''
  password: string = ''
}

class OptionsBuilderFactory {
  static newOptions(): OptionsBuilder {
    return new OptionsBuilder();
  }
}

class OptionsBuilder {
  opts: ExporterOptions
  defaultPrefix: string;
  defaultAutoDiscover: boolean
  defaultQueues: string[]

  constructor() {
    this.opts = new ExporterOptions()
    this.defaultPrefix = "bull"
    this.defaultAutoDiscover = false
    this.defaultQueues = []
  }

  loadConfigFileFromEnv(): OptionsBuilder {
    const configFile = process.env.EXPORTER_CONFIG_FILE
    if (configFile) {
      this.readConfigFile(configFile)
    }
    return this
  }

  updateFromEnv(): OptionsBuilder {
    const envOptions = Object.fromEntries(Object.entries({
      url: process.env.EXPORTER_REDIS_URL,
      metricPrefix: process.env.EXPORTER_STAT_PREFIX,
      listenAddress: process.env.EXPORTER_LISTEN_ADDRESS,
      caCertFile: process.env.EXPORTER_CA_CERT_FILE,
      clientCertFile: process.env.EXPORTER_CLIENT_CERT_FILE,
      clientPrivateKeyFile: process.env.EXPORTER_CLIENT_PRIVATE_KEY_FILE,
    }).filter(([_, v]) => v != null))

    this.defaultPrefix = process?.env?.EXPORTER_PREFIX || this.defaultPrefix,
    this.defaultAutoDiscover = !!process?.env?.EXPORTER_AUTODISCOVER || this.defaultAutoDiscover,
    this.defaultQueues = process?.env?.EXPORTER_QUEUES?.split(',').map((str) => str.trim()) || this.defaultQueues

    if (process.env.EXPORTER_AUTH_USER || process.env.EXPORTER_AUTH_PASSWORD) {
      if (!this.opts.auth) {
        this.opts.auth = {
          username: process.env.EXPORTER_AUTH_USER,
          password: process.env.EXPORTER_AUTH_PASSWORD,
        } as AuthSettings
      } else {
        this.opts.auth.username = process.env.EXPORTER_AUTH_USER || this.opts.auth.username
        this.opts.auth.password = process.env.EXPORTER_AUTH_PASSWORD || this.opts.auth.password
      }
    }

    Object.assign(this.opts, envOptions)

    return this;
  }

  // TODO: Figure out how to have yargs read into an object instead of generating extraneous map keys
  updateFromArgs(...args: string[]): OptionsBuilder {
    const cliOptions = yargs.version(version)
      .alias('V', 'version')
      .options({
        url: {
          alias: 'h',
          description: 'A redis connection url',
          type: 'string'
        },
        defaultPrefix: {
          alias: 'p',
          description: 'Prefix of all bull queues to monitor',
          type: 'string'
        },
        metricPrefix: {
          alias: 'm',
          description: 'prefix for all exported metrics',
          type: 'string'
        },
        once: {
          alias: 'o',
          description: 'Print stats and exit without starting a server',
          type: 'boolean',
        },
        defaultAutoDiscover: {
          alias: 'a',
          description: 'Set to auto discover bull queues',
          type: 'boolean',
        },
        defaultQueues: {
          alias: 'q',
          description: 'Comma separated list of queues to monitor',
          type: 'array',
          coerce: value => {
            return value.flatMap((v: string) => v.split(',').map((str) => str.trim()));
          },
        },
        listenAddress: {
          alias: 'b',
          description: 'Address to listen on',
          type: 'string'
        },
        caCertFile: {
          alias: 'ca-cert',
          description: 'Additional certificate authority certificates to load when starting the exporter',
          type: 'string'
        },
        clientCertFile: {
          alias: 'client-cert',
          description: 'Client certificate for tls connections with Redis',
          type: 'string'
        },
        clientPrivateKeyFile: {
          alias: 'client-pk',
          description: 'Client private key for tls connections with Redis',
          type: 'string'
        },
        username: {
          alias: 'user',
          description: 'User name to use when interacting with Redis AUTH commands',
          type: 'string'
        },
        password: {
          alias: 'pass',
          description: 'Password to use when interacting with Redis AUTH commands',
          type: 'string'
        },
        configFile: {
          alias: 'config',
          description: 'Config file to read settings from',
          type: 'string'
        },
      })
      .parseSync(args);

    if (cliOptions.configFile) {
      this.readConfigFile(cliOptions.configFile)
    }

    // Remove configFile field before assigning
    const { configFile, defaultPrefix, defaultAutoDiscover, defaultQueues, ...cliSettings } = cliOptions

    this.defaultPrefix = defaultPrefix || this.defaultPrefix
    this.defaultAutoDiscover = defaultAutoDiscover || this.defaultAutoDiscover
    this.defaultQueues = defaultQueues || this.defaultQueues

    Object.assign(this.opts, cliSettings);
    return this;
  }

  values(): ExporterOptions {
    // Save defaults to tracker map if no trackers are configured yet
    if (this.opts.queueTrackers.size == 0) {
      logger.info(`configuring default tracker with prefix ${this.defaultPrefix}`)
      this.opts.queueTrackers.set(this.defaultPrefix, {
        autoDiscover: this.defaultAutoDiscover,
        queues: this.defaultQueues,
      })
    }

    return this.opts
  }

  private readConfigFile(configFile: string) {
    // Load config yaml and initialize fields
    try {
      logger.info(`loading configuration from ${configFile}`)
      const parsedOpts = YAML.parse(fs.readFileSync(configFile, 'utf-8'))

      // Save any configured trackers or queues
      if ('queues' in parsedOpts) {
        this.defaultQueues = parsedOpts['queues']
      }

      if ('queueTrackers' in parsedOpts) {
        const trackerMap = new Map<string, QueueTracker>(Object.entries(parsedOpts['queueTrackers']))
        trackerMap.forEach((tracker: QueueTracker, prefix: string) => {
          logger.info(`found tracker for prefix ${prefix}`)
          this.opts.queueTrackers.set(prefix, tracker)
        })
      }

      // Read defaults
      this.defaultPrefix = parsedOpts['prefix'] || this.defaultPrefix
      this.defaultAutoDiscover = parsedOpts['autoDiscover'] || this.defaultAutoDiscover

      // Clean up the parsed values to assign to the main options
      const validOptions = Object.fromEntries(Object.entries({ ...parsedOpts })
        .filter(([k, v]) => !(['queueTrackers', 'queues', 'prefix', 'autoDiscover'].includes(k)) && v != null))
      Object.assign(this.opts, validOptions);
    } catch (err) {
      logger.error('failed loading config')
      if (err instanceof YAML.YAMLParseError) {
        logger.error(`error parsing yaml: ${err.message} on line ${err.linePos}`)
      } else if (err instanceof Error) {
        logger.error(`unknown error reading config file: ${err.message}`)
      }
      throw err
    }
  }
}

export { OptionsBuilderFactory as Options }
