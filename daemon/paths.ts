import * as path from 'path';
import { DATA_DIR } from './registry.ts';

export const SOCKET_PATH = path.join(DATA_DIR, 'daemon.sock');
