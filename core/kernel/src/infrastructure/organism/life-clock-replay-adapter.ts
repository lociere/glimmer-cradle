import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReplayDeliveryAck, ReplayDeliveryRequest } from '../../foundation/event-bus/event-bus';
import { resolveStatePath } from '../../foundation/utils/path-utils';

const handlerId = 'organism.life-clock.state-sync.v1';
const owner = 'kernel.organism.life-clock';

export function createLifeClockReplayAdapter(effect: (event: any) => Promise<void>) {
  return {
    handler_id: handlerId,
    owner,
    deliverOrReadAck: async (request: ReplayDeliveryRequest): Promise<ReplayDeliveryAck> => {
      const target = path.join(resolveStatePath('kernel/organism/life-clock/replay-acks'), `${request.operation_id}.json`);
      const existing = await readAck(target);
      if (existing) return validate(existing, request);
      await effect(request.envelope);
      const ack: ReplayDeliveryAck = { status: 'committed', handler_id: handlerId, owner, operation_id: request.operation_id, payload_digest: request.payload_digest, event_type: request.event_type, source_record_id: request.source_record_id, trace_id: request.trace_id, receipt_ref: target };
      await mkdir(path.dirname(target), { recursive: true });
      try { await writeFile(target, `${JSON.stringify(ack)}\n`, { flag: 'wx', mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return validate(await readAck(target), request); }
      return ack;
    },
  };
}
async function readAck(target: string): Promise<ReplayDeliveryAck | null> { try { return JSON.parse(await readFile(target, 'utf8')) as ReplayDeliveryAck; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
function validate(ack: ReplayDeliveryAck | null, request: ReplayDeliveryRequest): ReplayDeliveryAck { if (!ack || ack.handler_id !== handlerId || ack.owner !== owner || ack.operation_id !== request.operation_id || ack.payload_digest !== request.payload_digest || ack.event_type !== request.event_type || ack.source_record_id !== request.source_record_id || ack.trace_id !== request.trace_id) throw new Error('life_clock_replay_ack_conflict'); return ack; }
