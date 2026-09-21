import type { ConversationBinding } from './binding.js';

export interface BindingStorePort {
  load(bindingKey: string): ConversationBinding | null;
  create(binding: ConversationBinding): ConversationBinding;
  close(): void;
}

