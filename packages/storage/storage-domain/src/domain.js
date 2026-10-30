/**
 * Runtime of one open domain: authoritative in-memory state, the single
 * per-domain write chain, and change-event emission. Reads are synchronous
 * from memory; every write queues on the chain, awaits backend durability
 * FIRST, then mutates memory, then emits `domain/changed` — a rejected
 * backend write leaves memory untouched (no divergence between reads and the
 * medium), and events carry values that equal the in-memory state at
 * emission, in write order.
 * @module @aeven/storage-domain/src/domain
 */
import { deepEqualJson } from '@aeven/util-values';
import { DomainError } from "./error.js";
const noop = () => { };
/**
 * The single domain implementation behind the {@link Domain} interface. The
 * facility constructs it from a validated `loadAll` snapshot and erases it to
 * `Domain<S>`; nothing outside this package constructs one.
 */
export class DomainImpl {
    ctx;
    spec;
    unit;
    onClosed;
    /** Domain name from the spec. */
    name;
    tables = new Map();
    globalValue;
    globalHandle;
    /** Tail of the write chain; every link settles (rejections are observed by the caller's slice). */
    chain = Promise.resolve();
    /** Set when close begins: new writes reject while already-queued writes drain. */
    disposing = false;
    /** Set when close finishes (chain drained, unit closed): reads reject from here on. */
    closed = false;
    disposal;
    /** Stops foreign-write observation; `undefined` when the backend cannot report it. */
    unwatchExternal;
    /**
     * @param ctx - Context that carries `domain/changed` emissions.
     * @param spec - The domain declaration.
     * @param unit - The opened backend unit; this instance owns its lifecycle.
     * @param records - Validated records from the unit's `loadAll`, one entry
     * per declared table (empty maps included) — the facility builds it from
     * the spec, so the entry set IS the table set.
     * @param globalValue - Validated stored global, or the spec's `initial`
     * when the medium held none; `undefined` when the spec declares no global.
     * @param onClosed - Facility hook run once after teardown completes; frees
     * the domain name for a later open.
     */
    constructor(ctx, spec, unit, records, globalValue, onClosed) {
        this.ctx = ctx;
        this.spec = spec;
        this.unit = unit;
        this.onClosed = onClosed;
        this.name = spec.name;
        const host = {
            domainName: spec.name,
            unit,
            enqueue: job => this.enqueue(job),
            assertReadable: () => { this.assertReadable(); },
            emitChanged: (change) => { this.emitChanged(change); },
        };
        for (const [table, tableRecords] of records) {
            this.tables.set(table, new KvTableImpl(host, table, tableRecords));
        }
        if (spec.global !== undefined) {
            this.globalValue = globalValue;
            this.globalHandle = {
                get: () => {
                    this.assertReadable();
                    return this.globalValue;
                },
                set: value => this.enqueue(async () => {
                    await this.unit.setGlobal(value);
                    this.globalValue = value;
                    this.emitChanged({ domain: this.name, table: '', key: '', operation: 'put', value });
                }),
            };
        }
    }
    /**
     * Begin converging on foreign writes, when the backend can report them.
     * Called once by the facility after construction; a backend without
     * {@link KvUnit.watchExternal} leaves this domain on its open-time snapshot.
     */
    observeExternal() {
        this.unwatchExternal = this.unit.watchExternal?.((changed) => {
            void this.applyExternal(changed).catch((error) => {
                // Convergence is best-effort: a failed pass leaves memory on the last
                // good value and the next report (or the backend's sweep) retries.
                this.ctx.logger.warn(`domain '${this.name}': applying an external change failed; memory stays as it was: ${String(error)}`);
            });
        });
    }
    /**
     * Converge this domain's memory on writes another process made to the
     * medium, and announce each one as an ordinary `domain/changed`.
     *
     * Consumers must not distinguish a foreign write from a local one: a
     * listener that treated them differently would be reasoning about which
     * process wrote a value, which is exactly the split-brain this convergence
     * removes. The events therefore carry no origin marker.
     *
     * The work runs as one job on the write chain, so it cannot interleave with
     * a local `put` on the same domain; between processes the medium still
     * resolves last-write-wins, unchanged. Each location is re-read from the
     * medium and validated with the table's own schema before it reaches
     * memory, so a foreign write this build cannot read leaves the current
     * value in place — the same judgment the open-time load applies.
     * @param changed - Locations whose stored bytes changed; `table: ''` and
     * `key: ''` name the global singleton.
     * @returns resolution after memory converged and every event was emitted.
     */
    applyExternal(changed) {
        if (this.disposing || this.closed)
            return Promise.resolve();
        return this.enqueue(async () => {
            const snapshot = await this.unit.loadAll();
            for (const { table, key } of changed) {
                if (table === '')
                    this.applyExternalGlobal(snapshot.global);
                else
                    this.applyExternalRecord(table, key, snapshot.tables[table]?.[key]);
            }
        });
    }
    /**
     * Converge one record on the medium. Emission follows the mutation because
     * the package invariant asserts an emitted value is the one memory already
     * holds.
     */
    applyExternalRecord(table, key, raw) {
        const tableSpec = this.spec.tables[table];
        const handle = this.tables.get(table);
        /* v8 ignore next -- a watcher only reports the declared tables it scans. */
        if (tableSpec === undefined || handle === undefined)
            return;
        if (raw === undefined) {
            if (!handle.deleteExternal(key))
                return;
            this.emitChanged({ domain: this.name, table, key, operation: 'deleted' });
            return;
        }
        let parsed;
        try {
            parsed = tableSpec.valueSchema.parse(raw);
        }
        catch (error) {
            this.ctx.logger.warn(`domain '${this.name}': external write to record '${key}' in table '${table}' `
                + `does not match its schema; keeping the current value: ${String(error)}`);
            return;
        }
        if (!handle.putExternal(key, parsed))
            return;
        this.emitChanged({ domain: this.name, table, key, operation: 'put', value: parsed });
    }
    /** Converge the global singleton on the medium. A null stored global means "never written". */
    applyExternalGlobal(raw) {
        const globalSpec = this.spec.global;
        if (globalSpec === undefined || raw === null)
            return;
        let parsed;
        try {
            parsed = globalSpec.schema.parse(raw);
        }
        catch (error) {
            this.ctx.logger.warn(`domain '${this.name}': external write to the global does not match its schema; `
                + `keeping the current value: ${String(error)}`);
            return;
        }
        if (deepEqualJson(parsed, this.globalValue))
            return;
        this.globalValue = parsed;
        this.emitChanged({ domain: this.name, table: '', key: '', operation: 'put', value: parsed });
    }
    /** Global singleton handle; accessing it on a spec that declares no global is a caller bug and throws. */
    get global() {
        if (this.globalHandle === undefined) {
            throw new Error(`domain '${this.name}' declares no global`);
        }
        return this.globalHandle;
    }
    /**
     * Resolve one declared table handle; an undeclared name is a caller bug
     * and throws.
     * @param name - Declared table name.
     * @returns the stable table handle.
     */
    table(name) {
        const table = this.tables.get(name);
        if (table === undefined) {
            throw new Error(`domain '${this.name}' declares no table '${name}'`);
        }
        return table;
    }
    /**
     * Close this domain: reject new writes immediately, drain already-queued
     * writes (their events still emit), close the unit, then free the name via
     * the facility hook. Idempotent — repeated calls share one teardown.
     * @returns resolution after the unit is released.
     */
    close() {
        this.disposal ??= this.runClose();
        return this.disposal;
    }
    async runClose() {
        this.disposing = true;
        // Stop observing before the drain: an external apply queued after this
        // point would race the unit's own close.
        this.unwatchExternal?.();
        this.unwatchExternal = undefined;
        // Chain links never reject (each is settled via then(noop, noop)), so
        // this await is a pure drain barrier.
        await this.chain;
        await this.unit.close();
        this.closed = true;
        this.onClosed();
    }
    /**
     * Dispatch one post-durability change notification, containing observer
     * failures: the write is already committed (medium and memory both hold
     * the new state), so a throwing listener must not retroactively reject it.
     */
    emitChanged(change) {
        try {
            this.ctx.emit('domain/changed', change);
        }
        catch (error) {
            // Swallows synchronous observer exceptions only: emit dispatches
            // listeners inline and nothing else runs in the try. The event is a
            // notification, not a transaction participant — the commit point has
            // passed, so containment (with a log) is the only correct outcome.
            this.ctx.logger.warn(`domain '${this.name}': domain/changed listener failed: ${String(error)}`);
        }
    }
    enqueue(job) {
        if (this.disposing) {
            return Promise.reject(new DomainError('closed', `domain '${this.name}' is closed`));
        }
        const result = this.chain.then(job);
        this.chain = result.then(noop, noop);
        return result;
    }
    assertReadable() {
        if (this.closed) {
            throw new DomainError('closed', `domain '${this.name}' is closed`);
        }
    }
}
/** Table handle bound to one in-memory record map and its domain's write chain. */
class KvTableImpl {
    host;
    tableName;
    records;
    constructor(host, tableName, records) {
        this.host = host;
        this.tableName = tableName;
        this.records = records;
    }
    get(key) {
        this.host.assertReadable();
        return this.records.get(key);
    }
    entries() {
        this.host.assertReadable();
        return [...this.records.entries()][Symbol.iterator]();
    }
    keys() {
        this.host.assertReadable();
        return [...this.records.keys()][Symbol.iterator]();
    }
    get size() {
        this.host.assertReadable();
        return this.records.size;
    }
    put(key, value) {
        return this.host.enqueue(async () => {
            await this.host.unit.putRecord(this.tableName, key, value);
            this.records.set(key, value);
            this.emitPut(key, value);
        });
    }
    delete(key) {
        return this.host.enqueue(async () => {
            // Existence is decided at this job's chain slot, not at call time: an
            // earlier queued put of the same key makes this delete observe it.
            if (!this.records.has(key))
                return false;
            await this.host.unit.deleteRecord(this.tableName, key);
            this.records.delete(key);
            this.host.emitChanged({
                domain: this.host.domainName,
                table: this.tableName,
                key,
                operation: 'deleted',
            });
            return true;
        });
    }
    update(key, fn) {
        return this.host.enqueue(async () => {
            if (!this.records.has(key)) {
                throw new DomainError('missing-key', `domain '${this.host.domainName}' table '${this.tableName}' has no record '${key}' to update`);
            }
            const next = fn(this.records.get(key));
            await this.host.unit.putRecord(this.tableName, key, next);
            this.records.set(key, next);
            this.emitPut(key, next);
            return next;
        });
    }
    /**
     * Adopt a value the medium already holds, written by another process. No
     * medium write: this converges memory on bytes that are already durable.
     * @param key - Record key.
     * @param value - Validated value read back from the medium.
     * @returns whether memory changed, so the caller emits only a real change.
     */
    putExternal(key, value) {
        if (this.records.has(key) && deepEqualJson(this.records.get(key), value))
            return false;
        this.records.set(key, value);
        return true;
    }
    /**
     * Drop a record another process deleted from the medium.
     * @param key - Record key.
     * @returns whether memory changed.
     */
    deleteExternal(key) {
        return this.records.delete(key);
    }
    emitPut(key, value) {
        this.host.emitChanged({
            domain: this.host.domainName,
            table: this.tableName,
            key,
            operation: 'put',
            value,
        });
    }
}
//# sourceMappingURL=domain.js.map