// Optional multi-connection checks. Use only an owned, isolated local container.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const image = process.env.POSTGRES_IMAGE || 'postgres:17-alpine';
const checkId = randomUUID();
const container = `textdrop-check-${checkId}`;
const label = 'work.textdrop.check-id';
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

const create = (id = randomUUID()) => `select public.textdrop_create_page(${quote(id)}::uuid);`;
const save = (id, text) => `select public.textdrop_save_checked(${quote(id)}::uuid, ${text === null ? 'null' : quote(text)},
  (baseline->>'version')::bigint, encode(sha256(convert_to(baseline->>'text','UTF8')),'hex'), ${quote(randomUUID())}::uuid)
  from (select public.textdrop_poll_page(${quote(id)}::uuid,null) baseline) editing;`;
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
  const waitingName = `textdrop-waiting-${randomUUID()}`;
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
    throw new Error('TextDrop requires Node.js 24 or newer.');
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

    const page = recordResult(await sql(`${session(creator)} ${create()} commit;`));
    await sql(`${session(collaborator)} select public.textdrop_join_page(${quote(page.code)}); commit;`);
    const [first, second] = await race(
      `${session(creator)} ${save(page.id, 'First text')}`,
      `${session(collaborator)} ${save(page.id, 'Whole text accepted second')}`,
    );
    assert.equal(second.code, 0, second.stderr);
    const conflict = recordResult(second.stdout);
    assert.equal(conflict.conflict.text, 'First text');
    assert.equal(conflict.conflict.version, first.version);
    const winner = recordResult(await sql(`${session(collaborator)} ${save(page.id, 'Whole text accepted second')} commit;`));
    assert.equal(Object.hasOwn(winner, 'text'), false);
    assert.equal(winner.version, first.version+1);
    assert.deepEqual(recordResult(await sql(`${session(creator)} select public.textdrop_poll_page(${quote(page.id)}::uuid, null); commit;`)),{...winner,text:'Whole text accepted second'});
    console.log('PASS: concurrent checked edits retain the first save, return the competing text for review, and accept a fresh baseline.');

    const rollback = await command(psqlArgs, `${session(creator)} ${save(page.id,'Must roll back')} ${save(page.id, null)} commit;`);
    assert.notEqual(rollback.code,0);
    assert.match(rollback.stderr,/TEXTDROP_INVALID_TEXT/);
    assert.deepEqual(recordResult(await sql(`${session(creator)} select public.textdrop_poll_page(${quote(page.id)}::uuid, null); commit;`)),{...winner,text:'Whole text accepted second'});
    console.log('PASS: a failed transaction rolls back its earlier save.');

    const retryId=randomUUID();
    const [original,retry]=await race(`${session(creator)} ${create(retryId)}`,`${session(creator)} ${create(retryId)}`);
    assert.equal(retry.code,0,retry.stderr);
    assert.deepEqual(recordResult(retry.stdout),original);
    console.log('PASS: concurrent create retries keep one page and invitation.');

    await sql(`insert into public.textdrop_pages(id,code,created_by)
      select gen_random_uuid(),replace(gen_random_uuid()::text,'-',''),${quote(limitedCreator)}::uuid from generate_series(1,99);`);
    const [last,excess]=await race(`${session(limitedCreator)} ${create()}`,`${session(limitedCreator)} ${create()}`);
    assert.equal(last.version,1);
    assert.notEqual(excess.code,0);
    assert.match(excess.stderr,/TEXTDROP_PAGE_LIMIT/);
    assert.equal(await sql(`select count(*) from public.textdrop_pages where created_by=${quote(limitedCreator)}::uuid;`),'100');
    console.log('PASS: concurrent creates cannot exceed the page quota.');

    const joiner=randomUUID();
    await sql(`insert into auth.users(id) values (${quote(joiner)});
      insert into public.textdrop_pages(id,code,created_by)
      select gen_random_uuid(),replace(gen_random_uuid()::text,'-',''),${quote(creator)}::uuid from generate_series(1,1000);
      insert into public.textdrop_page_access(page_id,user_id)
      select id,${quote(joiner)}::uuid from public.textdrop_pages order by id limit 999;`);
    const codes=(await sql(`select code from public.textdrop_pages where id not in
      (select page_id from public.textdrop_page_access where user_id=${quote(joiner)}::uuid) order by id limit 2;`)).split('\n');
    assert.equal(codes.length,2);
    const join=(code)=>`select public.textdrop_join_page(${quote(code)});`;
    const [joined,denied]=await race(`${session(joiner)} ${join(codes[0])}`,`${session(joiner)} ${join(codes[1])}`);
    assert.equal(joined.code,codes[0]);
    assert.notEqual(denied.code,0);
    assert.match(denied.stderr,/TEXTDROP_PAGE_LIMIT/);
    assert.equal(await sql(`select count(*) from public.textdrop_page_access where user_id=${quote(joiner)}::uuid;`),'1000');
    console.log('PASS: concurrent joins cannot exceed the access quota.');
    for (const nameFirst of [true, false]) {
      const rename = `select public.textdrop_rename_checked(${quote(page.id)}::uuid, ${quote(nameFirst ? 'Name before text' : 'Name after text')}, ${quote('0'.repeat(64))});`;
      const text = save(page.id, nameFirst ? 'Text after name' : 'Text before name');
      const [, result] = await race(`${session(creator)} ${nameFirst ? rename : text}`, `${session(collaborator)} ${nameFirst ? text : rename}`);
      assert.equal(result.code, 0, result.stderr);
      const current = recordResult(await sql(`${session(creator)} select public.textdrop_poll_page(${quote(page.id)}::uuid, null); commit;`));
      assert.equal(current.name, nameFirst ? 'Name before text' : 'Name after text');
      assert.equal(current.text, nameFirst ? 'Text after name' : 'Text before name');
    }
    console.log('PASS: concurrent name and text saves preserve both fields in either lock order.');
    const checkedPage = recordResult(await sql(`${session(creator)} select public.textdrop_poll_page(${quote(page.id)}::uuid,null); commit;`));
    await sql(`${session(collaborator)} select public.textdrop_join_page(${quote(checkedPage.code)}); commit;`);
    const checkedSave = (base, text, operation) => `select public.textdrop_save_checked(${quote(base.id)}::uuid,${quote(text)},${base.version},${quote(createHash('sha256').update(base.text).digest('hex'))},${quote(operation)}::uuid);`;
    const base = checkedPage;
    const operation = randomUUID();
    const [accepted, duplicate] = await race(`${session(creator)} ${checkedSave(base,'Accepted once',operation)}`,`${session(creator)} ${checkedSave(base,'Accepted once',operation)}`);
    assert.equal(duplicate.code,0,duplicate.stderr);
    assert.deepEqual(recordResult(duplicate.stdout),accepted);
    console.log('PASS: concurrent duplicate checked writes commit exactly once and return the same receipt.');
    const remote = recordResult(await sql(`${session(collaborator)} ${save(base.id,'New collaborator text')} commit;`));
    const replay = recordResult(await sql(`${session(creator)} ${checkedSave(base,'Accepted once',operation)} commit;`));
    assert.deepEqual(replay,accepted);
    assert.deepEqual(recordResult(await sql(`${session(creator)} select public.textdrop_poll_page(${quote(base.id)}::uuid,null); commit;`)),{...remote,text:'New collaborator text'});
    const stale = recordResult(await sql(`${session(creator)} ${checkedSave(base,'Stale replacement',randomUUID())} commit;`));
    assert.equal(stale.conflict.text,'New collaborator text');
    console.log('PASS: lost-response retries and stale offline edits cannot overwrite a later collaborator write.');
    const currentBase = { ...remote, text: 'New collaborator text' };
    const [winning, competing] = await race(`${session(creator)} ${checkedSave(currentBase,'First concurrent edit',randomUUID())}`,`${session(collaborator)} ${checkedSave(currentBase,'Other concurrent edit',randomUUID())}`);
    assert.equal(competing.code,0,competing.stderr);
    assert.deepEqual(recordResult(competing.stdout).conflict,{...winning,text:'First concurrent edit'});
    console.log('PASS: checked concurrent edits compare versions after acquiring the row lock and preserve both versions.');
    console.log(`PostgreSQL ${version}: all concurrent checks passed.`);
  } finally {
    if (shutdown) await shutdown;
    else await cleanup();
  }
}
main().catch((error) => {
  if (!interrupted) { console.error(error); process.exitCode = 1; }
});
