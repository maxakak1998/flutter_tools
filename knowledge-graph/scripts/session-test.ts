#!/usr/bin/env npx tsx

/**
 * Session-dictionary test — machine-wide session store + attribution plumbing.
 *
 * Part A (pure): session-store read/write, unknown-field preservation, fill-empty-only,
 *   resolveRoot over parent / continuation / cycle / dangling / hop-limit chains,
 *   corrupt files, last_seen throttle, audit-line truncation, teammate detection,
 *   process-key + continuation pointer. Runs against SOURCE via tsx.
 * Part B (integration): spawns the BUILT `dist/cli.js` with synthetic hook stdin:
 *     - `kg session set/list/show`
 *     - `kg session audit` (PostToolUse) writes the expected line, rolled up to the root
 *     - `kg prime` source=clear chains `continues_id` via the per-process pointer
 *     - `kg goal bind` keys the goal by the ROOT session
 *   Run `npm run build` first. Every test points at a temp sessions dir
 *   (KG_SESSIONS_DIR) — the real ~/.knowledge-graph/sessions/ is never touched.
 */

import { join } from 'path';
import { fileURLToPath } from 'url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { spawnSync, spawn } from 'child_process';
import {
  readSession,
  writeSession,
  fillSession,
  updateSession,
  resolveRoot,
  resolveRootDetailed,
  listSessions,
  touchLastSeen,
  formatAuditLine,
  parseAgentId,
  detectTeammate,
  readProcessArgv,
  procKey,
  swapProcPointer,
  cliSessionId,
  sessionFilePath,
  MAX_ROOT_HOPS,
  AUDIT_LINE_MAX_BYTES,
} from '../src/session-store.js';
import { readGoal } from '../src/goal-store.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) {
    console.error(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const cliJs = join(repoRoot, 'dist', 'cli.js');
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

// ============================================================
// Part A — pure session-store
// ============================================================
function partA(): void {
  console.error('\nPart A — session-store (pure)');
  const dir = tmp('kg-sess-a-');

  // read/write round-trip + unknown-field preservation
  writeSession({ id: 'A', name: 'root', custom_blob: { x: [1, 2] }, note: 'hi' }, dir);
  const a = readSession('A', dir);
  assert(a?.id === 'A' && a?.name === 'root' && a?.note === 'hi', 'write/read round-trips known fields');
  assert(JSON.stringify(a?.custom_blob) === '{"x":[1,2]}', 'unknown fields are preserved on read');
  updateSession('A', { note: 'edited' }, dir);
  const a2 = readSession('A', dir);
  assert(a2?.note === 'edited' && JSON.stringify(a2?.custom_blob) === '{"x":[1,2]}' && a2?.name === 'root', 'updateSession merges and keeps unknown fields');
  updateSession('A', { note: null }, dir);
  assert(readSession('A', dir)?.note === undefined, 'updateSession null deletes a field');
  assert(readSession('nope', dir) === null, 'missing session reads null');
  assert(readSession('../../etc/passwd', dir) === null, 'session id is sanitized');

  // only `id` is required
  const minimal = fillSession('M', {}, dir);
  assert(minimal.record.id === 'M' && minimal.changed && existsSync(sessionFilePath('M', dir)), 'a record with only id is valid and written');

  // fill-empty-only
  fillSession('F', { name: 'manual', project_dir: '/p' }, dir);
  const f = fillSession('F', { name: 'auto', project_dir: '/other', branch: 'main', parent_id: '' }, dir);
  assert(f.record.name === 'manual' && f.record.project_dir === '/p', 'auto-fill never overwrites an existing value');
  assert(f.record.branch === 'main', 'auto-fill fills an empty field');
  assert(f.record.parent_id === undefined, 'auto-fill skips empty incoming values');
  assert(fillSession('F', { name: 'again' }, dir).changed === false, 'no-op fill does not rewrite');

  // corrupt file -> treated as fresh, rewritten
  writeFileSync(sessionFilePath('C', dir), '{not json', 'utf-8');
  assert(readSession('C', dir) === null, 'corrupt file reads null (no throw)');
  const c = fillSession('C', { started_at: 't' }, dir);
  assert(c.changed && readSession('C', dir)?.started_at === 't', 'corrupt file is rewritten as a fresh session');
  writeFileSync(sessionFilePath('Arr', dir), '[1,2]', 'utf-8');
  assert(readSession('Arr', dir) === null, 'non-object JSON reads null');

  // resolveRoot: parent chain
  writeSession({ id: 'R' }, dir);
  writeSession({ id: 'P1', parent_id: 'R' }, dir);
  writeSession({ id: 'P2', parent_id: 'P1' }, dir);
  assert(resolveRoot('P2', dir) === 'R', 'resolveRoot follows parent_id chain to the root');
  assert(resolveRoot('R', dir) === 'R', 'a root resolves to itself');
  assert(resolveRoot('unknown-session', dir) === 'unknown-session', 'a session with no file is its own root');

  // continuation chain, and parent_id wins over continues_id
  writeSession({ id: 'K0' }, dir);
  writeSession({ id: 'K1', continues_id: 'K0' }, dir);
  writeSession({ id: 'K2', continues_id: 'K1' }, dir);
  assert(resolveRoot('K2', dir) === 'K0', 'resolveRoot follows continues_id');
  writeSession({ id: 'Both', parent_id: 'R', continues_id: 'K0' }, dir);
  assert(resolveRoot('Both', dir) === 'R', 'parent_id takes precedence over continues_id');
  writeSession({ id: 'Mixed', parent_id: 'K2' }, dir);
  assert(resolveRoot('Mixed', dir) === 'K0', 'parent link into a continuation chain resolves through it');

  // cycle -> current node is root, no infinite loop
  writeSession({ id: 'X', parent_id: 'Y' }, dir);
  writeSession({ id: 'Y', parent_id: 'X' }, dir);
  const cyc = resolveRootDetailed('X', dir);
  assert(cyc.cycle && cyc.root === 'Y', 'cycle is detected and the last node is treated as root', `root=${cyc.root}`);
  writeSession({ id: 'Self', parent_id: 'Self' }, dir);
  assert(resolveRootDetailed('Self', dir).cycle, 'self-reference is a cycle');
  const upd = updateSession('R', { parent_id: 'P2' }, dir);
  assert(!!upd.warning && readSession('R', dir)?.parent_id === 'P2', 'a cycle-creating link is allowed but warns');
  updateSession('R', { parent_id: null }, dir);

  // dangling
  writeSession({ id: 'D', parent_id: 'ghost' }, dir);
  const dang = resolveRootDetailed('D', dir);
  assert(dang.dangling && dang.root === 'D', 'dangling reference: current node is root');

  // hop limit
  for (let i = 0; i < 30; i++) writeSession({ id: `H${i}`, ...(i < 29 ? { parent_id: `H${i + 1}` } : {}) }, dir);
  const hops = resolveRootDetailed('H0', dir);
  assert(hops.chain.length <= MAX_ROOT_HOPS + 1 && hops.root !== 'H29', `hop limit caps the walk (chain=${hops.chain.length})`);

  // root_id is never stored
  assert(!('root_id' in (readSession('P2', dir) ?? {})), 'root_id is computed, never stored');

  // listSessions
  writeSession({ id: 'L-old', last_seen: '2026-01-01T00:00:00.000Z' }, dir);
  writeSession({ id: 'L-new', last_seen: '2026-06-01T00:00:00.000Z' }, dir);
  const ids = listSessions(dir).map((r) => r.id);
  assert(ids.indexOf('L-new') < ids.indexOf('L-old') && ids.includes('C'), 'listSessions sorts newest last_seen first');

  // last_seen throttle (<= 1 write / 60s)
  writeSession({ id: 'T' }, dir);
  const t0 = Date.parse('2026-06-01T00:00:00Z');
  assert(touchLastSeen('T', dir, t0) === true, 'first touch writes last_seen');
  assert(touchLastSeen('T', dir, t0 + 30_000) === false, 'touch within 60s is skipped');
  assert(touchLastSeen('T', dir, t0 + 61_000) === true, 'touch after 60s writes again');
  assert(touchLastSeen('no-such', dir, t0) === false, 'touch on a missing session is a no-op');

  // audit line truncation
  const big = formatAuditLine({
    ts: 't', session_id: 's', root_id: 'r', agent_id: null, agent_type: null, tool: 'x', ok: true,
    refs: Array.from({ length: 200 }, (_, i) => `chunk:${'z'.repeat(100)}${i}`),
  });
  assert(Buffer.byteLength(big) < AUDIT_LINE_MAX_BYTES && JSON.parse(big).refs_truncated === true, 'audit line stays under 4 KB by truncating refs');
  const small = JSON.parse(formatAuditLine({ ts: 't', session_id: 's', root_id: 'r', agent_id: 'a1', agent_type: 'builder', tool: 'x', ok: false, refs: ['upcozm-1'] }));
  assert(small.refs[0] === 'upcozm-1' && small.agent_id === 'a1' && small.ok === false && !('refs_truncated' in small), 'small audit line is untouched');

  // teammate detection via the Claude process argv (--agent-id <name>@<team>)
  const teams = tmp('kg-teams-');
  mkdirSync(join(teams, 'session-live'), { recursive: true });
  writeFileSync(join(teams, 'session-live', 'config.json'), JSON.stringify({ leadSessionId: 'LEAD-LIVE', members: [{ name: 'w', tmuxPaneId: '%2' }] }), 'utf-8');
  const mateArgv = '/x/claude --agent-id session-dict-builder@session-live --agent-name b --team-name session-live --model m';
  assert(parseAgentId(mateArgv)?.agent_id === 'session-dict-builder@session-live' && parseAgentId(mateArgv)?.team === 'session-live', 'parseAgentId extracts name@team from argv');
  assert(parseAgentId('/x/claude --resume abc --model m') === null && parseAgentId('') === null, 'no --agent-id => not a teammate');
  const mate = detectTeammate(mateArgv, teams);
  assert(mate?.lead === 'LEAD-LIVE' && mate?.agent_id === 'session-dict-builder@session-live', 'teammate argv -> lead from the team config + agent_id');
  assert(detectTeammate('/x/claude --model m', teams) === null, 'main session argv never yields a parent (stale config listing its pane is ignored)');
  const noCfg = detectTeammate('/x/claude --agent-id w@ghost-team', teams);
  assert(noCfg?.agent_id === 'w@ghost-team' && noCfg?.lead === '', 'flag present but team config missing -> agent_id kept, no lead');
  assert(detectTeammate('/x/claude --agent-id w@../../etc', teams)?.lead === '', 'path-like team name is refused');
  assert(readProcessArgv(process.pid).length > 0 && readProcessArgv(999999999) === '', 'readProcessArgv reads a live pid and fails open on a dead one');

  // process key + continuation pointer
  assert(procKey({ CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/cc-socks/3217.sock', TMUX_PANE: '%4' }) === 'pid-3217', 'procKey prefers the PID in the messaging socket');
  assert(procKey({ TMUX_PANE: '%4' }) === 'pane-4', 'procKey falls back to TMUX_PANE');
  assert(procKey({}) === '' && procKey({ TMUX_PANE: 'weird' }) === '', 'procKey is empty when nothing usable');
  assert(swapProcPointer('pid-1', 'S1', dir) === '', 'first pointer write has no previous id');
  assert(swapProcPointer('pid-1', 'S2', dir) === 'S1', 'second write returns the previous id');
  assert(swapProcPointer('pid-1', 'S2', dir) === '', 'same id returns no previous (compaction keeps the id)');
  assert(swapProcPointer('', 'S3', dir) === '', 'empty key skips chaining');

  // strict CLI session id
  assert(cliSessionId('X', { CLAUDE_CODE_SESSION_ID: 'E' }) === 'X', 'cliSessionId: explicit --session wins');
  assert(cliSessionId(undefined, { CLAUDE_CODE_SESSION_ID: 'E' }) === 'E', 'cliSessionId: falls back to env');
  assert(cliSessionId(undefined, {}) === '' && cliSessionId('  ', { CLAUDE_CODE_SESSION_ID: ' ' }) === '', 'cliSessionId: empty when neither (caller must error)');

  rmSync(dir, { recursive: true, force: true });
  rmSync(teams, { recursive: true, force: true });
}

// ============================================================
// Part B — CLI hooks + commands (integration, built dist/)
// ============================================================
function partB(): void {
  console.error('\nPart B — CLI (integration)');
  if (!existsSync(cliJs)) {
    console.error(`  ⚠️  ${cliJs} missing — run \`npm run build\` first. Skipping Part B.`);
    return;
  }
  const proj = tmp('kg-sess-proj-');
  mkdirSync(join(proj, '.knowledge-graph'), { recursive: true });
  writeFileSync(join(proj, '.knowledge-graph', 'config.json'), JSON.stringify({ project_id: 'sess-test', project_name: 'sess-test' }), 'utf-8');
  const sdir = join(proj, '.sessions');
  const baseEnv = { ...process.env, KG_SESSIONS_DIR: sdir, CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/cc-socks/4242.sock' };
  delete (baseEnv as Record<string, unknown>).TMUX_PANE;
  delete (baseEnv as Record<string, unknown>).CLAUDE_CODE_SESSION_ID;

  const run = (args: string[], stdin = '', extraEnv: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [cliJs, ...args], { input: stdin, cwd: proj, encoding: 'utf-8', env: { ...baseEnv, ...extraEnv } });
    return { out: r.stdout ?? '', err: r.stderr ?? '', code: r.status };
  };

  // kg session set / show / list
  let r = run(['session', 'set', 'root1', 'name=main work', 'note=hello', 'custom=keepme']);
  assert(r.code === 0 && JSON.parse(r.out).name === 'main work', 'kg session set creates a session and edits fields');
  run(['session', 'set', 'child1', 'parent_id=root1', 'name=helper']);
  r = run(['session', 'show', 'child1']);
  const shown = JSON.parse(r.out);
  assert(shown.root_id === 'root1' && shown.chain.join(',') === 'child1,root1', 'kg session show prints root_id + chain');
  run(['session', 'set', 'root1', 'note=edited']);
  assert(readSession('root1', sdir)?.custom === 'keepme' && readSession('root1', sdir)?.note === 'edited', 'kg session set preserves other fields');
  r = run(['session', 'list']);
  assert(r.out.includes('root1') && r.out.includes('child1') && r.out.includes('-> root root1'), 'kg session list shows sessions with roots');
  run(['session', 'set', 'old1', 'status=archived']);
  assert(!run(['session', 'list']).out.includes('old1') && run(['session', 'list', '--all']).out.includes('old1'), 'archived sessions hidden unless --all');
  r = run(['session', 'set', 'root1', 'parent_id=child1']);
  assert(r.code === 0 && r.err.includes('cycle'), 'kg session set allows a cycle with a warning');
  run(['session', 'set', 'root1', 'parent_id=null']);
  assert(readSession('root1', sdir)?.parent_id === undefined, 'key=null deletes the field');
  run(['session', 'set', 'rep1', 'parent_id=root1', 'continues_id=root1']);
  run(['session', 'set', 'rep1', 'parent_id=', 'continues_id=']);
  const rep = readSession('rep1', sdir);
  assert(rep?.parent_id === undefined && rep?.continues_id === undefined && resolveRoot('rep1', sdir) === 'rep1', 'key= (empty value) clears the field');
  assert(run(['session', 'show', 'ghost']).code === 1, 'kg session show on a missing id exits 1');

  // audit hook
  const payload = (over: Record<string, unknown>) => JSON.stringify({
    session_id: 'child1',
    tool_name: 'mcp__knowledge-graph__knowledge_store',
    tool_input: { content: 'x', id: 'upcozm-7' },
    tool_response: [{ type: 'text', text: JSON.stringify({ ok: true, data: { id: 'chunk-abc' } }) }],
    agent_id: 'agent-9',
    agent_type: 'builder',
    ...over,
  });
  r = run(['session', 'audit'], payload({}));
  const auditFile = join(sdir, 'root1.audit.jsonl');
  const line = existsSync(auditFile) ? JSON.parse(readFileSync(auditFile, 'utf-8').trim().split('\n').pop()!) : null;
  assert(r.code === 0 && !!line, 'audit hook exits 0 and writes a line under the ROOT session file');
  assert(line?.session_id === 'child1' && line?.root_id === 'root1' && line?.tool === 'knowledge_store' && line?.ok === true, 'audit line has session/root/tool/ok');
  assert(line?.agent_id === 'agent-9' && line?.agent_type === 'builder', 'audit line captures agent_id / agent_type');
  assert(Array.isArray(line?.refs) && line.refs.includes('upcozm-7') && line.refs.includes('chunk-abc'), 'audit line collects refs from input and response');
  assert(!!line?.ts && !Number.isNaN(Date.parse(line.ts)), 'audit line has an ISO ts');

  run(['session', 'audit'], payload({ tool_response: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: 'not_found' } }) }], agent_id: undefined }));
  const lines = readFileSync(auditFile, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  assert(lines.length === 2 && lines[1].ok === false && lines[1].agent_id === null, 'error envelope -> ok:false, missing agent_id -> null');

  const before = lines.length;
  run(['session', 'audit'], payload({ tool_name: 'Edit' }));
  assert(readFileSync(auditFile, 'utf-8').trim().split('\n').length === before, 'non-KG tools are not audited');
  r = run(['session', 'audit'], 'not json at all');
  assert(r.code === 1 && r.err.includes('session_id'), 'audit hook with no usable session_id exits 1 with a stderr error');
  r = run(['session', 'audit'], JSON.stringify({ tool_name: 'mcp__knowledge-graph__knowledge_list' }));
  assert(r.code === 1, 'audit hook with payload lacking session_id exits 1');
  r = run(['session', 'audit'], payload({ session_id: 'fresh-sess' }));
  assert(r.code === 0 && existsSync(join(sdir, 'fresh-sess.audit.jsonl')), 'unknown session audits under itself (own root)');

  // goal bind keyed by the ROOT session
  run(['goal', 'bind'], JSON.stringify({ session_id: 'child1', tool_input: { goal: 'shared goal' } }));
  const kgDir = join(proj, '.knowledge-graph');
  assert(readGoal(kgDir, 'root1')?.goal === 'shared goal' && readGoal(kgDir, 'child1') === null, 'goal bind from a child writes the goal under the root');
  const pre = run(['goal', 'pre-edit'], JSON.stringify({ session_id: 'root1', tool_input: { file_path: 'lib/x.dart' } }));
  assert(pre.out.includes('shared goal'), 'root session sees the goal set by its child');

  // prime: startup then clear chains continues_id via the per-process pointer
  run(['prime'], JSON.stringify({ source: 'startup', session_id: 'OLD-S' }));
  assert(readSession('OLD-S', sdir)?.status === 'active', 'prime startup registers the session');
  assert(readSession('OLD-S', sdir)?.continues_id === undefined, 'startup does not chain');
  run(['prime'], JSON.stringify({ source: 'clear', session_id: 'NEW-S' }));
  assert(readSession('NEW-S', sdir)?.continues_id === 'OLD-S', 'prime source=clear sets continues_id to the previous session');
  assert(resolveRoot('NEW-S', sdir) === 'OLD-S', 'cleared session rolls up to the previous session as root');
  run(['prime'], JSON.stringify({ source: 'resume', session_id: 'RES-S' }));
  assert(readSession('RES-S', sdir)?.continues_id === undefined, 'prime source=resume does NOT chain (resume reuses the original id)');
  assert(resolveRoot('RES-S', sdir) === 'RES-S', 'a resumed session stays its own root');
  run(['prime'], JSON.stringify({ source: 'clear', session_id: 'NEW-S2' }));
  assert(readSession('NEW-S2', sdir)?.continues_id === 'RES-S', 'the pointer advanced on resume, so the next /clear chains to the resumed id');
  run(['session', 'set', 'MAN-S', 'continues_id=manual-target']);
  run(['prime'], JSON.stringify({ source: 'clear', session_id: 'MAN-S' }));
  assert(readSession('MAN-S', sdir)?.continues_id === 'manual-target', 'prime never overwrites a manually set continues_id');
  run(['prime'], JSON.stringify({ source: 'compact', session_id: 'MAN-S' }));
  assert(readSession('MAN-S', sdir)?.continues_id === 'manual-target', 'prime compact (same id) changes nothing');

  // strict identity — hooks without session_id: stderr error + exit 1 (non-blocking, visible)
  for (const [args, name] of [
    [['goal', 'bind'], 'goal bind'],
    [['goal', 'pre-edit'], 'goal pre-edit'],
    [['context'], 'context'],
    [['prime'], 'prime'],
  ] as [string[], string][]) {
    const x = run(args, JSON.stringify({ prompt: 'hello there world', source: 'startup', tool_input: { goal: 'g', file_path: 'a.ts' } }));
    assert(x.code === 1 && x.err.includes('session_id'), `kg ${name} without session_id exits 1 with a stderr error`);
  }

  // strict identity — manual commands need --session or CLAUDE_CODE_SESSION_ID
  for (const args of [['goal', 'get'], ['goal', 'set', 'a goal'], ['goal', 'clear'], ['session', 'show'], ['session', 'set', 'name=x'], ['list'], ['query', 'topic']]) {
    const x = run(args);
    assert(x.code === 1 && x.err.includes('no session id'), `kg ${args.join(' ')} without a session id exits 1`);
  }
  r = run(['goal', 'set', '--session', 'child1', 'flag goal']);
  assert(r.code === 0 && readGoal(kgDir, 'root1')?.goal === 'flag goal', 'kg goal set --session works (resolved to root)');
  r = run(['goal', 'get'], '', { CLAUDE_CODE_SESSION_ID: 'child1' });
  assert(r.code === 0 && r.out.includes('flag goal'), 'kg goal get uses CLAUDE_CODE_SESSION_ID when --session is absent');
  r = run(['session', 'show'], '', { CLAUDE_CODE_SESSION_ID: 'child1' });
  assert(r.code === 0 && JSON.parse(r.out).root_id === 'root1', 'kg session show defaults to the current session');
  r = run(['session', 'set', 'note=via-env'], '', { CLAUDE_CODE_SESSION_ID: 'child1' });
  assert(r.code === 0 && readSession('child1', sdir)?.note === 'via-env', 'kg session set k=v defaults to the current session');

  rmSync(proj, { recursive: true, force: true });
}

