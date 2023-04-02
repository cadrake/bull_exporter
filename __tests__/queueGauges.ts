import * as bull from 'bull';

import { getJobCompleteStats, getStats } from '../src/queueGauges';
import { makeQueue, TestData } from './create.util';
import { getCurrentTestHash } from './setup.util';

let testData: TestData;

declare global {
  var redisUrl: string;
}

beforeEach(async () => {
  jest.resetModules();
  try {
    testData = makeQueue(globalThis.redisUrl, getCurrentTestHash());
  } catch (err) {
    console.log('error: %s', err);
  }
});

afterEach(async () => {
  await testData.queue.clean(0, 'completed');
  await testData.queue.clean(0, 'active');
  await testData.queue.clean(0, 'delayed');
  await testData.queue.clean(0, 'failed');
  await testData.queue.empty();
  await testData.queue.close();
});

it('should list 1 queued job', async () => {

  const {
    name,
    queue,
    prefix,
    gauges,
    registry,
  } = testData;

  await queue.add({ a: 1 });
  await getStats(prefix, name, queue, gauges);

  expect(await registry.metrics()).toMatchSnapshot();
});

it('should list 1 completed job', async () => {
  const {
    name,
    queue,
    prefix,
    gauges,
    registry,
  } = testData;

  queue.process(async (jobInner: bull.Job<unknown>) => {
    expect(jobInner).toMatchObject({ data: { a: 1 } });
  });

  const job = await queue.add({ a: 1 });
  await job.finished();

  await getStats(prefix, name, queue, gauges);
  await getJobCompleteStats(prefix, name, job, gauges);

  expect(await registry.metrics()).toMatchSnapshot();
});

it('should list 1 completed job with delay', async () => {
  const {
    name,
    queue,
    prefix,
    gauges,
    registry,
  } = testData;

  queue.process(async (jobInner: bull.Job<unknown>) => {
    expect(jobInner).toMatchObject({ data: { a: 1 } });
  });

  const job = await queue.add({ a: 1 });
  await job.finished();

  job.finishedOn = (job.processedOn ?? 0) + 1000;

  await getStats(prefix, name, queue, gauges);
  await getJobCompleteStats(prefix, name, job, gauges);

  expect(await registry.metrics()).toMatchSnapshot();
});

it('should list 1 failed job', async () => {
  const {
    name,
    queue,
    prefix,
    gauges,
    registry,
  } = testData;

  queue.process(async (jobInner: bull.Job<unknown>) => {
    expect(jobInner).toMatchObject({ data: { a: 1 } });
    throw new Error('expected');
  });
  const job = await queue.add({ a: 1 });

  await expect(job.finished()).rejects.toThrow(/expected/);

  await getStats(prefix, name, queue, gauges);

  expect(await registry.metrics()).toMatchSnapshot();
});

it('should list 1 delayed job', async () => {
  const {
    name,
    queue,
    prefix,
    gauges: gauges,
    registry,
  } = testData;

  await queue.add({ a: 1 }, { delay: 100_000 });

  await getStats(prefix, name, queue, gauges);

  expect(await registry.metrics()).toMatchSnapshot();
});

it('should list 1 active job', async () => {
  const {
    name,
    queue,
    prefix,
    gauges,
    registry,
  } = testData;

  let jobStartedResolve!: () => void;
  let jobDoneResolve!: () => void;
  const jobStartedPromise = new Promise<void>(resolve => jobStartedResolve = resolve);
  const jobDonePromise = new Promise<void>(resolve => jobDoneResolve = resolve);

  queue.process(async () => {
    jobStartedResolve();
    await jobDonePromise;
  });
  const job = await queue.add({ a: 1 });

  await jobStartedPromise;
  await getStats(prefix, name, queue, gauges);
  expect(await registry.metrics()).toMatchSnapshot();
  jobDoneResolve();
  await job.finished();

  await getStats(prefix, name, queue, gauges);
  expect(await registry.metrics()).toMatchSnapshot();
});
