
import crypto from 'crypto';
import { EnvironmentContext, JestEnvironmentConfig } from '@jest/environment';
import { RedisMemoryServer } from 'redis-memory-server';
const NodeEnvironment = require('jest-environment-node').TestEnvironment;

export function getCurrentTest(): string {
  return expect.getState().currentTestName ?? 'unknown';
}

export function getCurrentTestHash(): string {
  return crypto.createHash('md5')
    .update(getCurrentTest())
    .digest('hex')
    .substring(0, 16);
}

class RedisMemoryEnvironment extends NodeEnvironment {
  readonly redisServer: RedisMemoryServer;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);

    this.redisServer = new RedisMemoryServer({
      binary: {
        version: '7.0.9',
      },
    });
  }

  async setup() {
    await super.setup();

    const host = await this.redisServer.getHost();
    const port = await this.redisServer.getPort();

    this.global.redisUrl = `redis://${host}:${port}`;
  }

  async teardown() {
    this.redisServer.stop();

    await super.teardown();
  }
}

export default RedisMemoryEnvironment;
