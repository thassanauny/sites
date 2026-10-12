import './styles.css';
import { createCloud } from './infrastructure/cloud/snippets';
import { mountTextDrop } from './application/mount';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
mountTextDrop(document.querySelector<HTMLDivElement>('#app')!, createCloud(url, key), {
  configured: Boolean(url && key),
  version: __APP_VERSION__,
});
