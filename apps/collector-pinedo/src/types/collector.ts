export interface TagDef {
  tag: string;
  sourceName: string;
  register: number;
  words: 1 | 2;
  type: 'uint16' | 'uint32_swapped' | 'float32_swapped';
  fc: number;
  readOnly: boolean;
  scale: number | null;
}

export interface Block {
  start: number;
  count: number;
  tags: TagDef[];
}

export interface Reading {
  tag: string;
  value: number;
  timestamp: string;
}