// ============================================================
// Part C — strict identity at the daemon and the MCP client (isolated temp daemon)
// ============================================================
async function partC(): Promise<void> {
  console.error('\nPart C — strict identity: daemon + MCP client (temp daemon)');
  if (!existsSync(cliJs)) { console.error('  ⚠️  dist missing — skipping Part C.'); return; }
  const { ensureDaemon } = await import('../dist/daemon-manager.js');
  const { loadConfig } = await import('../dist/config.js');

  const projectDir = tmp('kg-sess-daemon-');
  const kgDir = join(projectDir, '.knowledge-graph');
  mkdirSync(join(kgDir, 'data'), { recursive: true });
  const cfg = { version: 1, project_id: 'sess-daemon-test', project_name: 'sess-daemon-test', created_at: new Date().toISOString(), daemon: { port_range_start: 0, idle_timeout_ms: 60_000 }, overrides: {} };
  writeFileSync(join(kgDir, 'config.json'), JSON.stringify(cfg), 'utf-8');
  const project = {
    projectId: cfg.project_id, projectName: cfg.project_name, projectDir, kgDir,
    dbPath: join(kgDir, 'data', 'knowledge'), configPath: join(kgDir, 'config.json'),
    daemonPortFile: join(kgDir, 'daemon.port'), daemonPidFile: join(kgDir, 'daemon.pid'), config: cfg,
  };
  let url = '';
  try {
    url = await ensureDaemon(project as any, loadConfig());
    const rpc = async (params: Record<string, unknown>) => {
      const res = await fetch(`${url}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'state_sessions', params }) });
      return (await res.json()) as { result?: unknown; error?: { message: string } };
    };
    const noId = await rpc({});
    assert(!!noId.error && /client_session_id is required/.test(noId.error.message), 'daemon: tool RPC without client_session_id -> error');
    const blank = await rpc({ client_session_id: '   ', session_id: 'x' });
    assert(!!blank.error, 'daemon: blank client_session_id -> error (session_id alone is a filter, not identity)');
    const ok = await rpc({ client_session_id: 'S-ok' });
    assert(!ok.error && !!ok.result, 'daemon: tool RPC with client_session_id succeeds');
    const conn = await fetch(`${url}/rpc/connect`, { method: 'POST' });
    assert(conn.ok, 'daemon: /rpc/connect stays exempt (lifecycle, not a tool call)');

    // MCP client with NO CLAUDE_CODE_SESSION_ID: server starts, every tool call -> validation error
    const env = { ...process.env, KG_SESSIONS_DIR: join(projectDir, '.sessions') } as Record<string, string | undefined>;
    delete env.CLAUDE_CODE_SESSION_ID;
    const child = spawn(process.execPath, [cliJs, 'serve'], { cwd: projectDir, env: env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    child.stdout.on('data', (d) => { buf += d.toString(); });
    const send = (o: unknown) => child.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    await new Promise((r) => setTimeout(r, 1500));
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'knowledge_list', arguments: {} } });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'session_list', arguments: {} } });
    const deadline = Date.now() + 15_000;
    const lines = () => buf.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    while (Date.now() < deadline && !(lines().some((m) => m.id === 2) && lines().some((m) => m.id === 3))) await new Promise((r) => setTimeout(r, 200));
    const text = (id: number) => { const m = lines().find((x) => x.id === id); return { isError: m?.result?.isError, env: m?.result?.content?.[0]?.text ? JSON.parse(m.result.content[0].text) : null }; };
    const a = text(2), b = text(3);
    assert(a.isError === true && a.env?.ok === false && a.env?.error?.code === 'validation' && /CLAUDE_CODE_SESSION_ID/.test(a.env?.error?.message), 'MCP client w/o env: proxied tool -> validation error naming CLAUDE_CODE_SESSION_ID');
    assert(b.isError === true && b.env?.error?.code === 'validation', 'MCP client w/o env: client-side tool (session_list) -> validation error too');
    child.kill('SIGTERM');
  } catch (e) {
    assert(false, 'Part C ran without crashing', String(e));
  } finally {
    if (url) await fetch(`${url}/rpc/shutdown`, { method: 'POST' }).catch(() => {});
    rmSync(projectDir, { recursive: true, force: true });
  }
}

console.error('=== session-test ===');
partA();
partB();
await partC();
console.error(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
