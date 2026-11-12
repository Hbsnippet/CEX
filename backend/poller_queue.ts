import { createClient } from 'redis';

export const queue_id = Math.random().toString(36).substring(2, 15);

const subscriber = createClient({ url: 'redis://localhost:6379' });
await subscriber.connect();

type Reply = { filledQty: number; status: string; [key: string]: any };
const pendingResolves: Record<string, (data: Reply) => void> = {};

console.log('Poller listening...');

async function pollerQueue() {
  const response = await subscriber.brPop('response-queue' + queue_id, 0); // 0 = wait forever
  if (!response) {
    pollerQueue();
    return;
  }

  const parsed = JSON.parse(response.element);
  console.log('Response received:', parsed);

  const resolve = pendingResolves[parsed.identifier];
  if (resolve) {
    resolve({
      filledQty: parsed.filledQty,
      status: parsed.status,
      ...parsed,
    });
    delete pendingResolves[parsed.identifier];
  }

  pollerQueue(); // next one
}

pollerQueue();

export function untilWeGotBack(identifier: string): Promise<Reply> {
  return new Promise((resolve) => {
    pendingResolves[identifier] = resolve;
  });
}
