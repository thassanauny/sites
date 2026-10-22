// Optional multi-connection checks. Use only an owned, isolated local container.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const image = process.env.POSTGRES_IMAGE || 'postgres:17-alpine';
const checkId = randomUUID();
const container = `iou-check-${checkId}`;
const label = 'work.iou.check-id';
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${quote(JSON.stringify(value))}::jsonb`;
const creator = randomUUID();
const collaborator = randomUUID();
const limitedCreator = randomUUID();
let started = false;
let interrupted = false;
let shutdown;
const commands = new Map();

function command(args, input, onOutput, holdOpen = false) {
  if (interrupted && !['inspect', 'rm'].includes(args[0]))
    return Promise.reject(new Error('PostgreSQL check was interrupted.'));
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => child.kill('SIGKILL'), 20_000);
  const result = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('data', (data) => {
      stdout += data;
      onOutput?.(stdout);
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (signal) reject(new Error(`Docker command timed out or was interrupted (${signal}).`));
      else resolve({ code, stdout, stderr });
    });
    child.once('error', () => clearTimeout(timeout));
  });
  // Docker commands can finish before consuming their input when startup fails.
  child.stdin.on('error', (error) => {
    if (error.code !== 'EPIPE') child.kill('SIGKILL');
  });
  if (holdOpen) child.stdin.write(input);
  else child.stdin.end(input);
  result.finish = () => child.stdin.end('commit;\n');
  commands.set(child, { result, starting: args[0] === 'run' });
  result.then(
    () => commands.delete(child),
    () => commands.delete(child),
  );
  return result;
}

async function checked(args, input) {
  const result = await command(args, input);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

const psqlArgs = [
  'exec',
  '-i',
  container,
  'psql',
  '-X',
  '-qAt',
  '-v',
  'ON_ERROR_STOP=1',
  '-v',
  'VERBOSITY=verbose',
  '-U',
  'postgres',
  '-d',
  'postgres',
];
const session = (user) => `begin; set local statement_timeout = '10s';
  select set_config('request.jwt.claim.sub', ${quote(user)}, true); set local role authenticated;`;
const recordResult = (output) => JSON.parse(output.split('\n').filter(line => line.startsWith('{')).at(-1));
async function sql(script) { return checked(psqlArgs, script); }

function payload(id = randomUUID()) {
  return { id, name: 'Concurrent trip', description: '', currency: 'THB', icon: 'plane', color: '#123456',
    inviteCode: '0'.repeat(32), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    members: [{id:'alice',name:'Alice'}], transactions: [] };
}
const create = (group) => `select public.iou_create_group(${json(group)});`;
const save = (group, revision) => `select public.iou_save_group(${json(group)}, ${revision});`;
const saveDelta = (group, revision, changes = {}) => {
  const { members: _members, transactions: _transactions, ...metadata } = group;
  const delta = {
    metadata,
    members: { upsert: [], remove: [] },
    transactions: { upsert: [], remove: [] },
    ...changes,
  };
  return `select public.iou_save_group_delta(${quote(group.id)}, ${revision}, ${json(delta)});`;
};
const load = (id) =>
  `select jsonb_build_object('payload',payload,'version',version) from public.iou_groups where id=${quote(id)};`;
async function race(first, second) {
  let markReady;
  let markFailed;
  const ready = new Promise((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  const firstResult = command(
    psqlArgs,
    `${first} select 'POSTGRES_HOLDING_LOCK';\n`,
    (output) => {
      if (output.includes('POSTGRES_HOLDING_LOCK')) markReady();
    },
    true,
  );
  firstResult.then((result) => {
    if (result.code !== 0) markFailed(new Error(result.stderr));
    else markFailed(new Error('First connection completed before reporting its lock.'));
  }, markFailed);
  const waitingName = `iou-waiting-${randomUUID()}`;
  let secondResult;
  let failure;
  try {
    await ready;
    secondResult = command(
      psqlArgs,
      `set application_name = ${quote(waitingName)}; ${second} commit;`,
    );
    let blocked = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const waitType = await sql(`select wait_event_type from pg_stat_activity
        where application_name = ${quote(waitingName)} and state = 'active';`);
      if (waitType === 'Lock') {
        blocked = true;
        break;
      }
      await delay(50);
    }
    assert.ok(
      blocked,
      'Second connection must be observed waiting for the first connection’s lock.',
    );
  } catch (error) {
    failure = error;
  } finally {
    firstResult.finish?.();
  }
  if (failure) {
    await Promise.allSettled([firstResult, secondResult]);
    throw failure;
  }
  const [a, b] = await Promise.all([firstResult, secondResult]);
  assert.equal(a.code, 0, a.stderr);
  return [recordResult(a.stdout), b];
}

async function cleanup() {
  const inspected = await command([
    'inspect',
    '--format',
    `{{ index .Config.Labels "${label}" }}`,
    container,
  ]);
  if (inspected.code !== 0) {
    if (started && !/No such object|No such container/i.test(inspected.stderr))
      throw new Error(`Could not confirm removal of ${container}: ${inspected.stderr}`);
    return;
  }
  assert.equal(
    inspected.stdout.trim(),
    checkId,
    'Temporary container ownership changed; it was left untouched.',
  );
  await checked(['rm', '-f', container]);
}

function interrupt(signal) {
  if (shutdown) return;
  interrupted = true;
  const code = signal === 'SIGINT' ? 130 : 143;
  shutdown = (async () => {
    const pending = [...commands.entries()];
    // Let the bounded Docker start finish so cleanup cannot run before the
    // daemon creates its container. Cancel every other active command.
    for (const [child, state] of pending) if (!state.starting) child.kill('SIGTERM');
    await Promise.allSettled(pending.map(([, state]) => state.result));
    await cleanup();
  })();
  shutdown.then(
    () => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(code);
    },
  );
}

process.on('SIGINT', () => interrupt('SIGINT'));
process.on('SIGTERM', () => interrupt('SIGTERM'));

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('iou requires Node.js 24 or newer.');
  try {
    const running = await command(['info', '--format', '{{.ServerVersion}}']);
    if (running.code !== 0) {
      console.log('SKIP: Docker is not running. See supabase/README.md.');
      return;
    }
    const available = await command(['image', 'inspect', image]);
    if (available.code !== 0) {
      console.log(
        `SKIP: PostgreSQL image ${image} is not available locally. See supabase/README.md.`,
      );
      return;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log('SKIP: Docker is not installed. See supabase/README.md.');
    return;
  }
  try {
    await checked([
      'run',
      '--detach',
      '--rm',
      '--pull=never',
      '--network',
      'none',
      '--name',
      container,
      '--label',
      `${label}=${checkId}`,
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      image,
    ]);
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      // The image starts a temporary socket-only server during initialization.
      // TCP becomes ready only when its final PostgreSQL process is running.
      const result = await command([
        'exec',
        container,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
      ]);
      if (result.code === 0) {
        ready = true;
        break;
      }
      await delay(250);
    }
    assert.ok(ready, 'Temporary PostgreSQL did not become ready.');
    const version = await sql('show server_version;');
    assert.equal(
      Math.trunc(Number(await sql('show server_version_num;')) / 10_000),
      17,
      'Use a PostgreSQL 17 image.',
    );
    await sql(`
      create role anon; create role authenticated; create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      insert into auth.users(id) values (${quote(creator)}),(${quote(collaborator)}),(${quote(limitedCreator)});
    `);
    await sql(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    const rowMigration = await readFile(new URL('./update-row-storage.sql', import.meta.url), 'utf8');
    await sql(rowMigration);

    const record = recordResult(await sql(`${session(creator)} ${create(payload())} commit;`));
    await sql(`${session(collaborator)} select public.iou_join_group(${quote(record.payload.inviteCode)}); commit;`);
    const [accepted, rejected] = await race(
      `${session(creator)} ${save({...record.payload, name:'First accepted edit'}, record.version)}`,
      `${session(collaborator)} ${save({...record.payload, name:'Stale waiting edit'}, record.version)}`,
    );
    assert.equal(rejected.code === 0, false, 'Waiting stale save must fail.');
    assert.match(rejected.stderr, /PT409.*IOU_CONFLICT/);
    assert.doesNotMatch(rejected.stderr, /40001/);
    assert.deepEqual(recordResult(await sql(`${session(creator)} ${load(record.payload.id)} commit;`)), accepted);
    const recovered = recordResult(await sql(`${session(collaborator)} ${save({...accepted.payload, description:'Recovered after conflict'}, accepted.version)} commit;`));
    assert.equal(recovered.version, accepted.version+1);
    console.log('PASS: a waiting stale revision returns PT409, preserves the accepted row, and can retry after reloading.');

    const outsider = await command(psqlArgs, `${session(limitedCreator)} ${saveDelta(recovered.payload, recovered.version)} commit;`);
    assert.notEqual(outsider.code, 0, 'Knowing a group ID must not authorize a delta save.');
    assert.match(outsider.stderr, /42501.*IOU_ACCESS_DENIED/);
    assert.deepEqual(recordResult(await sql(`${session(creator)} ${load(recovered.payload.id)} commit;`)), recovered);

    let shared = recovered;
    for (const [firstKind, waitingKind] of [
      ['delta', 'delta'],
      ['delta', 'legacy'],
      ['legacy', 'delta'],
    ]) {
      const first = { ...shared.payload, name: `Accepted ${firstKind} before ${waitingKind}` };
      const waiting = { ...shared.payload, name: 'Waiting stale metadata' };
      const write = (kind, group) =>
        kind === 'delta' ? saveDelta(group, shared.version) : save(group, shared.version);
      const [result, stale] = await race(
        `${session(creator)} ${write(firstKind, first)}`,
        `${session(collaborator)} ${write(waitingKind, waiting)}`,
      );
      assert.notEqual(stale.code, 0, 'All writers must compare versions after obtaining the same lock.');
      assert.match(stale.stderr, /PT409.*IOU_CONFLICT/);
      assert.doesNotMatch(stale.stderr, /40001/);
      shared = recordResult(await sql(`${session(collaborator)} ${load(first.id)} commit;`));
      assert.deepEqual(shared.payload, first);
      assert.equal(shared.version, result.version);
      if (firstKind === 'delta') {
        assert.deepEqual(result, { format: 1, id: first.id, version: shared.version });
        assert.equal('payload' in result, false, 'Delta saves must not reconstruct the ledger response.');
      }
      const retried = { ...shared.payload, description: `Rebased ${waitingKind} edit` };
      const receipt = recordResult(await sql(`${session(collaborator)} ${saveDelta(retried, shared.version)} commit;`));
      shared = recordResult(await sql(`${session(creator)} ${load(first.id)} commit;`));
      assert.deepEqual(shared.payload, retried);
      assert.equal(shared.version, receipt.version);
    }
    console.log('PASS: delta/delta and both legacy/delta lock orders reject stale writers with PT409 and accept rebased retries.');

    const expense = {
      id: 'exact-expense', type: 'expense', description: 'Exact minor units',
      amount: 1_000_000_000_000, paidBy: 'alice', shares: { alice: 0, bob: 1_000_000_000_000 },
      category: 'Food', date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z',
    };
    const payment = {
      id: 'exact-payment', type: 'payment', fromId: 'bob', toId: 'alice', amount: 1,
      note: 'One minor unit', date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z',
    };
    const changes = {
      members: { upsert: [{ id: 'bob', name: 'Bob' }], remove: [] },
      transactions: { upsert: [expense, payment], remove: [] },
    };
    await sql(`${session(creator)} ${saveDelta(shared.payload, shared.version, changes)} commit;`);
    shared = recordResult(await sql(`${session(creator)} ${load(shared.payload.id)} commit;`));
    assert.deepEqual(shared.payload.members, [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }]);
    assert.deepEqual(shared.payload.transactions, [expense, payment]);
    const scaled = saveDelta(shared.payload, shared.version, {
      transactions: { upsert: [expense], remove: [] },
    }).replaceAll(':1000000000000', ':1000000000000.0').replaceAll('"alice":0', '"alice":0.0');
    await sql(`${session(creator)} ${scaled} commit;`);
    shared = recordResult(await sql(`${session(creator)} ${load(shared.payload.id)} commit;`));
    assert.deepEqual(shared.payload.transactions, [expense, payment]);
    assert.equal(await sql(`select amount::text from public.iou_expenses where group_id=${quote(shared.payload.id)} and id=${quote(expense.id)};`), '1000000000000.0');
    assert.equal(await sql(`select amount::text from public.iou_expense_shares where group_id=${quote(shared.payload.id)} and expense_id=${quote(expense.id)} and member_id='alice';`), '0.0');
    assert.equal(await sql(`select h.payload_bytes=octet_length(g.payload::text) from public.iou_group_headers h join public.iou_groups g using(id) where h.id=${quote(shared.payload.id)};`), 't', 'Integer-valued scaled JSON numbers must retain exact cached bytes.');
    await sql(rowMigration);
    assert.deepEqual(recordResult(await sql(`${session(creator)} ${load(shared.payload.id)} commit;`)), shared, 'Migration replay must preserve the latest normalized ledger and version.');
    const beforeInvalid = shared;
    for (const invalid of [
      { transactions: { upsert: [{ ...expense, shares: { alice: 1, bob: expense.amount } }], remove: [] } },
      { members: { upsert: [], remove: ['bob'] } },
      { metadata: { ...shared.payload } },
    ]) {
      const rejected = await command(psqlArgs, `${session(creator)} ${saveDelta(shared.payload, shared.version, invalid)} commit;`);
      assert.notEqual(rejected.code, 0, 'Invalid financial tuples, member references and hidden metadata arrays must fail.');
      assert.match(rejected.stderr, /22023/);
      assert.deepEqual(recordResult(await sql(`${session(creator)} ${load(shared.payload.id)} commit;`)), beforeInvalid);
    }
    const ordered = { transactions: { upsert: [], remove: [], order: [payment.id, expense.id] } };
    await sql(`${session(collaborator)} ${saveDelta(shared.payload, shared.version, ordered)} commit;`);
    shared = recordResult(await sql(`${session(creator)} ${load(shared.payload.id)} commit;`));
    assert.deepEqual(shared.payload.transactions, [payment, expense]);
    const converted = { ...expense, id: payment.id, amount: 1, shares: { alice: 1, bob: 0 } };
    await sql(`${session(creator)} ${saveDelta(shared.payload, shared.version, {
      transactions: { upsert: [converted], remove: [] },
    })} commit;`);
    shared = recordResult(await sql(`${session(creator)} ${load(shared.payload.id)} commit;`));
    assert.deepEqual(shared.payload.transactions, [converted, expense], 'A type change must preserve the existing transaction position.');
    await sql(`${session(creator)} ${saveDelta(shared.payload, shared.version, {
      transactions: { upsert: [payment], remove: [] },
    })} commit;`);
    shared = recordResult(await sql(`${session(creator)} ${load(shared.payload.id)} commit;`));
    assert.deepEqual(shared.payload.transactions, [payment, expense]);
    const exact = { ...expense, amount: 1, paidBy: 'bob', shares: { alice: 1, bob: 0 } };
    await sql(`${session(creator)} ${saveDelta(shared.payload, shared.version, {
      transactions: { upsert: [exact], remove: [] },
    })} commit;`);
    shared = recordResult(await sql(`${session(creator)} ${load(shared.payload.id)} commit;`));
    assert.deepEqual(shared.payload.transactions, [payment, exact]);
    await sql(`${session(creator)} ${saveDelta(shared.payload, shared.version, {
      members: { upsert: [], remove: ['bob'] },
      transactions: { upsert: [], remove: [payment.id, expense.id] },
    })} commit;`);
    shared = recordResult(await sql(`${session(creator)} ${load(shared.payload.id)} commit;`));
    assert.deepEqual(shared.payload.members, [{ id: 'alice', name: 'Alice' }]);
    assert.deepEqual(shared.payload.transactions, []);
    console.log('PASS: deltas preserve exact money, explicit zero shares and order; invalid tuples roll back and related removals commit atomically.');

    const cascadeGroup = {
      ...payload(),
      members: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }],
      transactions: [expense, payment],
    };
    await sql(`${session(creator)} ${create(cascadeGroup)} commit;`);
    await sql(`delete from public.iou_group_headers where id=${quote(cascadeGroup.id)};`);
    for (const relation of ['iou_members','iou_transactions','iou_expenses','iou_payments','iou_expense_shares','iou_group_access'])
      assert.equal(await sql(`select count(*) from public.${relation} where group_id=${quote(cascadeGroup.id)};`), '0');
    console.log('PASS: administrator group deletion cascades through members, transactions and shares without leaving orphan rows.');

    const retryGroup = payload();
    const [original, retry] = await race(
      `${session(creator)} ${create(retryGroup)}`,
      `${session(creator)} ${create({...retryGroup, name:'Retried content'})}`,
    );
    assert.equal(retry.code, 0, retry.stderr);
    assert.deepEqual(recordResult(retry.stdout), original);
    console.log('PASS: concurrent retries of a stable group ID return one unchanged group and invitation.');

    await sql(`${session(limitedCreator)}
      do $fixture$ begin
        for n in 1..99 loop
          perform public.iou_create_group(jsonb_set(${json(payload())},'{id}',to_jsonb('limit-'||n)));
        end loop;
      end; $fixture$;
      commit;`);
    const [last, excess] = await race(
      `${session(limitedCreator)} ${create(payload('100th-group'))}`,
      `${session(limitedCreator)} ${create(payload('101st-group'))}`,
    );
    assert.equal(last.payload.id, '100th-group');
    assert.notEqual(excess.code, 0);
    assert.match(excess.stderr, /IOU_GROUP_LIMIT/);
    assert.equal(await sql(`select count(*) from public.iou_groups where created_by=${quote(limitedCreator)}::uuid;`),'100');
    console.log('PASS: concurrent creates cannot exceed the per-identity group quota.');
    console.log(`PostgreSQL ${version}: all concurrent checks passed.`);
  } finally {
    if (shutdown) await shutdown;
    else await cleanup();
  }
}
main().catch((error) => {
  if (!interrupted) { console.error(error); process.exitCode = 1; }
});
