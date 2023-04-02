import Bull = require('bull');
import { Registry } from 'prom-client';

import { makeGauges, QueueGauges } from '../src/queueGauges';

export interface TestData {
  name: string;
  queue: Bull.Queue;
  prefix: string;
  gauges: QueueGauges;
  registry: Registry;
}

export function makeQueue(redisUrl: string, name: string = 'TestQueue', prefix: string = 'test-queue'): TestData {
  const registry = new Registry();
  const queue = new Bull(name, redisUrl, { prefix });

  return {
    name,
    queue,
    prefix,
    registry,
    gauges: makeGauges('test_stat_', [registry]),
  };
}
