// 感知事件定义。

import { DomainEvent } from './domain-events';

/** 感知领域事件（IPC 传输用），与 SDK 的 PerceptionEvent 接口不同 */
export class PerceptionDomainEvent extends DomainEvent {
    constructor(public payload: any) {
        super();
    }
}
