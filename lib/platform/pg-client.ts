/**
 * TORCH platform data client (c0 port).
 *
 * A drop-in replacement for the Supabase client that ycode's repositories use.
 * It implements the subset of the PostgREST query builder the code base calls
 * (select / insert / update / upsert / delete, eq / neq / in / is / not / or /
 * like / ilike / lt / lte / gt / gte, order / limit / range, single /
 * maybeSingle, count: 'exact' + head, embedded resources with `!inner`) on top
 * of knex and plain PostgreSQL, plus `.rpc()`, `.storage` and a no-op
 * `.channel()`.
 *
 * Every query is scoped to one organization: `tenant_id` (the Business OS
 * organization id; ycode's own column name, kept so its direct knex paths
 * scope the same way) is added to every WHERE and to every INSERT. The client never sees another
 * organization's rows.
 */

import type { Knex } from 'knex';
import { getKnexClient } from '@/lib/knex-client';
import { createStorageClient } from '@/lib/platform/storage';

export interface PgError {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
}

export interface PgResult<T = unknown> {
  data: T | null;
  error: PgError | null;
  count: number | null;
  status: number;
  statusText: string;
}

type Mode = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

interface Filter {
  column: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'in' | 'not' | 'raw';
  value: unknown;
  /** For `not`: the inner operator. */
  inner?: string;
  /** For `raw` (the `.or()` DSL): a function applying itself to a knex builder. */
  apply?: (qb: Knex.QueryBuilder) => void;
}

interface Embed {
  /** Related table name as written in the select, e.g. `page_layers`. */
  table: string;
  inner: boolean;
  columns: string[];
  filters: Filter[];
}

/**
 * Foreign keys between ycode tables, the way PostgREST discovers them.
 * `[parentColumn, embedColumn]`; a parent column that is the parent's `id`
 * makes the embed one-to-many (array), otherwise many-to-one (object).
 */
const RELATIONS: Record<string, Record<string, [string, string]>> = {
  collection_item_values: { collection_items: ['item_id', 'id'], collection_fields: ['field_id', 'id'] },
  collection_items: { collections: ['collection_id', 'id'], collection_item_values: ['id', 'item_id'] },
  collection_fields: { collections: ['collection_id', 'id'] },
  pages: { page_layers: ['id', 'page_id'], page_folders: ['page_folder_id', 'id'] },
  page_layers: { pages: ['page_id', 'id'] },
  assets: { asset_folders: ['asset_folder_id', 'id'] },
  translations: { locales: ['locale_id', 'id'] },
  webhook_deliveries: { webhooks: ['webhook_id', 'id'] },
};

/** Tables that are shared by the whole deployment rather than owned by one organization. */
const GLOBAL_TABLES = new Set(['migrations']);

const NO_ROWS: PgError = {
  message: 'JSON object requested, multiple (or no) rows returned',
  code: 'PGRST116',
  details: null,
  hint: null,
};

let columnTypes: Map<string, Map<string, string>> | null = null;

/** Column data types, loaded once, so JSON columns are serialised the way PostgREST did. */
async function getColumnTypes(knex: Knex): Promise<Map<string, Map<string, string>>> {
  if (columnTypes) return columnTypes;
  const rows = await knex('information_schema.columns')
    .select('table_name', 'column_name', 'data_type')
    .where('table_schema', 'public');
  const map = new Map<string, Map<string, string>>();
  for (const r of rows as Array<{ table_name: string; column_name: string; data_type: string }>) {
    if (!map.has(r.table_name)) map.set(r.table_name, new Map());
    map.get(r.table_name)!.set(r.column_name, r.data_type);
  }
  columnTypes = map;
  return map;
}

/** Forget the cached column types (after a migration adds columns). */
export function resetColumnTypeCache(): void {
  columnTypes = null;
}

function toPgError(e: unknown): PgError {
  const err = e as { message?: string; code?: string; detail?: string; hint?: string };
  return {
    message: err?.message || 'Database error',
    code: err?.code || 'PG000',
    details: err?.detail ?? null,
    hint: err?.hint ?? null,
  };
}

