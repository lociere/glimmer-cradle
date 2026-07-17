// IPC 通信标准接口。

import { IPCRequest, IPCResponse } from "@glimmer-cradle/protocol";

export interface IpcAdapter {
    send(message: IPCRequest): void;
    onReceive(callback: (msg: IPCResponse) => void): void;
}
