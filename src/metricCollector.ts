import bull from 'bull';
import * as Logger from 'bunyan';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import { Redis, RedisOptions } from 'ioredis';
import { register as globalRegister, Registry } from 'prom-client';
import { ConnectionOptions } from 'tls';

import { logger as globalLogger } from './logger';
import { getJobCompleteStats, getStats, makeGauges, QueueGauges } from './queueGauges';

export interface MetricCollectorOptions extends Omit<bull.QueueOptions, 'redis'> {
  logger: Logger;
  redis: string;
  metricPrefix: string;
  autoDiscover: boolean;
  caCertFile: string;
  clientCertFile: string;
  clientPrivateKeyFile: string;
  username: string;
  password: string;
}

export interface QueueData<T = unknown> {
  queue: bull.Queue<T>;
  name: string;
  prefix: string;
}

export class MetricCollector {

  private readonly logger: Logger;

  private readonly defaultRedisClient: Redis;
  private readonly redisOptions: RedisOptions;
  private readonly bullOpts: Omit<bull.QueueOptions, 'redis'>;
  private readonly queuesByName: Map<string, QueueData<unknown>> = new Map();

  private get queues(): QueueData<unknown>[] {
    return [...this.queuesByName.values()];
  }

  private readonly myListeners: Set<(id: string) => Promise<void>> = new Set();

  private readonly gauges: QueueGauges;

  constructor(
    queueNames: string[],
    opts: MetricCollectorOptions,
    registers: Registry[] = [globalRegister],
  ) {
    const { logger, redis, metricPrefix, ...extraOpts } = opts;

    this.logger = logger || globalLogger;
    this.redisOptions = this.parseRedisOptions(opts);

    this.defaultRedisClient = new Redis(this.redisOptions);
    this.defaultRedisClient.setMaxListeners(32);

    this.bullOpts = { prefix: extraOpts.prefix }
    this.addToQueueSet(queueNames);
    this.gauges = makeGauges(metricPrefix, registers);
  }

  private parseRedisOptions(opts: MetricCollectorOptions): RedisOptions {
    const redisOpts = {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    } as RedisOptions;

    this.logger.info('Initializing Redis connection options');

    // Break up url and set options
    if (opts.redis.match(/^redis(s|-socket|-sentinel)?:\/\//)) {
      // Assume Redis URI
      const redisUri = new URL(opts.redis);
      redisOpts.host = redisUri.hostname;
      redisOpts.port = parseInt(redisUri.port);
      redisOpts.username = redisUri.username;
      redisOpts.password = redisUri.password;
    } else {
      // Host and possibly port
      let hostname, port;
      [hostname, port] = opts.redis.split(':');
      redisOpts.host = hostname;
      redisOpts.port = parseInt(port);
    }

    // Override the username and password if provided
    if (opts.username && opts.password) {
      Object.assign(redisOpts, {
        username: opts.username,
        password: opts.password,
      })
    }

    // Load any certificates or keys
    if (opts.caCertFile || (opts.clientCertFile && opts.clientPrivateKeyFile)) {
      try {
        redisOpts['tls'] = {
          ca: opts.caCertFile ? fs.readFileSync(opts.caCertFile) : null,
          key: opts.clientPrivateKeyFile ? fs.readFileSync(opts.clientPrivateKeyFile) : null,
          cert: opts.clientCertFile ? fs.readFileSync(opts.clientCertFile) : null,
        } as ConnectionOptions
      } catch(err) {
        this.logger.error('Error reading certificate file: %s', err);
      }
    }

    return redisOpts;
  }

  private createClient(_type: 'client' | 'subscriber' | 'bclient'): Redis {
    if (_type === 'client') {
      return this.defaultRedisClient!;
    }

    return new Redis(this.redisOptions);
  }

  private addToQueueSet(names: string[]): void {
    names.forEach((name) => {
      if (this.queuesByName.has(name)) {
        return;
      }

      this.queuesByName.set(name, {
        name,
        queue: new bull(name, {
          ...this.bullOpts,
          createClient: this.createClient.bind(this),
        }),
        prefix: this.bullOpts.prefix || 'bull',
      });

      this.logger.info('Added queue', name);
    })
  }

  public async discoverAll(): Promise<void> {
    const keyPattern = new RegExp(`^${this.bullOpts.prefix}:([^:]+):(id|failed|active|waiting|stalled-check)$`);
    const keyStream = this.defaultRedisClient.scanStream({
      match: `${this.bullOpts.prefix}:*:*`,
    });

    return new Promise<void>((resolve, _) => {
      keyStream.on('data', async (keys: string[]) => {
        keys.forEach((key) => {
          const match = keyPattern.exec(key);
          if (match?.[1]) {
            this.logger.info('new key %s', match[1]);
            this.addToQueueSet([match[1]]);
          }
        })
      })

      keyStream.on('end', () => {
        resolve();
      });
    }).catch((err) => {
      this.logger.error('Error scanning redis keys: %s', err);
    });
  }

  private async onJobComplete(queue: QueueData, id: string): Promise<void> {
    await queue.queue.getJob(id)
      .then(async (job) => {
        if (job) {
          await getJobCompleteStats(queue.prefix, queue.name, job, this.gauges);
        } else {
          this.logger.warn({ job: id }, 'unable to find job from id');
        }
      })
      .catch((err) => {
        this.logger.error({ err, job: id }, 'unable to fetch completed job');
      });
  }

  public collectJobCompletions(): void {
    this.queues.forEach((q) => {
      const cb = this.onJobComplete.bind(this, q);
      this.myListeners.add(cb);
      q.queue.on('global:completed', cb);
    });
  }

  public async updateAll(): Promise<void> {
    await Promise.all(this.queues.map(q => getStats(q.prefix, q.name, q.queue, this.gauges)));
  }

  public async ping(): Promise<void> {
    await this.defaultRedisClient.ping();
  }

  public async close(): Promise<void> {
    this.defaultRedisClient.disconnect();

    this.queues.forEach((q) => {
      this.myListeners.forEach((l) => {
        (q.queue as any as EventEmitter).removeListener('global:completed', l);
      });
    });

    await Promise.all(this.queues.map(q => q.queue.close()));
  }
}
