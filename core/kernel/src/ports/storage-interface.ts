// 存储标准接口。

export interface Storage {
    save(key: string, value: unknown): Promise<void>;
    load(key: string): Promise<unknown>;
}