/** Split on top-level commas (ignoring commas inside parentheses). */
function splitTopLevel(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseScalar(raw: string): unknown {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

/**
 * Parse PostgREST's logical filter DSL used by `.or()`:
 *   `a.eq.1,b.is.null,and(c.gt.2,d.in.(x,y))`
 */
function parseLogical(expr: string, mode: 'or' | 'and'): (qb: Knex.QueryBuilder) => void {
  const items = splitTopLevel(expr);
  return (qb) => {
    for (const item of items) {
      const group = item.match(/^(and|or)\(([\s\S]*)\)$/);
      const applyItem = (sub: Knex.QueryBuilder) => {
        if (group) {
          parseLogical(group[2], group[1] as 'or' | 'and')(sub);
          return;
        }
        const m = item.match(/^([^.]+)\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|not\.is|not\.eq)\.([\s\S]*)$/);
        if (!m) throw new Error(`Unsupported filter expression: ${item}`);
        const [, col, op, rawValue] = m;
        applyFilter(sub, { column: col, op: op.startsWith('not.') ? 'not' : (op as Filter['op']), inner: op.startsWith('not.') ? op.slice(4) : undefined, value: op === 'in' ? splitTopLevel(rawValue.replace(/^\(([\s\S]*)\)$/, '$1')).map(parseScalar) : parseScalar(rawValue) });
      };
      if (mode === 'or') qb.orWhere((sub) => applyItem(sub));
      else qb.andWhere((sub) => applyItem(sub));
    }
  };
}

/**
 * PostgREST lets a filter name a JSON path (`metadata->>ip`). knex quotes the
 * whole string as one identifier, so JSON paths become raw expressions.
 */
function columnRef(qb: Knex.QueryBuilder, column: string): string | Knex.Raw {
  if (!column.includes('->')) return column;
  const parts = column.split(/(->>|->)/);
  let sql = '??';
  const bindings: unknown[] = [parts[0]];
  for (let i = 1; i < parts.length; i += 2) {
    sql += `${parts[i]}?`;
    bindings.push(parts[i + 1]);
  }
  return qb.client.raw(sql, bindings);
}

function applyFilter(qb: Knex.QueryBuilder, f: Filter): void {
  const col = columnRef(qb, f.column) as string;
  switch (f.op) {
    case 'eq':
      if (f.value === null) qb.whereNull(col); else qb.where(col, f.value as string);
      return;
    case 'neq':
      if (f.value === null) qb.whereNotNull(col); else qb.whereNot(col, f.value as string);
      return;
    case 'gt': qb.where(col, '>', f.value as string); return;
    case 'gte': qb.where(col, '>=', f.value as string); return;
    case 'lt': qb.where(col, '<', f.value as string); return;
    case 'lte': qb.where(col, '<=', f.value as string); return;
    case 'like': qb.where(col, 'like', f.value as string); return;
    case 'ilike': qb.where(col, 'ilike', f.value as string); return;
    case 'in': qb.whereIn(col, f.value as string[]); return;
    case 'is':
      if (f.value === null) qb.whereNull(col);
      else if (f.value === true) qb.whereRaw('?? IS TRUE', [col]);
      else if (f.value === false) qb.whereRaw('?? IS FALSE', [col]);
      else qb.where(col, f.value as string);
      return;
    case 'not': {
      const inner = f.inner || 'eq';
      if (inner === 'is') {
        if (f.value === null) qb.whereNotNull(col);
        else if (f.value === true) qb.whereRaw('?? IS NOT TRUE', [col]);
        else qb.whereRaw('?? IS NOT FALSE', [col]);
      } else if (inner === 'in') qb.whereNotIn(col, f.value as string[]);
      else if (inner === 'like') qb.whereNot(col, 'like', f.value as string);
      else if (inner === 'ilike') qb.whereNot(col, 'ilike', f.value as string);
      else if (inner === 'eq') qb.whereNot(col, f.value as string);
      else qb.whereNot(col, OPERATORS[inner] || '=', f.value as string);
      return;
    }
    case 'raw': f.apply!(qb); return;
  }
}

const OPERATORS: Record<string, string> = { gt: '>', gte: '>=', lt: '<', lte: '<=' };

/** Parse `a, b, rel!inner(x, y), rel2(z)` into plain columns and embeds. */
function parseSelect(columns: string): { columns: string[]; embeds: Embed[] } {
  const plain: string[] = [];
  const embeds: Embed[] = [];
  for (const part of splitTopLevel(columns)) {
    const m = part.match(/^([a-zA-Z0-9_]+)(!inner)?\(([\s\S]*)\)$/);
    if (m) {
      embeds.push({ table: m[1], inner: !!m[2], columns: splitTopLevel(m[3]).map((c) => c.trim()), filters: [] });
    } else {
      plain.push(part.trim());
    }
  }
  return { columns: plain, embeds };
}

export class QueryBuilder<T = unknown> implements PromiseLike<PgResult<T>> {
  private mode: Mode = 'select';
  private columns: string[] = ['*'];
  private embeds: Embed[] = [];
  private countMode: 'exact' | null = null;
  private head = false;
  private filters: Filter[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private singleMode: 'single' | 'maybe' | null = null;
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private conflictColumns: string[] | null = null;
  private returning = false;

  constructor(
    private readonly table: string,
    private readonly organizationId: string | null,
  ) {}

  // ---- verbs -------------------------------------------------------------

  select(columns = '*', options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): this {
    if (this.mode !== 'select') {
      this.returning = true;
      const parsed = parseSelect(columns);
      this.columns = parsed.columns.length ? parsed.columns : ['*'];
      return this;
    }
    const parsed = parseSelect(columns);
    this.columns = parsed.columns.length ? parsed.columns : ['*'];
    this.embeds = parsed.embeds;
    if (options?.count) this.countMode = 'exact';
    if (options?.head) this.head = true;
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]): this {
    this.mode = 'insert';
    this.payload = values;
    return this;
  }

  upsert(values: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string }): this {
    this.mode = 'upsert';
    this.payload = values;
    this.conflictColumns = (options?.onConflict || 'id').split(',').map((c) => c.trim());
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.mode = 'update';
    this.payload = values;
    return this;
  }

  delete(): this {
    this.mode = 'delete';
    return this;
  }

  // ---- filters -----------------------------------------------------------

  private addFilter(f: Filter): this {
    const dot = f.column.indexOf('.');
    if (dot > 0) {
      const embed = this.embeds.find((e) => e.table === f.column.slice(0, dot));
      if (embed) {
        embed.filters.push({ ...f, column: f.column.slice(dot + 1) });
        return this;
      }
    }
    this.filters.push(f);
    return this;
  }

  eq(column: string, value: unknown): this { return this.addFilter({ column, op: 'eq', value }); }
  neq(column: string, value: unknown): this { return this.addFilter({ column, op: 'neq', value }); }
  gt(column: string, value: unknown): this { return this.addFilter({ column, op: 'gt', value }); }
  gte(column: string, value: unknown): this { return this.addFilter({ column, op: 'gte', value }); }
  lt(column: string, value: unknown): this { return this.addFilter({ column, op: 'lt', value }); }
  lte(column: string, value: unknown): this { return this.addFilter({ column, op: 'lte', value }); }
  like(column: string, value: string): this { return this.addFilter({ column, op: 'like', value }); }
  ilike(column: string, value: string): this { return this.addFilter({ column, op: 'ilike', value }); }
  is(column: string, value: null | boolean): this { return this.addFilter({ column, op: 'is', value }); }
  in(column: string, values: unknown[]): this { return this.addFilter({ column, op: 'in', value: values }); }
  not(column: string, operator: string, value: unknown): this { return this.addFilter({ column, op: 'not', inner: operator, value }); }
  or(expression: string): this { return this.addFilter({ column: '', op: 'raw', value: null, apply: (qb) => qb.where((sub) => parseLogical(expression, 'or')(sub)) }); }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string }): this {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(n: number): this { this.limitValue = n; return this; }

  range(from: number, to: number): this {
    this.offsetValue = from;
    this.limitValue = to - from + 1;
    return this;
  }

  single(): this { this.singleMode = 'single'; return this; }
  maybeSingle(): this { this.singleMode = 'maybe'; return this; }

  // ---- execution ---------------------------------------------------------

  then<R1 = PgResult<T>, R2 = never>(
    onfulfilled?: ((value: PgResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private get scoped(): boolean {
    return !GLOBAL_TABLES.has(this.table);
  }

  private applyScope(qb: Knex.QueryBuilder): void {
    if (this.scoped) qb.where(`${this.table}.tenant_id`, this.organizationId);
    for (const f of this.filters) applyFilter(qb, f);
  }

  private async serialise(knex: Knex, row: Record<string, unknown>): Promise<Record<string, unknown>> {
    const types = (await getColumnTypes(knex)).get(this.table);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const type = types?.get(key);
      if (value && typeof value === 'object' && (value as { __increment?: number }).__increment !== undefined) {
        out[key] = knex.raw('COALESCE(??, 0) + ?', [key, (value as { __increment: number }).__increment]);
      } else if ((type === 'json' || type === 'jsonb') && value !== null && value !== undefined) {
        // PostgREST encoded every JS value as JSON, strings included ("css text" -> "\"css text\"").
        out[key] = JSON.stringify(value);
      } else {
        out[key] = value;
      }
    }
    if (this.scoped && this.mode !== 'update') out.tenant_id = this.organizationId;
    return out;
  }

  private async execute(): Promise<PgResult<T>> {
    try {
      const knex = await getKnexClient();
      if (this.scoped && !this.organizationId) {
        if (this.mode === 'select') return { data: (this.singleMode ? null : []) as T, error: this.singleMode === 'single' ? NO_ROWS : null, count: this.countMode ? 0 : null, status: 200, statusText: 'OK' };
        return { data: null, error: { message: `No organization in context for ${this.mode} on ${this.table}`, code: 'TORCH_NO_ORG', details: null, hint: null }, count: null, status: 400, statusText: 'Bad Request' };
      }
      switch (this.mode) {
        case 'select': return await this.runSelect(knex);
        case 'insert':
        case 'upsert': return await this.runInsert(knex);
        case 'update': return await this.runUpdate(knex);
        case 'delete': return await this.runDelete(knex);
      }
    } catch (e) {
      return { data: null, error: toPgError(e), count: null, status: 500, statusText: 'Internal Server Error' };
    }
  }

  private async runSelect(knex: Knex): Promise<PgResult<T>> {
    const base = knex(this.table);
    this.applyScope(base);
    for (const embed of this.embeds) {
      if (!embed.inner) continue;
      const rel = RELATIONS[this.table]?.[embed.table];
      if (!rel) throw new Error(`Unknown relation ${this.table} -> ${embed.table}`);
      base.whereExists((sub) => {
        sub.select(knex.raw('1')).from(embed.table).whereRaw('?? = ??', [`${embed.table}.${rel[1]}`, `${this.table}.${rel[0]}`]);
        if (!GLOBAL_TABLES.has(embed.table)) sub.where(`${embed.table}.tenant_id`, this.organizationId);
        for (const f of embed.filters) applyFilter(sub, f);
      });
    }

    let count: number | null = null;
    if (this.countMode) {
      const countRow = await base.clone().clearSelect().clearOrder().count<{ c: string }[]>({ c: '*' }).first();
      count = Number((countRow as unknown as { c: string } | undefined)?.c ?? 0);
    }
    if (this.head) {
      return { data: [] as unknown as T, error: null, count, status: 200, statusText: 'OK' };
    }

    const selectColumns = this.columns.includes('*') ? [`${this.table}.*`] : this.columns.map((c) => `${this.table}.${c}`);
    base.select(selectColumns);
    for (const o of this.orders) base.orderBy(o.column, o.ascending ? 'asc' : 'desc');
    if (this.limitValue !== null) base.limit(this.limitValue);
    if (this.offsetValue !== null) base.offset(this.offsetValue);

    const rows = (await base) as Record<string, unknown>[];

    for (const embed of this.embeds) {
      const rel = RELATIONS[this.table]?.[embed.table];
      if (!rel) throw new Error(`Unknown relation ${this.table} -> ${embed.table}`);
      const [parentCol, embedCol] = rel;
      const keys = Array.from(new Set(rows.map((r) => r[parentCol]).filter((v) => v !== null && v !== undefined)));
      const oneToMany = parentCol === 'id';
      const cols = embed.columns.includes('*') ? ['*'] : Array.from(new Set([...embed.columns, embedCol]));
      let related: Record<string, unknown>[] = [];
      if (keys.length) {
        const q = knex(embed.table).select(cols).whereIn(embedCol, keys as string[]);
        if (!GLOBAL_TABLES.has(embed.table)) q.where('tenant_id', this.organizationId);
        for (const f of embed.filters) applyFilter(q, f);
        related = (await q) as Record<string, unknown>[];
      }
      const byKey = new Map<unknown, Record<string, unknown>[]>();
      for (const r of related) {
        const k = r[embedCol];
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k)!.push(r);
      }
      for (const row of rows) {
        const matches = byKey.get(row[parentCol]) || [];
        row[embed.table] = oneToMany ? matches : (matches[0] ?? null);
      }
    }

    return this.finish(rows, count);
  }

  private finish(rows: Record<string, unknown>[], count: number | null = null, status = 200): PgResult<T> {
    if (this.singleMode === 'single') {
      if (rows.length !== 1) {
        return { data: null, error: { ...NO_ROWS, details: `The result contains ${rows.length} rows` }, count, status: 406, statusText: 'Not Acceptable' };
      }
      return { data: rows[0] as T, error: null, count, status, statusText: 'OK' };
    }
    if (this.singleMode === 'maybe') {
      if (rows.length > 1) {
        return { data: null, error: { ...NO_ROWS, details: `The result contains ${rows.length} rows` }, count, status: 406, statusText: 'Not Acceptable' };
      }
      return { data: (rows[0] ?? null) as T, error: null, count, status, statusText: 'OK' };
    }
    return { data: rows as unknown as T, error: null, count, status, statusText: 'OK' };
  }

  private async runInsert(knex: Knex): Promise<PgResult<T>> {
    const list = Array.isArray(this.payload) ? this.payload : [this.payload as Record<string, unknown>];
    if (list.length === 0) return { data: [] as unknown as T, error: null, count: null, status: 201, statusText: 'Created' };
    const rows = await Promise.all(list.map((r) => this.serialise(knex, r)));
    const q: Knex.QueryBuilder = knex(this.table).insert(rows);
    if (this.mode === 'upsert') {
      // PostgREST merges every column of the payload on conflict. Natural keys
      // (settings.key, locales.code, …) are unique per organization now, so the
      // conflict target gains tenant_id; ids are UUIDs and stay as they are.
      const conflict = this.conflictColumns!;
      const target = this.scoped && !conflict.includes('id') && !conflict.includes('tenant_id') ? ['tenant_id', ...conflict] : conflict;
      q.onConflict(target).merge();
    }
    if (this.returning) q.returning(this.columns.includes('*') ? '*' : this.columns);
    const result = (await q) as unknown as Record<string, unknown>[];
    if (!this.returning) return { data: null, error: null, count: null, status: 201, statusText: 'Created' };
    return this.finish(result, null, 201);
  }

  private async runUpdate(knex: Knex): Promise<PgResult<T>> {
    const values = await this.serialise(knex, this.payload as Record<string, unknown>);
    const q = knex(this.table).update(values);
    this.applyScope(q);
    if (this.returning) q.returning(this.columns.includes('*') ? '*' : this.columns);
    const result = (await q) as unknown as Record<string, unknown>[];
    if (!this.returning) return { data: null, error: null, count: null, status: 204, statusText: 'No Content' };
    return this.finish(result);
  }

  private async runDelete(knex: Knex): Promise<PgResult<T>> {
    const q = knex(this.table).delete();
    this.applyScope(q);
    if (this.returning) q.returning(this.columns.includes('*') ? '*' : this.columns);
    const result = (await q) as unknown as Record<string, unknown>[];
    if (!this.returning) return { data: null, error: null, count: null, status: 204, statusText: 'No Content' };
    return this.finish(result);
  }
}

/** The handful of RPCs ycode calls, implemented in SQL here instead of as database functions. */
async function rpc(organizationId: string | null, name: string, args: Record<string, unknown> = {}): Promise<PgResult<unknown>> {
  try {
    const knex = await getKnexClient();
    switch (name) {
      case 'increment_webhook_failure_count': {
        await knex('webhooks').where({ id: args.webhook_id as string, tenant_id: organizationId })
          .update({ failure_count: knex.raw('COALESCE(failure_count, 0) + 1'), updated_at: new Date().toISOString() });
        return { data: null, error: null, count: null, status: 204, statusText: 'No Content' };
      }
      case 'increment':
        // Used as a value inside `.update({ failure_count: client.rpc('increment', { x: 1 }) })`.
        return { __increment: Number(args.x ?? 1) } as unknown as PgResult<unknown>;
      case 'get_top_items_per_collection': {
        const ids = (args.p_collection_ids as string[]) || [];
        const limit = Number(args.p_limit ?? 10);
        const rows = await knex
          .select('*')
          .from(
            knex('collection_items')
              .select('*', knex.raw('row_number() over (partition by collection_id order by manual_order asc, created_at asc) as rn'))
              .whereIn('collection_id', ids)
              .where('is_published', args.p_is_published as boolean)
              .whereNull('deleted_at')
              .where('tenant_id', organizationId)
              .as('ranked'),
          )
          .where('rn', '<=', limit);
        return { data: rows.map((r: Record<string, unknown>) => { const { rn: _rn, ...rest } = r; return rest; }), error: null, count: null, status: 200, statusText: 'OK' };
      }
      case 'exec_sql': {
        await knex.raw(String(args.sql));
        return { data: null, error: null, count: null, status: 200, statusText: 'OK' };
      }
      default:
        return { data: null, error: { message: `Unknown RPC ${name}`, code: 'TORCH_RPC', details: null, hint: null }, count: null, status: 404, statusText: 'Not Found' };
    }
  } catch (e) {
    return { data: null, error: toPgError(e), count: null, status: 500, statusText: 'Internal Server Error' };
  }
}

/** A channel that accepts every call and does nothing: realtime collaboration is off in c0. */
function noopChannel() {
  const channel = {
    on: () => channel,
    subscribe: (cb?: (status: string) => void) => { cb?.('SUBSCRIBED'); return channel; },
    send: async () => 'ok' as const,
    track: async () => 'ok' as const,
    untrack: async () => 'ok' as const,
    unsubscribe: async () => 'ok' as const,
    presenceState: () => ({}),
    topic: 'noop',
  };
  return channel;
}

export interface PlatformClient {
  from<T = unknown>(table: string): QueryBuilder<T>;
  rpc(name: string, args?: Record<string, unknown>): Promise<PgResult<unknown>>;
  storage: ReturnType<typeof createStorageClient>;
  channel(name: string): ReturnType<typeof noopChannel>;
  removeChannel(): Promise<'ok'>;
  removeAllChannels(): Promise<'ok'[]>;
  auth: { admin: { listUsers: () => Promise<{ data: { users: unknown[] }; error: null }> } };
  organizationId: string | null;
}

export function createPlatformClient(organizationId: string | null): PlatformClient {
  return {
    organizationId,
    from: <T = unknown>(table: string) => new QueryBuilder<T>(table, organizationId),
    rpc: (name, args) => rpc(organizationId, name, args),
    storage: createStorageClient(organizationId),
    channel: () => noopChannel(),
    removeChannel: async () => 'ok' as const,
    removeAllChannels: async () => [],
    // Users live in Business OS. The setup wizard only asks "is anyone here yet".
    auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'business-os' }] }, error: null }) } },
  };
}
