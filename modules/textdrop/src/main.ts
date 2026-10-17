import './styles.css';
import './ui/theme.css';
import './ui/layout.css';
import { createCloud } from './infrastructure/cloud/snippets';
import { withOfflinePages } from './infrastructure/cloud/offline';
import { DeviceSnippets } from './infrastructure/storage/deviceSnippets';
import { RecoveryDrafts } from './infrastructure/storage/recoveryDrafts';
import { mountTextDrop } from './application/mount';
import { withSyncTime } from './application/syncTime';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
mountTextDrop(document.querySelector<HTMLDivElement>('#app')!, withOfflinePages(withSyncTime(createCloud(url, key))), new DeviceSnippets(), {
  recovery: new RecoveryDrafts(),
  configured: Boolean(url && key),
  version: __APP_VERSION__,
});
