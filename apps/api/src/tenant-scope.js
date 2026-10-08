import { AsyncLocalStorage } from 'node:async_hooks';
import { Types } from 'mongoose';
const storage = new AsyncLocalStorage();
export const currentScope = () => storage.getStore();
/**
 * Runs `task` with a tenant scope attached.
 *
 * Mongoose queries are lazy: `Model.find()` does nothing until it is awaited. If a query is
 * returned from `task` un-awaited, it would run AFTER the scope ended and be refused (or worse,
 * run unscoped). So if the task returns a query/aggregate, it is executed here, inside the scope.
 */
export const runInScope = (scope, task) => storage.run(scope, () => {
    const result = task();
    if (result && typeof result.exec === 'function' && typeof result.then === 'function')
        return result.exec();
    return result;
});
function scopeForQuery() {
    const scope = currentScope();
    if (!scope || (!scope.schoolId && !scope.system))
        throw new Error('Tenant scope missing: refusing an unscoped school-data query');
    return scope;
}
/**
 * Automatically constrains reads/writes to the authenticated school.
 * Global models (User, School, Plan, Session...) must not use this plugin.
 *
 * Every Mongoose entry point that can read or change many rows is covered, so a route
 * cannot accidentally leak another school's data. Anything not covered here either fails
 * closed (bulkWrite) or is not used by the app.
 */
export function tenantPlugin(schema) {
    schema.pre(/^find/, function () {
        const scope = scopeForQuery();
        if (!scope.system)
            this.where({ schoolId: scope.schoolId });
    });
    schema.pre(['countDocuments', 'distinct', 'updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany'], function () {
        const scope = scopeForQuery();
        if (!scope.system)
            this.setQuery({ ...this.getQuery(), schoolId: scope.schoolId });
    });
    schema.pre('aggregate', function () {
        const scope = scopeForQuery();
        // Mongoose does not cast values inside aggregate pipelines, so the id must be a real ObjectId here.
        if (!scope.system)
            this.pipeline().unshift({ $match: { schoolId: new Types.ObjectId(scope.schoolId) } });
    });
    // 'validate' (not 'save') because Mongoose validates BEFORE save hooks run, and schoolId is required.
    schema.pre('validate', function () {
        const scope = scopeForQuery();
        if (!scope.system) {
            if (this.schoolId && String(this.schoolId) !== scope.schoolId)
                throw new Error('Tenant mismatch on document save');
            this.schoolId = scope.schoolId;
        }
    });
    // insertMany: stamp / verify the school on every row.
    schema.pre('insertMany', function (next, docs) {
        try {
            const scope = scopeForQuery();
            if (!scope.system) {
                for (const doc of Array.isArray(docs) ? docs : [docs]) {
                    if (doc.schoolId && String(doc.schoolId) !== scope.schoolId)
                        throw new Error('Tenant mismatch on insertMany');
                    doc.schoolId = scope.schoolId;
                }
            }
            next();
        }
        catch (error) {
            next(error);
        }
    });
    // bulkWrite bypasses query middleware, so only system scripts may use it.
    schema.pre('bulkWrite', function (next) {
        try {
            if (!scopeForQuery().system)
                throw new Error('bulkWrite is only allowed in system scope');
            next();
        }
        catch (error) {
            next(error);
        }
    });
}
export function assertSystemScope() {
    if (!currentScope()?.system)
        throw new Error('System-only operation');
}
