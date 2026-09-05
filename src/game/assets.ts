import type { Arena } from './types';

/** Browser-decoded assets stay outside the shared simulation type graph. */
export interface GameAssets { arena: Arena; images: Record<string, HTMLImageElement> }
