import type { ItemType, MessageItem } from '../types';

export function classifyItem(item: MessageItem): ItemType {
  if (typeof item === 'number') return 'DELAY';
  const att = item.message.attachment;
  if (att) {
    return att.type === 'template' ? 'TEMPLATE' : (att.type.toUpperCase() as ItemType);
  }
  return 'TEXT';
}

export function classifyItems(messages: MessageItem[]): ItemType[] {
  return messages.map(classifyItem);
}
