/**
 * @glimmer-cradle/extension-sdk
 *
 * SDK 是 Extension Host 暴露给扩展生态的稳定边界。它允许扩展为当前角色接入新的感官、动作、
 * 平台、界面和 Agentic 能力，但不暴露 Kernel / Renderer / Cognition 的内部对象。
 */
export * from './contracts/index';
export * from './manifest/index';
export * from './host/index';
export * from './events/index';
export * from './lifecycle/index';
export * from './utilities/index';
export * from './permissions/index';
export * from './distribution/index';
