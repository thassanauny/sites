import { beforeEach } from 'vitest';
import { store } from '../src/infrastructure/storage';

// Each test starts a fresh page session as well as its own browser fixtures.
beforeEach(() => store.clearDraft());
